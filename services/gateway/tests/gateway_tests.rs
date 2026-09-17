use agentguard_gateway::{
    abac::{self, AbacContext, AbacPolicy, AgentEnvironment, RiskTier},
    auth::{AuthService, IdentityKind, RequestContext},
    config::Config,
    crypto::{
        compute_domain_separator, compute_eip712_digest, compute_spend_request_hash,
        parse_x402_authorization_header, recover_signer,
    },
    handlers::is_assignable_api_key_capability,
    pbac::{self, PbacConditions, PbacInput, PbacPolicy, PolicyEffect},
    rbac::{self, Capability, Role},
    repository::PgRepository,
    tenant::TenantContext,
    types::{OnchainReasonCode, SpendRequest, SpendRequestWire, X402AuthorizationPayload},
};
use alloy::primitives::{Address, U256, keccak256};
use alloy::signers::SignerSync;
use alloy::signers::local::PrivateKeySigner;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use chrono::Utc;
use ipnet::IpNet;
use std::net::IpAddr;
use uuid::Uuid;

#[test]
fn onchain_reason_codes_match_solidity_enum() {
    let expected = [
        (0, "ERR_NONE"),
        (1, "ERR_KILL_SWITCH"),
        (2, "ERR_MAX_PER_TX"),
        (3, "ERR_MAX_PER_WINDOW"),
        (4, "ERR_VELOCITY_EXCEEDED"),
        (5, "ERR_MERCHANT_NOT_ALLOWED"),
        (6, "ERR_BUDGET_DEPLETED"),
        (7, "ERR_EXPIRED"),
        (8, "ERR_NONCE_REUSED"),
        (9, "ERR_SIGNATURE_INVALID"),
    ];
    for (code, name) in expected {
        let reason = OnchainReasonCode::from_u8(code).expect("canonical code");
        assert_eq!(reason.as_u8(), code);
        assert_eq!(reason.as_str(), name);
        if code != 0 {
            assert_ne!(reason.as_str(), "ERR_NONE");
        }
    }
    assert!(OnchainReasonCode::from_u8(10).is_none());
}

#[test]
fn eip712_signature_recovery_uses_uint256_nonce() {
    let signer = PrivateKeySigner::random();
    let request = SpendRequest {
        agent: signer.address(),
        merchant: Address::repeat_byte(0x22),
        amount: U256::from(5_000_000u64),
        category: keccak256("compute_ai"),
        timestamp: U256::from(1_726_000_000u64),
        deadline: U256::from(1_726_003_600u64),
        nonce: U256::from(u128::MAX) + U256::from(1u8),
    };
    let domain = compute_domain_separator(10143, Address::repeat_byte(0x33));
    let digest = compute_eip712_digest(domain, compute_spend_request_hash(&request));
    let signature = signer.sign_hash_sync(&digest).expect("sign request");
    assert_eq!(
        recover_signer(digest, &signature.as_bytes()).unwrap(),
        signer.address()
    );
}

#[test]
fn x402_wire_parser_rejects_invalid_nonce_and_preserves_large_nonce() {
    let wire = SpendRequestWire {
        agent: "0x1111111111111111111111111111111111111111".to_string(),
        merchant: format!("{:#x}", Address::repeat_byte(0x22)),
        amount: "1000000".to_string(),
        category: keccak256("storage").to_string(),
        timestamp: "1726000000".to_string(),
        deadline: "1726003600".to_string(),
        nonce: "340282366920938463463374607431768211456".to_string(),
    };
    let payload = X402AuthorizationPayload {
        request: wire,
        signature: format!("0x{}", "aa".repeat(65)),
    };
    let header = format!(
        "x402 {}",
        BASE64.encode(serde_json::to_vec(&payload).unwrap())
    );
    let (request, signature) = parse_x402_authorization_header(&header).unwrap();
    assert_eq!(request.nonce, U256::from(u128::MAX) + U256::from(1u8));
    assert_eq!(signature.len(), 65);
}

#[test]
fn rbac_matches_six_role_capability_matrix() {
    assert!(rbac::role_allows(Role::SuperAdmin, Capability::ManageIam));
    assert!(rbac::role_allows(
        Role::SecOps,
        Capability::TripCircuitBreaker
    ));
    assert!(rbac::role_allows(
        Role::Treasury,
        Capability::ManageTreasury
    ));
    assert!(rbac::role_allows(
        Role::FleetDevops,
        Capability::SubscribeTelemetry
    ));
    assert!(rbac::role_allows(
        Role::AgentDeveloper,
        Capability::AuthorPolicy
    ));
    assert!(rbac::role_allows(Role::Auditor, Capability::ReadAudit));
    assert!(!rbac::role_allows(
        Role::Auditor,
        Capability::TripCircuitBreaker
    ));
    // Every role must be able to read its own identity/role record to
    // bootstrap a session, even one with no other capabilities granted.
    for role in [
        Role::SuperAdmin,
        Role::SecOps,
        Role::Treasury,
        Role::FleetDevops,
        Role::AgentDeveloper,
        Role::Auditor,
    ] {
        assert!(rbac::role_allows(role, Capability::ReadSelf));
    }
}

#[test]
fn rbac_grants_manage_credentials_and_authorization_policy_to_super_admin_and_sec_ops_only() {
    for role in [Role::SuperAdmin, Role::SecOps] {
        assert!(rbac::role_allows(role, Capability::ManageCredentials));
        assert!(rbac::role_allows(
            role,
            Capability::ManageAuthorizationPolicy
        ));
    }
    for role in [
        Role::Treasury,
        Role::FleetDevops,
        Role::AgentDeveloper,
        Role::Auditor,
    ] {
        assert!(!rbac::role_allows(role, Capability::ManageCredentials));
        assert!(!rbac::role_allows(
            role,
            Capability::ManageAuthorizationPolicy
        ));
    }
}

#[test]
fn api_key_capability_allowlist_rejects_iam_and_credential_actions() {
    for forbidden in [
        "iam.manage",
        "credentials.manage",
        "authorization_policy.manage",
        "self.read",
    ] {
        assert!(!is_assignable_api_key_capability(forbidden));
    }
    for allowed in [
        "fleet.read",
        "audit.read",
        "telemetry.subscribe",
        "policy.write",
        "circuit_breaker.trip",
        "treasury.manage",
        "settlement.dispatch",
    ] {
        assert!(is_assignable_api_key_capability(allowed));
    }
}

fn request_context(role: Role, mfa_authenticated: bool) -> RequestContext {
    RequestContext {
        subject: "did:privy:test".to_string(),
        role,
        platform_role: None,
        tenant: TenantContext {
            org_id: "org-test".to_string(),
            enterprise_address: Address::repeat_byte(0x44),
        },
        mfa_authenticated,
        identity_kind: IdentityKind::Privy,
        api_key_id: None,
        capabilities: Vec::new(),
        client_ip: Some("192.0.2.10".parse().unwrap()),
    }
}

#[test]
fn pbac_deny_precedes_allow_and_enforces_multisig() {
    let context = request_context(Role::Treasury, true);
    let allow = PbacPolicy {
        id: Uuid::now_v7(),
        org_id: "org-test".to_string(),
        version: 1,
        effect: PolicyEffect::Allow,
        principals: vec!["*".to_string()],
        actions: vec!["treasury.*".to_string()],
        resources: vec!["*".to_string()],
        conditions: PbacConditions {
            max_amount: Some(U256::from(10_000u64)),
            required_multisig_signatures: Some(2),
            eligible_approver_roles: vec![Role::Treasury],
            require_mfa: Some(true),
        },
    };
    let deny = PbacPolicy {
        id: Uuid::now_v7(),
        org_id: "org-test".to_string(),
        version: 2,
        effect: PolicyEffect::Deny,
        principals: vec!["*".to_string()],
        actions: vec!["treasury.*".to_string()],
        resources: vec!["*".to_string()],
        conditions: PbacConditions::default(),
    };
    let decision = pbac::evaluate(
        &[allow.clone(), deny],
        &context,
        PbacInput {
            action: "treasury.allocate",
            resource: "pool:1",
            amount: Some(U256::from(1_000u64)),
            approval_count: 2,
        },
    );
    assert!(!decision.allowed);
    let decision = pbac::evaluate(
        &[allow],
        &context,
        PbacInput {
            action: "treasury.allocate",
            resource: "pool:1",
            amount: Some(U256::from(1_000u64)),
            approval_count: 1,
        },
    );
    assert!(!decision.allowed);
}

#[test]
fn abac_rejects_unapproved_network_and_mfa() {
    let policy = AbacPolicy {
        allowed_cidrs: vec!["10.0.0.0/8".parse::<IpNet>().unwrap()],
        require_mfa: true,
        max_amount: None,
        max_gas_price: None,
        trading_start_hour_utc: 0,
        trading_end_hour_utc: 24,
        allowed_environments: vec![AgentEnvironment::Production],
        blocked_risk_tiers: vec![RiskTier::Tier1Critical],
    };
    let context = AbacContext {
        client_ip: "192.0.2.10".parse::<IpAddr>().unwrap(),
        amount: None,
        gas_price: None,
        environment: AgentEnvironment::Production,
        risk_tier: RiskTier::Tier2Standard,
        now: Utc::now(),
    };
    assert_eq!(
        abac::evaluate(&policy, &request_context(Role::Treasury, false), context),
        Err(agentguard_gateway::error::AccessReasonCode::MfaRequired)
    );
    assert_eq!(
        abac::evaluate(&policy, &request_context(Role::Treasury, true), context),
        Err(agentguard_gateway::error::AccessReasonCode::IpNotAllowed)
    );
}

#[tokio::test]
async fn unverified_privy_jwt_is_rejected_before_database_access() {
    let config = Config::test();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy(&config.database_url)
        .unwrap();
    let repository = PgRepository::new(pool);
    let auth = AuthService::new(config, reqwest::Client::new(), repository);
    let headers = axum::http::HeaderMap::from_iter([(
        axum::http::header::AUTHORIZATION,
        "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQifQ.invalid"
            .parse()
            .unwrap(),
    )]);
    let error = auth.authenticate(&headers, None).await.unwrap_err();
    assert_eq!(
        error.reason_code,
        agentguard_gateway::error::AccessReasonCode::Unauthenticated
    );
}

#[test]
fn finops_pricing_calculation_and_rate_cards_contract() {
    use agentguard_gateway::finops::{calculate_inference_spend, get_official_catalog};
    use agentguard_gateway::types::{PricingModelType, TenantPricingModel};
    use std::collections::HashMap;

    let catalog = get_official_catalog();
    assert!(catalog.iter().any(|c| c.model_id == "claude-3-7-sonnet"));
    assert!(catalog.iter().any(|c| c.model_id == "gpt-4o"));
    assert!(catalog.iter().any(|c| c.model_id == "qwen-max"));

    // Verify 100k input + 20k output on Claude 3.7 Sonnet ($3 / 1M in, $15 / 1M out)
    // 100,000 * $3 / 1M = $0.30 (300,000 micro-dollars)
    // 20,000 * $15 / 1M = $0.30 (300,000 micro-dollars)
    // Nominal = 600,000 micro-dollars
    let base_pricing = TenantPricingModel {
        org_id: "org_test".to_string(),
        model_type: PricingModelType::FlatDiscount,
        discount_bps: 2500, // 25% off
        volume_tiers: vec![],
        ptu_capacity_tokens: 0,
        custom_rates: HashMap::new(),
        monthly_tokens_consumed: 0,
        updated_at: "2026-09-17T00:00:00Z".to_string(),
    };

    let result = calculate_inference_spend("claude-3-7-sonnet", 100_000, 20_000, 0, 0, &base_pricing);
    assert_eq!(result.nominal_list_cost_micro_dollars, 600_000);
    assert_eq!(result.effective_cost_micro_dollars, 450_000); // 25% off 600,000 = 450,000
    assert_eq!(result.effective_discount_bps, 2500);

    // Verify PTU capacity mode
    let ptu_pricing = TenantPricingModel {
        org_id: "org_test".to_string(),
        model_type: PricingModelType::CommittedPtu,
        discount_bps: 0,
        volume_tiers: vec![],
        ptu_capacity_tokens: 500_000,
        custom_rates: HashMap::new(),
        monthly_tokens_consumed: 450_000,
        updated_at: "2026-09-17T00:00:00Z".to_string(),
    };

    // 100k requested: 50k absorbed by PTU ($0 marginal), 50k overage charged
    let ptu_result = calculate_inference_spend("gpt-4o", 50_000, 50_000, 0, 0, &ptu_pricing);
    assert_eq!(ptu_result.ptu_capacity_applied, 50_000);
    assert_eq!(ptu_result.ptu_overage_tokens, 50_000);
    assert!(ptu_result.effective_cost_micro_dollars < ptu_result.nominal_list_cost_micro_dollars);
}

#[test]
fn adr_0008_qwen_copilot_compilation_and_catalog_invariants() {
    use agentguard_gateway::qwen::compile_policy_from_prompt;
    use agentguard_gateway::finops::get_official_catalog;

    // Invariant 1: Qwen 3.8 Max is in the official catalog
    let catalog = get_official_catalog();
    let qwen_model = catalog.iter().find(|m| m.model_id == "qwen-max" || m.model_id.contains("qwen"));
    assert!(qwen_model.is_some(), "Qwen model must be present in enterprise catalog");
    assert_eq!(qwen_model.unwrap().provider, "alibaba");

    // Invariant 2: Natural language policy compilation parses velocity, window, limits, and whitelist
    let prompt = "Deploy high-velocity trading bot with 0.50 USDC per tx, max 5.00 USDC per hour, 10 tx/hr velocity, whitelisting 0x1234567890123456789012345678901234567890";
    let compiled = compile_policy_from_prompt(prompt);

    assert_eq!(compiled.max_per_tx, 500_000); // $0.50 = 500,000 base units (6 decimals)
    assert_eq!(compiled.max_per_window, 5_000_000); // $5.00 = 5,000,000 base units
    assert_eq!(compiled.window_seconds, 3600);
    assert_eq!(compiled.max_velocity, 10);
    assert!(compiled.whitelist_enabled);
    assert_eq!(compiled.suggested_merchants.len(), 1);
    assert_eq!(compiled.suggested_merchants[0], "0x1234567890123456789012345678901234567890");
    assert!(!compiled.explanation.is_empty());
}

#[test]
fn adr_0011_anthropic_messages_proxy_schema() {
    use agentguard_gateway::handlers::AnthropicMessagesRequest;

    let payload = serde_json::json!({
        "model": "claude-3-7-sonnet",
        "messages": [
            {"role": "user", "content": "Hello AgentGuard"}
        ],
        "max_tokens": 1024
    });

    let req: AnthropicMessagesRequest = serde_json::from_value(payload).expect("deserialize Anthropic payload");
    assert_eq!(req.model, "claude-3-7-sonnet");
    assert_eq!(req.max_tokens, Some(1024));
    assert_eq!(req.messages.len(), 1);
}

#[test]
fn erc7677_paymaster_rpc_schema_and_methods() {
    use agentguard_gateway::types::PaymasterRpcRequest;

    let stub_req_json = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "pm_getPaymasterStubData",
        "params": [
            {
                "sender": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "nonce": "0x0",
                "initCode": "0x",
                "callData": "0x",
                "callGasLimit": "0x10000",
                "verificationGasLimit": "0x186a0",
                "preVerificationGas": "0x5000",
                "maxFeePerGas": "0x3b9aca00",
                "maxPriorityFeePerGas": "0x3b9aca00"
            },
            "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
            "0x279f",
            {}
        ]
    });

    let rpc_req: PaymasterRpcRequest = serde_json::from_value(stub_req_json).expect("valid ERC-7677 JSON-RPC");
    assert_eq!(rpc_req.method, "pm_getPaymasterStubData");
    assert_eq!(rpc_req.id, 1);
}

#[test]
fn finops_distributed_sync_payload_and_reconciliation() {
    use agentguard_gateway::finops::{FinopsSyncPayload, DistributedFinopsSync};
    use agentguard_gateway::types::{TenantPricingModel, PricingModelType, VolumeTier};
    use std::collections::HashMap;

    let sync = DistributedFinopsSync::new();
    let mut pricing = TenantPricingModel {
        org_id: "org_multi_region".to_string(),
        model_type: PricingModelType::TieredVolume,
        discount_bps: 1000, // 10%
        volume_tiers: vec![
            VolumeTier { min_tokens: 5_000_000, discount_bps: 2500 }
        ],
        ptu_capacity_tokens: 0,
        custom_rates: HashMap::new(),
        monthly_tokens_consumed: 4_000_000,
        updated_at: "2026-09-17T00:00:00Z".to_string(),
    };

    let payload = FinopsSyncPayload {
        node_id: "eu-central-1-gateway".to_string(),
        org_id: "org_multi_region".to_string(),
        delta_tokens: 2_000_000,
        sync_timestamp: 1741500000,
        sequence_number: 42,
    };

    let rt = tokio::runtime::Runtime::new().unwrap();
    let res = rt.block_on(sync.process_sync(&payload, &mut pricing)).unwrap();

    assert!(res.synced);
    assert_eq!(res.reconciled_monthly_tokens, 6_000_000);
    assert_eq!(res.active_discount_bps, 2500); // Graduated to 25% bracket
    assert_eq!(res.current_tier_index, 1);
}

#[test]
fn streaming_sse_rejection_frame_formatting() {
    use agentguard_gateway::types::OnchainReasonCode;

    let code = OnchainReasonCode::KillSwitch;
    let json_data = serde_json::to_string(&serde_json::json!({
        "type": "error",
        "error": {
            "type": "policy_denied",
            "reason_code": code.as_u8(),
            "reason_name": code.as_str(),
            "message": code.message(),
            "remediation": code.remediation(),
            "window_reset_seconds": 3600
        }
    })).unwrap();

    let sse_payload = format!("event: error\ndata: {json_data}\n\ndata: [DONE]\n\n");
    assert!(sse_payload.starts_with("event: error\n"));
    assert!(sse_payload.contains("\"reason_code\":1"));
    assert!(sse_payload.contains("\"reason_name\":\"ERR_KILL_SWITCH\""));
    assert!(sse_payload.ends_with("data: [DONE]\n\n"));
}

#[test]
fn dispute_finalization_readiness_evaluation() {
    use agentguard_gateway::chain::ChainClient;

    // Challenge block 1000, challenge cooldown 200 blocks
    let challenge_block = 1000;

    // Block 1100: not ready (only 100 blocks elapsed)
    assert!(!ChainClient::check_dispute_finalization_readiness(1100, challenge_block));

    // Block 1199: not ready (199 blocks elapsed)
    assert!(!ChainClient::check_dispute_finalization_readiness(1199, challenge_block));

    // Block 1200: ready (exact 200 blocks elapsed)
    assert!(ChainClient::check_dispute_finalization_readiness(1200, challenge_block));

    // Block 1500: ready (500 blocks elapsed)
    assert!(ChainClient::check_dispute_finalization_readiness(1500, challenge_block));
}



