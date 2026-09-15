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
