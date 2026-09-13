use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use reqwest::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{error, info, warn};

use alloy::primitives::U256;
use alloy::providers::ProviderBuilder;

use crate::config::Config;
use crate::crypto::{
    compute_domain_separator, compute_eip712_digest, compute_spend_request_hash,
    parse_x402_authorization_header, recover_signer,
};
use crate::privy::{authenticate_caller, get_privy_user, update_privy_custom_metadata};
use crate::types::{
    IPolicyEngine, ReasonCode, RoleResponse, UpdateRoleRequest, X402Challenge,
    X402ChallengeDetails, X402PolicyRejectionBody,
};

pub struct AppState {
    pub config: Config,
    pub http_client: Client,
    pub local_roles: RwLock<HashMap<String, Value>>,
}

pub type SharedState = Arc<AppState>;

pub async fn health_handler(State(state): State<SharedState>) -> Json<Value> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    Json(serde_json::json!({
        "status": "healthy",
        "service": "agentguard-gateway",
        "version": "1.0.0",
        "network": "monad-testnet",
        "chainId": state.config.chain_id,
        "policyEngine": format!("{:#x}", state.config.policy_engine_address),
        "agentWalletGuard": format!("{:#x}", state.config.agent_wallet_guard_address),
        "merchant": format!("{:#x}", state.config.merchant_address),
        "timestamp": now
    }))
}

pub async fn ready_handler(State(state): State<SharedState>) -> impl IntoResponse {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ready": true,
            "chainId": state.config.chain_id,
            "timestamp": now
        })),
    )
}

/// Core x402 Inference Handler with Monad EVM Policy Evaluation
pub async fn inference_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Response {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Check for Authorization header
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());

    let auth_str = match auth_header {
        Some(h) if !h.trim().is_empty() => h,
        _ => {
            // Return HTTP 402 Payment Required Challenge
            let challenge = X402Challenge {
                standard: "x402".to_string(),
                version: "1.0".to_string(),
                network: "monad-testnet".to_string(),
                chain_id: state.config.chain_id,
                challenge: X402ChallengeDetails {
                    pay_to: format!("{:#x}", state.config.merchant_address),
                    amount_wei: "1000000".to_string(), // 1.000000 USDC (6 decimals)
                    token: format!("{:#x}", state.config.usdc_token_address),
                    service_id: "agentguard.inference.v1".to_string(),
                    category: "compute_ai".to_string(),
                    description: "High-throughput autonomous agent inference query".to_string(),
                },
            };

            return (
                StatusCode::PAYMENT_REQUIRED,
                [
                    ("WWW-Authenticate", "x402"),
                    ("X-402-Payment-Required", "true"),
                ],
                Json(challenge),
            )
                .into_response();
        }
    };

    // 1. Parse x402 Authorization payload
    let (req, sig_bytes) = match parse_x402_authorization_header(auth_str) {
        Ok(parsed) => parsed,
        Err(err) => {
            warn!("Failed to parse x402 authorization: {}", err);
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "ERR_INVALID_X402_PAYLOAD",
                    "message": err
                })),
            )
                .into_response();
        }
    };

    // 2. Cryptographic EIP-712 Verification
    let domain_sep = compute_domain_separator(
        state.config.chain_id,
        state.config.agent_wallet_guard_address,
    );
    let struct_hash = compute_spend_request_hash(&req);
    let digest = compute_eip712_digest(domain_sep, struct_hash);

    let recovered_agent = match recover_signer(digest, &sig_bytes) {
        Ok(signer) => signer,
        Err(err) => {
            warn!("EIP-712 signature recovery failed: {}", err);
            return make_rejection_response(
                StatusCode::FORBIDDEN,
                ReasonCode::SignatureInvalid,
                &format!("{:#x}", req.agent),
                state.config.chain_id,
            );
        }
    };

    if recovered_agent != req.agent {
        warn!(
            "Signer mismatch: recovered {:#x} != req.agent {:#x}",
            recovered_agent, req.agent
        );
        return make_rejection_response(
            StatusCode::FORBIDDEN,
            ReasonCode::SignatureInvalid,
            &format!("{:#x}", req.agent),
            state.config.chain_id,
        );
    }

    // 3. Invariant Checks: Deadline & Merchant
    if req.deadline < U256::from(now) {
        return make_rejection_response(
            StatusCode::FORBIDDEN,
            ReasonCode::Expired,
            &format!("{:#x}", req.agent),
            state.config.chain_id,
        );
    }

    if req.merchant != state.config.merchant_address {
        return make_rejection_response(
            StatusCode::FORBIDDEN,
            ReasonCode::MerchantNotWhitelisted,
            &format!("{:#x}", req.agent),
            state.config.chain_id,
        );
    }

    // 4. Onchain Policy Engine Simulation via Alloy RPC
    let rpc_url: reqwest::Url = match state.config.rpc_url.parse() {
        Ok(u) => u,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Invalid MONAD_RPC_URL" })),
            )
                .into_response();
        }
    };

    let provider = ProviderBuilder::new().on_http(rpc_url);
    let policy_engine = IPolicyEngine::new(state.config.policy_engine_address, &provider);

    match policy_engine.evaluate(req.clone()).call().await {
        Ok(decision) => {
            if !decision.allowed {
                let code = ReasonCode::from_u8(decision.reasonCode);
                return make_rejection_response(
                    StatusCode::FORBIDDEN,
                    code,
                    &format!("{:#x}", req.agent),
                    state.config.chain_id,
                );
            }

            // Allowed! Return successful response
            info!(
                "x402 payment approved for agent {:#x}, amount {}",
                req.agent, req.amount
            );

            let input_payload = body.map(|b| b.0).unwrap_or_default();

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "success",
                    "message": "Payment verified and settled under Monad parallel EVM policy invariants.",
                    "inference": {
                        "result": "AgentGuard institutional policy verified. Inference generated with sub-millisecond safety.",
                        "tokensProcessed": 128,
                        "latencyMs": 0.38,
                        "echo": input_payload
                    },
                    "receipt": {
                        "agent": format!("{:#x}", req.agent),
                        "merchant": format!("{:#x}", req.merchant),
                        "amount": req.amount.to_string(),
                        "nonce": req.nonce,
                        "reasonCode": 0,
                        "status": "SETTLED_MONAD_PARALLEL_EVM",
                        "timestamp": now
                    }
                })),
            )
                .into_response()
        }
        Err(err) => {
            error!("PolicyEngine RPC call failed: {}", err);
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": "ERR_MONAD_RPC_FAILED",
                    "message": format!("Failed to evaluate policy on Monad RPC: {}", err)
                })),
            )
                .into_response()
        }
    }
}

fn make_rejection_response(
    status: StatusCode,
    code: ReasonCode,
    agent: &str,
    chain_id: u64,
) -> Response {
    let rejection = X402PolicyRejectionBody {
        error: code.as_str().to_string(),
        reason_code: code.as_u8(),
        message: code.message().to_string(),
        remediation: code.remediation().to_string(),
        agent: agent.to_string(),
        network: "monad-testnet".to_string(),
        chain_id,
        evaluated_at: chrono::Utc::now().to_rfc3339(),
    };

    (
        status,
        [("X-AgentGuard-Reason-Code", code.as_u8().to_string())],
        Json(rejection),
    )
        .into_response()
}

// ----------------------------------------------------------------------------
// Privy Role Administration Handlers
// ----------------------------------------------------------------------------

const VALID_ROLES: &[&str] = &[
    "super_admin",
    "treasury_manager",
    "risk_officer",
    "sec_ops",
    "compliance_auditor",
    "developer",
    "viewer",
];

pub async fn get_user_role_handler(
    State(state): State<SharedState>,
    Path(did): Path<String>,
    headers: HeaderMap,
) -> Response {
    // Authenticate caller
    let caller = match authenticate_caller(&headers, &state.config) {
        Ok(c) => c,
        Err((code, msg)) => {
            return (code, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    };

    // Caller can query if super admin or if querying themselves
    if !caller.is_super_admin && caller.did != did {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Forbidden: Cannot query roles for other operators."
            })),
        )
            .into_response();
    }

    // Check local store first (for local dev / tests)
    {
        let local = state.local_roles.read().unwrap();
        if let Some(data) = local.get(&did) {
            let role = data
                .get("role")
                .and_then(|r| r.as_str())
                .unwrap_or("viewer");
            return (
                StatusCode::OK,
                Json(RoleResponse {
                    success: true,
                    did: did.clone(),
                    role: role.to_string(),
                    custom_metadata: data.clone(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                }),
            )
                .into_response();
        }
    }

    // If DID is in initial super admin list, default to super_admin
    if state.config.initial_super_admin_dids.contains(&did) {
        return (
            StatusCode::OK,
            Json(RoleResponse {
                success: true,
                did: did.clone(),
                role: "super_admin".to_string(),
                custom_metadata: serde_json::json!({ "role": "super_admin" }),
                updated_at: chrono::Utc::now().to_rfc3339(),
            }),
        )
            .into_response();
    }

    // Fetch from Privy Server API if app_secret is set
    if state.config.privy_app_secret.is_some() {
        match get_privy_user(&state.http_client, &state.config, &did).await {
            Ok(user_json) => {
                let custom_metadata = user_json
                    .get("custom_metadata")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                let role = custom_metadata
                    .get("role")
                    .and_then(|r| r.as_str())
                    .unwrap_or("viewer")
                    .to_string();

                return (
                    StatusCode::OK,
                    Json(RoleResponse {
                        success: true,
                        did: did.clone(),
                        role,
                        custom_metadata,
                        updated_at: chrono::Utc::now().to_rfc3339(),
                    }),
                )
                    .into_response();
            }
            Err((code, msg)) => {
                return (code, Json(serde_json::json!({ "error": msg }))).into_response();
            }
        }
    }

    // Fallback: default to viewer
    (
        StatusCode::OK,
        Json(RoleResponse {
            success: true,
            did: did.clone(),
            role: "viewer".to_string(),
            custom_metadata: serde_json::json!({ "role": "viewer" }),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }),
    )
        .into_response()
}

pub async fn update_user_role_handler(
    State(state): State<SharedState>,
    Path(did): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<UpdateRoleRequest>,
) -> Response {
    // 1. Authenticate caller: Must be Super Admin!
    let caller = match authenticate_caller(&headers, &state.config) {
        Ok(c) => c,
        Err((code, msg)) => {
            return (code, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    };

    if !caller.is_super_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Forbidden: Only super_admin can update operator roles."
            })),
        )
            .into_response();
    }

    let role_lower = payload.role.to_lowercase();
    if !VALID_ROLES.contains(&role_lower.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": format!("Invalid role '{}'. Allowed roles: {:?}", payload.role, VALID_ROLES)
            })),
        )
            .into_response();
    }

    let updated_by = format!("gateway:{}", caller.did);

    // 2. If Privy App Secret is configured, propagate to Privy Server API
    let meta_json = if state.config.privy_app_secret.is_some() {
        match update_privy_custom_metadata(
            &state.http_client,
            &state.config,
            &did,
            &role_lower,
            payload.permissions.as_ref(),
            &updated_by,
        )
        .await
        {
            Ok(val) => val
                .get("custom_metadata")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({ "role": role_lower })),
            Err((code, msg)) => {
                return (code, Json(serde_json::json!({ "error": msg }))).into_response();
            }
        }
    } else {
        // Local mode fallback
        let mut obj = serde_json::json!({
            "role": role_lower,
            "updatedAt": chrono::Utc::now().to_rfc3339(),
            "updatedBy": updated_by,
        });
        if let Some(ref p) = payload.permissions {
            obj.as_object_mut()
                .unwrap()
                .insert("permissions".to_string(), p.clone());
        }
        obj
    };

    // Store in local cache
    {
        let mut local = state.local_roles.write().unwrap();
        local.insert(did.clone(), meta_json.clone());
    }

    info!(
        "Updated role for DID {} to {} by caller {}",
        did, role_lower, caller.did
    );

    (
        StatusCode::OK,
        Json(RoleResponse {
            success: true,
            did,
            role: role_lower,
            custom_metadata: meta_json,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }),
    )
        .into_response()
}

// ----------------------------------------------------------------------------
// ERC-7677 Paymaster RPC Handler
// ----------------------------------------------------------------------------

pub async fn paymaster_rpc_handler(
    State(state): State<SharedState>,
    Json(payload): Json<crate::types::PaymasterRpcRequest>,
) -> impl IntoResponse {
    let id = payload.id;
    match payload.method.as_str() {
        "pm_supportedEntryPoints" => {
            let entry_points = vec![
                "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
                "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
            ];
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": entry_points
                })),
            )
        }
        "pm_getPaymasterStubData" => {
            let guard_addr = format!("{:#x}", state.config.agent_wallet_guard_address);
            let paymaster_data = format!("0x{:0>64}", "01");
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "sponsor": true,
                        "paymaster": guard_addr,
                        "paymasterData": paymaster_data,
                        "paymasterVerificationGasLimit": "0x186a0",
                        "paymasterPostOpGasLimit": "0xc350"
                    }
                })),
            )
        }
        "pm_getPaymasterData" => {
            let guard_addr = format!("{:#x}", state.config.agent_wallet_guard_address);
            let paymaster_and_data = format!("{}0000000000000000000000000000000000000000000000000000000000000001", guard_addr);
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "paymasterAndData": paymaster_and_data
                    }
                })),
            )
        }
        _ => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Method '{}' not found", payload.method)
                }
            })),
        ),
    }
}

