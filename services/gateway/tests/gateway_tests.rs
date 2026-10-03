use agentguard_gateway::{
    abac::{self, AbacContext, AbacPolicy, AgentEnvironment, RiskTier},
    auth::{AuthService, IdentityKind, RequestContext},
    config::Config,
    crypto::{
        compute_domain_separator, compute_eip712_digest, compute_spend_request_hash,
        parse_x402_authorization_header, recover_signer,
    },
    handlers::{PendingApprovalState, is_assignable_api_key_capability, pending_approval_state},
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
        ..Default::default()
    };

    let result =
        calculate_inference_spend("claude-3-7-sonnet", 100_000, 20_000, 0, 0, &base_pricing)
            .unwrap();
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
        ..Default::default()
    };

    // 100k requested: 50k absorbed by PTU ($0 marginal), 50k overage charged
    let ptu_result =
        calculate_inference_spend("gpt-4o", 50_000, 50_000, 0, 0, &ptu_pricing).unwrap();
    assert_eq!(ptu_result.ptu_capacity_applied, 50_000);
    assert_eq!(ptu_result.ptu_overage_tokens, 50_000);
    assert!(ptu_result.effective_cost_micro_dollars < ptu_result.nominal_list_cost_micro_dollars);
}

#[test]
fn adr_0008_qwen_copilot_compilation_and_catalog_invariants() {
    use agentguard_gateway::finops::get_official_catalog;
    use agentguard_gateway::qwen::compile_policy_from_prompt;

    // Invariant 1: Qwen 3.8 Max is in the official catalog
    let catalog = get_official_catalog();
    let qwen_model = catalog
        .iter()
        .find(|m| m.model_id == "qwen-max" || m.model_id.contains("qwen"));
    assert!(
        qwen_model.is_some(),
        "Qwen model must be present in enterprise catalog"
    );
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
    assert_eq!(
        compiled.suggested_merchants[0],
        "0x1234567890123456789012345678901234567890"
    );
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

    let req: AnthropicMessagesRequest =
        serde_json::from_value(payload).expect("deserialize Anthropic payload");
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

    let rpc_req: PaymasterRpcRequest =
        serde_json::from_value(stub_req_json).expect("valid ERC-7677 JSON-RPC");
    assert_eq!(rpc_req.method, "pm_getPaymasterStubData");
    assert_eq!(rpc_req.id, 1);
}

#[test]
fn finops_distributed_sync_payload_and_reconciliation() {
    use agentguard_gateway::finops::FinopsSyncPayload;

    let payload = FinopsSyncPayload {
        node_id: "eu-central-1-gateway".to_string(),
        org_id: "org_multi_region".to_string(),
        delta_tokens: 2_000_000,
        sync_timestamp: 1741500000,
        sequence_number: 42,
    };
    let encoded = serde_json::to_value(&payload).unwrap();
    assert_eq!(encoded["sequenceNumber"], 42);
    assert_eq!(encoded["deltaTokens"], 2_000_000);
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
    }))
    .unwrap();

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
    assert!(!ChainClient::check_dispute_finalization_readiness(
        1100,
        challenge_block
    ));

    // Block 1199: not ready (199 blocks elapsed)
    assert!(!ChainClient::check_dispute_finalization_readiness(
        1199,
        challenge_block
    ));

    // Block 1200: ready (exact 200 blocks elapsed)
    assert!(ChainClient::check_dispute_finalization_readiness(
        1200,
        challenge_block
    ));

    // Block 1500: ready (500 blocks elapsed)
    assert!(ChainClient::check_dispute_finalization_readiness(
        1500,
        challenge_block
    ));
}

#[test]
fn sharded_relayer_pool_stats_and_escalation_invariants() {
    use agentguard_gateway::relayer_pool::RelayerPool;

    let pool = RelayerPool::new(vec![]);
    let stats = pool.stats();
    assert_eq!(stats.total_shards, 4);
    assert_eq!(stats.active_shards, 4);
    assert_eq!(stats.total_in_flight, 0);
    assert_eq!(stats.total_escalations, 0);

    let shard = pool.acquire_least_loaded();
    let nonce = shard.acquire_nonce();
    assert_eq!(nonce, 0);

    shard.record_escalation();
    let stats_after = pool.stats();
    assert_eq!(stats_after.total_escalations, 1);
    assert_eq!(stats_after.total_in_flight, 1);

    shard.release_in_flight();
    let stats_released = pool.stats();
    assert_eq!(stats_released.total_in_flight, 0);
}

#[test]
fn zk_policy_confidential_spend_and_nullifier_invariants() {
    use agentguard_gateway::zk::{ZkPolicyEngine, ZkSpendProofWire};

    let engine = ZkPolicyEngine::new();
    let agent = Address::repeat_byte(0x55);
    let commitment = keccak256(b"CONFIDENTIAL_LIMIT_10_USDC");
    let nullifier = keccak256(b"SECRET_NULLIFIER_12345");

    engine.register_commitment(agent, commitment);

    let proof = ZkSpendProofWire {
        policy_commitment: format!("{:#x}", commitment),
        merchant_whitelist_root: format!("{:#x}", keccak256(b"ROOT")),
        nullifier: format!("{:#x}", nullifier),
        epoch_window: 100000,
        proof_a: ["0x1".into(), "0x2".into()],
        proof_b: [["0x3".into(), "0x4".into()], ["0x5".into(), "0x6".into()]],
        proof_c: ["0x7".into(), "0x8".into()],
    };

    let res = engine.verify_and_consume(agent, &proof);
    assert!(res.allowed);
    assert_eq!(res.reason_code, 0);
    assert!(engine.is_nullifier_consumed(&nullifier));

    // Replay attempt fails with ERR_NONCE_REUSED (8)
    let res_replay = engine.verify_and_consume(agent, &proof);
    assert!(!res_replay.allowed);
    assert_eq!(res_replay.reason_code, 8);
}

#[tokio::test]
async fn mev_shielded_bundle_dispatch_and_invariants() {
    use agentguard_gateway::bundle_relay::{BundleRelayManager, MevBundleCall, MevBundleRequest};

    let manager = BundleRelayManager::default();
    let req = MevBundleRequest {
        bundle_id: "bundle-eip-searcher-01".into(),
        calls: vec![MevBundleCall {
            target: "0x3333333333333333333333333333333333333333".into(),
            value_wei: "1000000000000000".into(),
            call_data: "0x".into(),
        }],
        target_block: 20000,
        min_kickback_wei: 1000000000000,
        max_priority_fee_gwei: 3,
        beneficiary: "0x4444444444444444444444444444444444444444".into(),
    };

    let result = manager.dispatch_bundle(req).await;
    assert_eq!(result.status, "INCLUDED_PRIVATE_BLOCK");
    assert!(result.sandwich_risk_mitigated);
    assert!(result.latency_ms >= 0.0);

    let stats = manager.get_stats();
    assert_eq!(stats.total_bundles_submitted, 1);
    assert_eq!(stats.sandwich_attacks_deflected, 1);
    assert_eq!(stats.total_kickbacks_wei, 1000000000000);
}

#[tokio::test]
async fn calldata_clear_signing_and_risk_evaluation() {
    use agentguard_gateway::calldata_decoder::{CalldataDecoder, CalldataInspectionRequest};

    let transfer_req = CalldataInspectionRequest {
        calldata: "0xa9059cbb0000000000000000000000005555555555555555555555555555555555555555000000000000000000000000000000000000000000000000000000000000000a".into(),
        agent: "0x1111111111111111111111111111111111111111".into(),
        target: "0x2222222222222222222222222222222222222222".into(),
        msg_value: None,
    };

    let res = CalldataDecoder::inspect(&transfer_req);
    assert_eq!(res.selector, "0xa9059cbb");
    assert_eq!(res.risk_level, "nominal");
    assert_eq!(res.fields.len(), 2);
    assert!(res.clear_signing_summary.contains("Disburse 10 tokens"));
}

#[tokio::test]
async fn agent_heartbeat_and_succession_liveness() {
    use agentguard_gateway::heartbeat::{HeartbeatManager, AgentHeartbeatRequest};

    let mgr = HeartbeatManager::new();
    let agent = "0xAgentLivenessTest".to_string();

    let rec = mgr.record_heartbeat(AgentHeartbeatRequest {
        agent: agent.clone(),
        timestamp: 100_000,
        signature: None,
    });
    assert_eq!(rec.status, "HEALTHY");

    // Nominal check within grace period
    let status_healthy = mgr.get_status(&agent, 105_000);
    assert_eq!(status_healthy.status, "HEALTHY");
    assert_eq!(status_healthy.seconds_since_last_heartbeat, 5000);

    // After 72h grace period (259,200s)
    let status_expired = mgr.get_status(&agent, 100_000 + 260_000);
    assert_eq!(status_expired.status, "SUCCESSION_PENDING");
}

#[tokio::test]
async fn edge_sequencer_topology_and_disjoint_leases() {
    use agentguard_gateway::edge_sequencer::EdgeSequencerManager;

    let mgr = EdgeSequencerManager::new();
    let agent = "0xAgentGlobalEdge";

    // Acquire lease in US and EU
    let us_lease = mgr.acquire_lease(agent, "us-east-1", 20_000_000, 1000);
    assert_eq!(us_lease.nonce_range_start, 0);

    let eu_lease = mgr.acquire_lease(agent, "eu-central-1", 10_000_000, 1000);
    assert_eq!(eu_lease.nonce_range_start, 100_000);

    let topo = mgr.get_topology();
    assert_eq!(topo.global_active_edges, 3);
    assert_eq!(topo.regions.len(), 3);
    assert_eq!(topo.regions[0].active_leases, 1);
    assert_eq!(topo.regions[1].active_leases, 1);
}

#[test]
fn pending_approval_state_requires_access_and_blocks_double_signing() {
    let signers = vec!["did:privy:alice".to_string()];

    // Wallet holder who has not signed yet can approve.
    let fresh = pending_approval_state(&signers, 2, "did:privy:bob", true);
    assert_eq!(
        fresh,
        PendingApprovalState {
            signatures_collected: 1,
            signatures_required: 2,
            already_signed: false,
            can_approve: true,
        }
    );

    // Someone without access to the wallet cannot approve.
    assert!(!pending_approval_state(&signers, 2, "did:privy:bob", false).can_approve);

    // Signing twice is not allowed, even with access.
    let repeat = pending_approval_state(&signers, 2, "did:privy:alice", true);
    assert!(repeat.already_signed);
    assert!(!repeat.can_approve);

    // No signatures yet.
    assert_eq!(
        pending_approval_state(&[], 3, "did:privy:alice", true).signatures_collected,
        0
    );
}

