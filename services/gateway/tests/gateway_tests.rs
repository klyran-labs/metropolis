
use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use axum::http::HeaderMap;
use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD};
use base64::Engine;

use agentguard_gateway::config::Config;
use agentguard_gateway::crypto::{
    compute_domain_separator, compute_eip712_digest, compute_spend_request_hash,
    parse_x402_authorization_header, recover_signer,
};
use agentguard_gateway::privy::{authenticate_caller, decode_jwt_payload};
use agentguard_gateway::types::{ReasonCode, SpendRequest, SpendRequestWire, X402AuthorizationPayload};

#[test]
fn test_invariant_4_reason_codes() {
    let test_cases = [
        (0u8, ReasonCode::None, "ERR_NONE"),
        (1, ReasonCode::KillSwitch, "ERR_KILL_SWITCH"),
        (2, ReasonCode::ExceedsMaxPerTx, "ERR_EXCEEDS_MAX_PER_TX"),
        (3, ReasonCode::ExceedsMaxPerWindow, "ERR_EXCEEDS_MAX_PER_WINDOW"),
        (4, ReasonCode::VelocityExceeded, "ERR_VELOCITY_EXCEEDED"),
        (5, ReasonCode::MerchantNotWhitelisted, "ERR_MERCHANT_NOT_WHITELISTED"),
        (6, ReasonCode::BudgetDepleted, "ERR_BUDGET_DEPLETED"),
        (7, ReasonCode::Uncalibrated, "ERR_UNCALIBRATED"),
        (8, ReasonCode::Expired, "ERR_EXPIRED"),
        (9, ReasonCode::SignatureInvalid, "ERR_SIGNATURE_INVALID"),
        (10, ReasonCode::Custom, "ERR_CUSTOM"),
    ];

    for (code_num, expected_enum, expected_str) in test_cases {
        let parsed = ReasonCode::from_u8(code_num);
        assert_eq!(parsed, expected_enum);
        assert_eq!(parsed.as_u8(), code_num);
        assert_eq!(parsed.as_str(), expected_str);
        assert!(!parsed.message().is_empty());
        assert!(!parsed.remediation().is_empty());
    }
}

#[test]
fn test_domain_separator_and_struct_hash() {
    let chain_id = 10143u64;
    let guard_address = Address::repeat_byte(0x42);

    let domain_sep = compute_domain_separator(chain_id, guard_address);
    assert_ne!(domain_sep, B256::ZERO);

    let req = SpendRequest {
        agent: Address::repeat_byte(0x11),
        merchant: Address::repeat_byte(0x22),
        amount: U256::from(1000000),
        category: keccak256(b"compute_ai"),
        timestamp: U256::from(1726000000),
        deadline: U256::from(1726003600),
        nonce: 1,
    };

    let struct_hash = compute_spend_request_hash(&req);
    assert_ne!(struct_hash, B256::ZERO);

    let digest = compute_eip712_digest(domain_sep, struct_hash);
    assert_ne!(digest, B256::ZERO);
}

#[test]
fn test_eip712_signature_recovery() {
    // Generate a random signer
    let signer = PrivateKeySigner::random();
    let agent_address = signer.address();

    let chain_id = 10143u64;
    let guard_address = Address::repeat_byte(0x33);
    let domain_sep = compute_domain_separator(chain_id, guard_address);

    let req = SpendRequest {
        agent: agent_address,
        merchant: Address::repeat_byte(0x44),
        amount: U256::from(5000000),
        category: keccak256(b"storage"),
        timestamp: U256::from(1726000000),
        deadline: U256::from(1726003600),
        nonce: 42,
    };

    let struct_hash = compute_spend_request_hash(&req);
    let digest = compute_eip712_digest(domain_sep, struct_hash);

    // Sign the digest
    let signature = signer.sign_hash_sync(&digest).expect("Failed to sign hash");
    let sig_bytes = signature.as_bytes();
    assert_eq!(sig_bytes.len(), 65);

    // Recover using gateway crypto function
    let recovered = recover_signer(digest, &sig_bytes).expect("Failed to recover signer");
    assert_eq!(recovered, agent_address);

    // Verify corrupted signature fails or returns wrong address
    let mut corrupted_sig = sig_bytes;
    corrupted_sig[10] ^= 0xff;
    let corrupted_result = recover_signer(digest, &corrupted_sig);
    if let Ok(corrupted_address) = corrupted_result {
        assert_ne!(corrupted_address, agent_address);
    }
}

#[test]
fn test_x402_authorization_payload_parsing() {
    let wire = SpendRequestWire {
        agent: "0x1111111111111111111111111111111111111111".to_string(),
        merchant: "0x2222222222222222222222222222222222222222".to_string(),
        amount: "1000000".to_string(),
        category: "0x3333333333333333333333333333333333333333333333333333333333333333".to_string(),
        timestamp: "1726000000".to_string(),
        deadline: "1726003600".to_string(),
        nonce: "1".to_string(),
    };

    let dummy_sig = "0x".to_string() + &"aa".repeat(65);
    let payload = X402AuthorizationPayload {
        request: wire,
        signature: dummy_sig,
    };

    let json_bytes = serde_json::to_vec(&payload).unwrap();
    let b64 = BASE64.encode(&json_bytes);

    let auth_header = format!("x402 {}", b64);
    let (parsed_req, parsed_sig) = parse_x402_authorization_header(&auth_header)
        .expect("Should parse x402 header successfully");

    assert_eq!(parsed_req.amount, U256::from(1000000));
    assert_eq!(parsed_req.nonce, 1);
    assert_eq!(parsed_sig.len(), 65);
    assert_eq!(parsed_sig[0], 0xaa);
}

#[test]
fn test_privy_jwt_and_super_admin_auth() {
    // 1. Construct simulated JWT
    let payload_json = serde_json::json!({
        "sub": "did:privy:cm7admin123456",
        "iss": "privy.io",
        "aud": "cmton65ao004l0cl11tgmwiah",
        "custom_metadata": {
            "role": "super_admin"
        }
    });

    let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload_json).unwrap());
    let token = format!("header.{}.signature", payload_b64);

    let decoded = decode_jwt_payload(&token).expect("Failed to decode JWT payload");
    assert_eq!(decoded.sub.as_deref(), Some("did:privy:cm7admin123456"));

    let config = Config {
        port: 8080,
        chain_id: 10143,
        rpc_url: "https://testnet-rpc.monad.xyz".to_string(),
        policy_engine_address: Address::ZERO,
        reputation_registry_address: Address::ZERO,
        agent_wallet_guard_address: Address::ZERO,
        usdc_token_address: Address::ZERO,
        merchant_address: Address::ZERO,
        relayer_private_key: None,
        privy_app_id: "cmton65ao004l0cl11tgmwiah".to_string(),
        privy_app_secret: Some("test_secret_key_123".to_string()),
        initial_super_admin_dids: vec!["did:privy:bootstrapped_super_admin".to_string()],
    };

    // Test token auth
    let mut headers = HeaderMap::new();
    headers.insert("privy-id-token", token.parse().unwrap());
    let auth = authenticate_caller(&headers, &config).expect("Caller should authenticate");
    assert!(auth.is_super_admin);
    assert_eq!(auth.did, "did:privy:cm7admin123456");

    // Test secret auth
    let mut secret_headers = HeaderMap::new();
    secret_headers.insert("x-admin-secret", "test_secret_key_123".parse().unwrap());
    let secret_auth = authenticate_caller(&secret_headers, &config)
        .expect("Admin secret should authenticate");
    assert!(secret_auth.is_super_admin);

    // Test initial allowlist DID auth
    let mut did_headers = HeaderMap::new();
    did_headers.insert("x-caller-did", "did:privy:bootstrapped_super_admin".parse().unwrap());
    let did_auth = authenticate_caller(&did_headers, &config)
        .expect("Allowlist DID should authenticate");
    assert!(did_auth.is_super_admin);

    // Test unauthorized
    let empty_headers = HeaderMap::new();
    let unauth = authenticate_caller(&empty_headers, &config);
    assert!(unauth.is_err());
}
