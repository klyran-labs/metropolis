use crate::{
    abac::{self, AbacContext, AgentEnvironment, RiskTier},
    auth::{AuthService, RequestContext, client_ip},
    chain::ChainClient,
    config::Config,
    error::{AccessReasonCode, ApiError},
    pbac::{self, PbacInput},
    rbac::{self, Capability, PlatformCapability, Role},
    repository::PgRepository,
    telemetry::EventHub,
    types::{
        CheckoutRequest, CreatePlanRequest, CreateSigningWalletRequest, CreateTenantRequest,
        OnchainReasonCode, PaymentSubmissionRequest, PlanResponse, PlatformOperatorRequest,
        PolicyUpdateRequest, RegisterAgentRequest, RoleResponse, UpdateRoleRequest, X402Challenge,
        X402ChallengeDetails, X402PolicyRejectionBody,
    },
};
use alloy::primitives::{Address, U256, keccak256};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use chrono::{Duration, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{convert::Infallible, str::FromStr, sync::Arc};
use tracing::warn;
use uuid::Uuid;

pub struct AppState {
    pub config: Config,
    pub http_client: reqwest::Client,
    pub repository: PgRepository,
    pub auth: AuthService,
    pub chain: ChainClient,
    pub events: EventHub,
}

pub type SharedState = Arc<AppState>;

pub async fn authentication_middleware(
    State(state): State<SharedState>,
    mut request: axum::extract::Request,
    next: Next,
) -> Response {
    let ip = client_ip(&request, state.config.trust_proxy_headers);
    let context = match state.auth.authenticate(request.headers(), ip).await {
        Ok(context) => context,
        Err(error) => return error.into_response(),
    };
    request.extensions_mut().insert(context);
    next.run(request).await
}

pub async fn authorization_middleware(
    State(state): State<SharedState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let Some(context) = request.extensions().get::<RequestContext>().cloned() else {
        return ApiError::new(
            StatusCode::UNAUTHORIZED,
            AccessReasonCode::Unauthenticated,
            "Authentication is required.",
            "Provide a valid operator identity or machine credential.",
        )
        .into_response();
    };
    let path = request.uri().path();
    if let Some(capability) = platform_capability(request.method(), path) {
        let authorized = context
            .platform_role
            .is_some_and(|role| rbac::platform_role_allows(role, capability));
        if !authorized {
            return ApiError::new(
                StatusCode::FORBIDDEN,
                AccessReasonCode::RoleForbidden,
                "The platform identity is not authorized for this action.",
                "Request the required platform capability from a platform administrator.",
            )
            .into_response();
        }
        return next.run(request).await;
    }
    let (capability, action) = required_capability(request.method(), path);
    let authorized = match context.identity_kind {
        crate::auth::IdentityKind::ApiKey => {
            context.capabilities.iter().any(|value| value == action)
        }
        crate::auth::IdentityKind::Privy => rbac::role_allows(context.role, capability),
    };
    if !authorized {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            AccessReasonCode::RoleForbidden,
            "The identity is not authorized for this action.",
            "Request the required capability from an organization administrator.",
        )
        .into_response();
    }

    let policies = match state
        .repository
        .load_pbac_policies(&context.tenant.org_id)
        .await
    {
        Ok(policies) => policies,
        Err(error) => {
            warn!(error = %error, "PBAC policy lookup failed");
            return ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "Authorization policy services are temporarily unavailable.",
                "Retry after the policy store is healthy.",
            )
            .into_response();
        }
    };
    let pbac_decision = pbac::evaluate(
        &policies,
        &context,
        PbacInput {
            action,
            resource: request.uri().path(),
            amount: None,
            approval_count: 0,
        },
    );
    if !pbac_decision.allowed {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            pbac_decision
                .reason_code
                .unwrap_or(AccessReasonCode::PolicyDenied),
            "The organization policy denied this action.",
            "Review the active organization policy or request approval.",
        )
        .into_response();
    }

    match state
        .repository
        .load_abac_policy(&context.tenant.org_id)
        .await
    {
        Ok(Some(policy)) => {
            let Some(client_ip) = context.client_ip else {
                if !policy.allowed_cidrs.is_empty() {
                    return ApiError::new(
                        StatusCode::FORBIDDEN,
                        AccessReasonCode::IpNotAllowed,
                        "The client network could not be verified.",
                        "Connect through an approved network boundary.",
                    )
                    .into_response();
                }
                return next.run(request).await;
            };
            let environment = match state.config.environment.as_str() {
                "production" => AgentEnvironment::Production,
                "staging" => AgentEnvironment::Staging,
                "test" | "development" => AgentEnvironment::Sandbox,
                _ => AgentEnvironment::Production,
            };
            if let Err(reason) = abac::evaluate(
                &policy,
                &context,
                AbacContext {
                    client_ip,
                    amount: None,
                    gas_price: None,
                    environment,
                    risk_tier: RiskTier::Tier2Standard,
                    now: Utc::now(),
                },
            ) {
                return ApiError::new(
                    StatusCode::FORBIDDEN,
                    reason,
                    "The request context does not satisfy organization controls.",
                    "Meet the organization network, MFA, environment, and schedule requirements.",
                )
                .into_response();
            }
        }
        Ok(None) => {}
        Err(error) => {
            warn!(error = %error, "ABAC policy lookup failed");
            return ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "Authorization policy services are temporarily unavailable.",
                "Retry after the policy store is healthy.",
            )
            .into_response();
        }
    }

    next.run(request).await
}

fn required_capability(method: &http::Method, path: &str) -> (Capability, &'static str) {
    if path.starts_with("/api/v1/tenant/operators") {
        return (Capability::ManageIam, Capability::ManageIam.action());
    }
    if path.starts_with("/api/v1/billing") || path.starts_with("/api/v1/subscription") {
        return (
            Capability::DispatchSettlement,
            Capability::DispatchSettlement.action(),
        );
    }
    if path.starts_with("/api/v1/users/") {
        return (Capability::ManageIam, Capability::ManageIam.action());
    }
    if path == "/api/v1/telemetry/stream" {
        return (
            Capability::SubscribeTelemetry,
            Capability::SubscribeTelemetry.action(),
        );
    }
    if method == http::Method::GET {
        (Capability::ReadFleet, Capability::ReadFleet.action())
    } else {
        (Capability::AuthorPolicy, Capability::AuthorPolicy.action())
    }
}

fn platform_capability(method: &http::Method, path: &str) -> Option<PlatformCapability> {
    if !path.starts_with("/api/v1/platform") {
        return None;
    }
    if path == "/api/v1/platform/plans" && *method == http::Method::POST {
        return Some(PlatformCapability::ManagePlans);
    }
    if path == "/api/v1/platform/operators" {
        return Some(if *method == http::Method::GET {
            PlatformCapability::ReadTenants
        } else {
            PlatformCapability::ManagePlatformAccess
        });
    }
    if path == "/api/v1/platform/subscriptions" || path == "/api/v1/platform/billing/ledger" {
        return Some(PlatformCapability::ReadBilling);
    }
    if path.starts_with("/api/v1/platform/billing") {
        return Some(if *method == http::Method::GET {
            PlatformCapability::ReadBilling
        } else {
            PlatformCapability::ManageSubscriptions
        });
    }
    if path.starts_with("/api/v1/platform/tenants") {
        return Some(if *method == http::Method::GET {
            PlatformCapability::ReadTenants
        } else {
            PlatformCapability::ManageTenants
        });
    }
    Some(PlatformCapability::ReadTenants)
}

pub async fn health_handler(State(state): State<SharedState>) -> Json<Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "agentguard-gateway",
        "chainId": state.config.chain_id,
        "environment": state.config.environment
    }))
}

pub async fn ready_handler(State(state): State<SharedState>) -> impl IntoResponse {
    let rpc_ready = state.chain.health_check().await.is_ok();
    let database_ready = sqlx::query("SELECT 1")
        .execute(&state.repository.pool)
        .await
        .is_ok();
    if rpc_ready && database_ready {
        (
            StatusCode::OK,
            Json(serde_json::json!({ "ready": true, "chainId": state.config.chain_id })),
        )
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "ready": false, "chainId": state.config.chain_id })),
        )
    }
}

pub async fn list_plans_handler(
    State(state): State<SharedState>,
) -> Result<Json<Vec<PlanResponse>>, ApiError> {
    let plan_rows = sqlx::query(
        "SELECT id, code, name, description, active FROM plans WHERE active = TRUE ORDER BY created_at ASC",
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The plan catalog is temporarily unavailable."))?;

    let mut plans = Vec::with_capacity(plan_rows.len());
    for plan in plan_rows {
        let plan_id: Uuid = plan.try_get("id").map_err(|_| {
            service_unavailable("The plan catalog returned an invalid plan identifier.")
        })?;
        let price_rows = sqlx::query(
            r#"SELECT id, chain_id, token_address, amount_base_units::text AS amount_base_units,
                      interval, active
               FROM plan_prices
               WHERE plan_id = $1 AND active = TRUE
               ORDER BY interval ASC"#,
        )
        .bind(plan_id)
        .fetch_all(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("The plan price catalog is temporarily unavailable."))?;
        let prices = price_rows
            .into_iter()
            .map(|price| {
                Ok(crate::types::PlanPriceResponse {
                    id: price.try_get("id")?,
                    chain_id: price.try_get::<i64, _>("chain_id")? as u64,
                    token_address: price.try_get("token_address")?,
                    amount_base_units: price.try_get("amount_base_units")?,
                    interval: price.try_get("interval")?,
                    active: price.try_get("active")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()
            .map_err(|_| {
                service_unavailable("The plan price catalog returned an invalid record.")
            })?;
        plans.push(PlanResponse {
            id: plan_id,
            code: plan
                .try_get("code")
                .map_err(|_| service_unavailable("The plan catalog returned an invalid code."))?,
            name: plan
                .try_get("name")
                .map_err(|_| service_unavailable("The plan catalog returned an invalid name."))?,
            description: plan.try_get("description").map_err(|_| {
                service_unavailable("The plan catalog returned an invalid description.")
            })?,
            active: plan
                .try_get("active")
                .map_err(|_| service_unavailable("The plan catalog returned an invalid status."))?,
            prices,
        });
    }
    Ok(Json(plans))
}

pub async fn list_tenants_handler(
    State(state): State<SharedState>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        "SELECT org_id, display_name, enterprise_address, status, created_at FROM organizations ORDER BY created_at ASC",
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The tenant directory is temporarily unavailable."))?;
    rows.into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "id": row.try_get::<String, _>("org_id")?,
                "displayName": row.try_get::<String, _>("display_name")?,
                "enterpriseAddress": row.try_get::<String, _>("enterprise_address")?,
                "status": row.try_get::<String, _>("status")?,
                "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at")?,
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map(Json)
        .map_err(|_| service_unavailable("The tenant directory returned an invalid record."))
}

pub async fn list_platform_subscriptions_handler(
    State(state): State<SharedState>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        r#"SELECT s.id, s.org_id, o.display_name, s.status, s.current_period_start,
                  s.current_period_end, p.code, pp.amount_base_units::text AS amount_base_units,
                  pp.interval, s.updated_at
           FROM subscriptions s
           JOIN organizations o ON o.org_id = s.org_id
           JOIN plan_prices pp ON pp.id = s.plan_price_id
           JOIN plans p ON p.id = pp.plan_id
           ORDER BY s.updated_at DESC"#,
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The platform subscription directory is unavailable."))?;
    rows.into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id")?,
                "tenantId": row.try_get::<String, _>("org_id")?,
                "tenantName": row.try_get::<String, _>("display_name")?,
                "status": row.try_get::<String, _>("status")?,
                "currentPeriodStart": row.try_get::<chrono::DateTime<Utc>, _>("current_period_start")?,
                "currentPeriodEnd": row.try_get::<chrono::DateTime<Utc>, _>("current_period_end")?,
                "planCode": row.try_get::<String, _>("code")?,
                "amountBaseUnits": row.try_get::<String, _>("amount_base_units")?,
                "interval": row.try_get::<String, _>("interval")?,
                "updatedAt": row.try_get::<chrono::DateTime<Utc>, _>("updated_at")?
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map(Json)
        .map_err(|_| service_unavailable("The platform subscription directory returned invalid data."))
}

pub async fn list_platform_ledger_handler(
    State(state): State<SharedState>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        r#"SELECT l.id, l.org_id, o.display_name, l.entry_type, l.amount_base_units::text AS amount_base_units,
                  l.chain_id, l.transaction_hash, l.created_at
           FROM billing_ledger_entries l
           JOIN organizations o ON o.org_id = l.org_id
           ORDER BY l.created_at DESC"#,
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The platform billing ledger is unavailable."))?;
    rows.into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id")?,
                "tenantId": row.try_get::<String, _>("org_id")?,
                "tenantName": row.try_get::<String, _>("display_name")?,
                "entryType": row.try_get::<String, _>("entry_type")?,
                "amountBaseUnits": row.try_get::<String, _>("amount_base_units")?,
                "chainId": row.try_get::<i64, _>("chain_id")? as u64,
                "transactionHash": row.try_get::<String, _>("transaction_hash")?,
                "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at")?
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map(Json)
        .map_err(|_| service_unavailable("The platform billing ledger returned invalid data."))
}

pub async fn list_platform_operators_handler(
    State(state): State<SharedState>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        "SELECT subject, role, status, created_at, updated_at FROM platform_operators ORDER BY subject",
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The platform access directory is unavailable."))?;
    rows.into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "subject": row.try_get::<String, _>("subject")?,
                "role": row.try_get::<String, _>("role")?,
                "status": row.try_get::<String, _>("status")?,
                "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at")?,
                "updatedAt": row.try_get::<chrono::DateTime<Utc>, _>("updated_at")?
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map(Json)
        .map_err(|_| service_unavailable("The platform access directory returned invalid data."))
}

pub async fn upsert_platform_operator_handler(
    State(state): State<SharedState>,
    Json(payload): Json<PlatformOperatorRequest>,
) -> Result<StatusCode, ApiError> {
    if payload.subject.trim().is_empty()
        || payload.subject.len() > 256
        || rbac::PlatformRole::parse(payload.role.trim()).is_none()
    {
        return Err(invalid_request(
            "A valid platform subject and role are required.",
        ));
    }
    sqlx::query(
        "INSERT INTO platform_operators (subject, role) VALUES ($1, $2) ON CONFLICT (subject) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = NOW()",
    )
    .bind(payload.subject.trim())
    .bind(payload.role.trim())
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The platform access record could not be updated."))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn create_tenant_handler(
    State(state): State<SharedState>,
    Json(payload): Json<CreateTenantRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if payload.display_name.trim().is_empty()
        || payload.display_name.len() > 160
        || payload.owner_subject.trim().is_empty()
    {
        return Err(invalid_request(
            "A tenant requires a display name and owner subject.",
        ));
    }
    let enterprise_address = Address::from_str(&payload.enterprise_address)
        .map_err(|_| invalid_request("The tenant enterprise address is invalid."))?;
    if enterprise_address == Address::ZERO {
        return Err(invalid_request(
            "The tenant enterprise address must not be zero.",
        ));
    }
    let tenant_id = Uuid::now_v7().to_string();
    let mut transaction = state
        .repository
        .pool
        .begin()
        .await
        .map_err(|_| service_unavailable("Tenant creation could not be started."))?;
    sqlx::query(
        "INSERT INTO organizations (org_id, display_name, enterprise_address) VALUES ($1, $2, $3)",
    )
    .bind(&tenant_id)
    .bind(payload.display_name.trim())
    .bind(format!("{enterprise_address:#x}"))
    .execute(&mut *transaction)
    .await
    .map_err(|_| {
        invalid_request("The tenant identifier or enterprise address is already in use.")
    })?;
    sqlx::query("INSERT INTO operators (org_id, subject, role) VALUES ($1, $2, 'agent_developer')")
        .bind(&tenant_id)
        .bind(payload.owner_subject.trim())
        .execute(&mut *transaction)
        .await
        .map_err(|_| {
            invalid_request("The owner already belongs to a tenant or the membership is invalid.")
        })?;
    transaction
        .commit()
        .await
        .map_err(|_| service_unavailable("Tenant creation could not be committed."))?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": tenant_id,
            "displayName": payload.display_name.trim(),
            "enterpriseAddress": format!("{enterprise_address:#x}"),
            "ownerSubject": payload.owner_subject.trim(),
            "status": "active"
        })),
    ))
}

pub async fn list_agents_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        "SELECT agent_address, admin_address, environment, risk_tier, status, created_at FROM agents WHERE org_id = $1 ORDER BY created_at ASC",
    )
    .bind(&context.tenant.org_id)
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The tenant fleet is temporarily unavailable."))?;
    rows.into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "address": row.try_get::<String, _>("agent_address")?,
                "adminAddress": row.try_get::<String, _>("admin_address")?,
                "environment": row.try_get::<String, _>("environment")?,
                "riskTier": row.try_get::<String, _>("risk_tier")?,
                "status": row.try_get::<String, _>("status")?,
                "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at")?,
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map(Json)
        .map_err(|_| service_unavailable("The tenant fleet returned an invalid record."))
}

pub async fn get_agent_policy_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(agent): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let parsed =
        Address::from_str(&agent).map_err(|_| invalid_request("The agent address is invalid."))?;
    let owner = state
        .repository
        .organization_for_agent(&format!("{parsed:#x}"))
        .await
        .map_err(|_| service_unavailable("The tenant fleet is temporarily unavailable."))?;
    if owner.as_deref() != Some(context.tenant.org_id.as_str()) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            AccessReasonCode::TenantScope,
            "The agent is outside this tenant.",
            "Request a policy only for a tenant-owned agent.",
        ));
    }
    let policy = state.chain.agent_policy(parsed).await.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The policy chain could not be reached.",
            "Retry after Monad RPC connectivity is restored.",
        )
    })?;
    Ok(Json(serde_json::json!({
        "agent": format!("{parsed:#x}"),
        "maxPerTx": policy.max_per_tx.to_string(),
        "maxPerWindow": policy.max_per_window.to_string(),
        "windowSeconds": policy.window_seconds,
        "maxVelocity": policy.max_velocity,
        "killSwitch": policy.kill_switch,
        "whitelistEnabled": policy.whitelist_enabled,
        "source": "monad"
    })))
}

pub async fn prepare_agent_policy_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(agent): Path<String>,
    Json(payload): Json<PolicyUpdateRequest>,
) -> Result<Json<Value>, ApiError> {
    let parsed_agent =
        Address::from_str(&agent).map_err(|_| invalid_request("The agent address is invalid."))?;
    let owner = state
        .repository
        .organization_for_agent(&format!("{parsed_agent:#x}"))
        .await
        .map_err(|_| service_unavailable("The tenant fleet is temporarily unavailable."))?;
    if owner.as_deref() != Some(context.tenant.org_id.as_str()) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            AccessReasonCode::TenantScope,
            "The agent is outside this tenant.",
            "Request a policy only for a tenant-owned agent.",
        ));
    }
    let max_per_tx = payload
        .max_per_tx
        .parse::<u128>()
        .map_err(|_| invalid_request("The per-transaction limit is invalid."))?;
    let max_per_window = payload
        .max_per_window
        .parse::<u128>()
        .map_err(|_| invalid_request("The rolling-window limit is invalid."))?;
    if payload.window_seconds == 0 || payload.max_velocity == 0 {
        return Err(invalid_request(
            "The policy window and velocity limit must be positive.",
        ));
    }
    use alloy::sol_types::SolCall;
    let call = crate::types::IPolicyEngine::setPolicyCall {
        agent: parsed_agent,
        policy: crate::types::SpendPolicy {
            maxPerTx: max_per_tx,
            maxPerWindow: max_per_window,
            windowSeconds: payload.window_seconds,
            maxVelocity: payload.max_velocity,
            killSwitch: payload.kill_switch,
            whitelistEnabled: payload.whitelist_enabled,
        },
    };
    Ok(Json(serde_json::json!({
        "agent": format!("{parsed_agent:#x}"),
        "target": format!("{:#x}", state.config.policy_engine_address),
        "chainId": state.config.chain_id,
        "data": format!("0x{}", hex::encode(call.abi_encode())),
        "policy": payload,
        "source": "gateway_authorized_transaction"
    })))
}

pub async fn list_signing_wallets_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Value>, ApiError> {
    let rows = sqlx::query(
        "SELECT wallet_id, wallet_address, label, created_at FROM signing_wallets WHERE org_id = $1 ORDER BY created_at DESC",
    )
    .bind(&context.tenant.org_id)
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The tenant signing vault is unavailable."))?;
    let wallets = rows
        .into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "walletId": row.try_get::<String, _>("wallet_id")?,
                "address": row.try_get::<String, _>("wallet_address")?,
                "label": row.try_get::<String, _>("label")?,
                "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at")?
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(|_| service_unavailable("The tenant signing vault returned invalid data."))?;
    Ok(Json(serde_json::json!({ "wallets": wallets })))
}

pub async fn create_signing_wallet_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<CreateSigningWalletRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let label = payload.label.trim();
    if label.is_empty() || label.len() > 160 {
        return Err(invalid_request("A signing address requires a valid label."));
    }
    let response = state
        .http_client
        .post(format!(
            "{}/api/v1/wallets",
            state.config.opensigner_url.trim_end_matches('/')
        ))
        .bearer_auth(&state.config.opensigner_api_token)
        .json(&serde_json::json!({ "label": label }))
        .send()
        .await
        .map_err(|_| service_unavailable("The sovereign signing vault is unavailable."))?;
    let status = response.status();
    let body = response.json::<Value>().await.map_err(|_| {
        service_unavailable("The sovereign signing vault returned an invalid response.")
    })?;
    if !status.is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The sovereign signing vault rejected the provisioning request.",
            "Retry after the signing vault is healthy.",
        ));
    }
    let wallet = body
        .get("wallet")
        .ok_or_else(|| service_unavailable("The signing vault response omitted the wallet."))?;
    let wallet_id = wallet
        .get("walletId")
        .and_then(Value::as_str)
        .ok_or_else(|| service_unavailable("The signing vault response omitted the wallet ID."))?;
    let address = wallet
        .get("address")
        .and_then(Value::as_str)
        .and_then(|value| Address::from_str(value).ok())
        .filter(|value| *value != Address::ZERO)
        .ok_or_else(|| {
            service_unavailable("The signing vault response omitted a valid address.")
        })?;
    sqlx::query(
        "INSERT INTO signing_wallets (org_id, wallet_id, wallet_address, label) VALUES ($1, $2, $3, $4)",
    )
    .bind(&context.tenant.org_id)
    .bind(wallet_id)
    .bind(format!("{address:#x}"))
    .bind(label)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| invalid_request("The signing address is already registered."))?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "walletId": wallet_id,
            "address": format!("{address:#x}"),
            "label": label
        })),
    ))
}

pub async fn register_agent_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<RegisterAgentRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let agent = Address::from_str(&payload.address)
        .map_err(|_| invalid_request("The agent address is invalid."))?;
    let enterprise_address = context.tenant.enterprise_address;
    let admin = payload
        .admin_address
        .as_deref()
        .map(Address::from_str)
        .transpose()
        .map_err(|_| invalid_request("The agent administrator address is invalid."))?
        .unwrap_or(enterprise_address);
    if admin != enterprise_address {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            AccessReasonCode::TenantScope,
            "The agent administrator is outside this tenant.",
            "Register the agent under the tenant control address.",
        ));
    }
    if agent == Address::ZERO
        || !matches!(
            payload.environment.as_str(),
            "production" | "staging" | "sandbox"
        )
        || !matches!(
            payload.risk_tier.as_str(),
            "tier1_critical" | "tier2_standard" | "tier3_test"
        )
    {
        return Err(invalid_request(
            "The agent environment or risk tier is not supported.",
        ));
    }
    sqlx::query(
        "INSERT INTO agents (org_id, agent_address, admin_address, environment, risk_tier) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&context.tenant.org_id)
    .bind(format!("{agent:#x}"))
    .bind(format!("{admin:#x}"))
    .bind(&payload.environment)
    .bind(&payload.risk_tier)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| invalid_request("The agent is already registered or the fleet record is invalid."))?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "address": format!("{agent:#x}"),
            "adminAddress": format!("{admin:#x}"),
            "environment": payload.environment,
            "riskTier": payload.risk_tier,
            "status": "active"
        })),
    ))
}

pub async fn create_plan_handler(
    State(state): State<SharedState>,
    Json(payload): Json<CreatePlanRequest>,
) -> Result<(StatusCode, Json<PlanResponse>), ApiError> {
    if payload.code.trim().is_empty()
        || payload.code.len() > 64
        || payload.name.trim().is_empty()
        || payload.name.len() > 160
        || payload.prices.is_empty()
    {
        return Err(invalid_request(
            "A plan requires a code, name, and at least one price.",
        ));
    }
    let plan_id = Uuid::now_v7();
    let mut prices = Vec::with_capacity(payload.prices.len());
    let mut transaction = state
        .repository
        .pool
        .begin()
        .await
        .map_err(|_| service_unavailable("The plan catalog could not be updated."))?;
    sqlx::query("INSERT INTO plans (id, code, name, description) VALUES ($1, $2, $3, $4)")
        .bind(plan_id)
        .bind(payload.code.trim())
        .bind(payload.name.trim())
        .bind(payload.description.trim())
        .execute(&mut *transaction)
        .await
        .map_err(|_| invalid_request("The plan code is already in use or the plan is invalid."))?;
    for input in payload.prices {
        if input.chain_id != state.config.chain_id
            || Address::from_str(&input.token_address)
                .map_or(true, |address| address == Address::ZERO)
            || input.interval != "monthly" && input.interval != "annual"
            || input
                .amount_base_units
                .parse::<U256>()
                .map_or(true, |amount| amount == U256::ZERO)
        {
            return Err(invalid_request(
                "Each price must match the active network and use a positive amount.",
            ));
        }
        let price_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO plan_prices (id, plan_id, chain_id, token_address, amount_base_units, interval) VALUES ($1, $2, $3, $4, $5::numeric, $6)",
        )
        .bind(price_id)
        .bind(plan_id)
        .bind(input.chain_id as i64)
        .bind(&input.token_address)
        .bind(&input.amount_base_units)
        .bind(&input.interval)
        .execute(&mut *transaction)
        .await
        .map_err(|_| invalid_request("The plan contains a duplicate or invalid price."))?;
        prices.push(crate::types::PlanPriceResponse {
            id: price_id,
            chain_id: input.chain_id,
            token_address: input.token_address,
            amount_base_units: input.amount_base_units,
            interval: input.interval,
            active: true,
        });
    }
    transaction
        .commit()
        .await
        .map_err(|_| service_unavailable("The plan catalog could not be committed."))?;
    Ok((
        StatusCode::CREATED,
        Json(PlanResponse {
            id: plan_id,
            code: payload.code,
            name: payload.name,
            description: payload.description,
            active: true,
            prices,
        }),
    ))
}

pub async fn get_subscription_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Value>, ApiError> {
    let subscription = sqlx::query(
        r#"SELECT s.id, s.status, s.current_period_start, s.current_period_end,
                  s.cancel_at_period_end, p.code, pp.amount_base_units::text AS amount_base_units,
                  pp.interval, pp.chain_id, pp.token_address
           FROM subscriptions s
           JOIN plan_prices pp ON pp.id = s.plan_price_id
           JOIN plans p ON p.id = pp.plan_id
           WHERE s.org_id = $1"#,
    )
    .bind(&context.tenant.org_id)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The subscription record is temporarily unavailable."))?;
    Ok(Json(subscription.map_or_else(
        || serde_json::json!({ "subscription": null }),
        |row| {
            serde_json::json!({
                "subscription": {
                    "id": row.try_get::<Uuid, _>("id").ok(),
                    "status": row.try_get::<String, _>("status").ok(),
                    "currentPeriodStart": row.try_get::<chrono::DateTime<Utc>, _>("current_period_start").ok(),
                    "currentPeriodEnd": row.try_get::<chrono::DateTime<Utc>, _>("current_period_end").ok(),
                    "cancelAtPeriodEnd": row.try_get::<bool, _>("cancel_at_period_end").ok(),
                    "planCode": row.try_get::<String, _>("code").ok(),
                    "amountBaseUnits": row.try_get::<String, _>("amount_base_units").ok(),
                    "interval": row.try_get::<String, _>("interval").ok(),
                    "chainId": row.try_get::<i64, _>("chain_id").ok().map(|value| value as u64),
                    "tokenAddress": row.try_get::<String, _>("token_address").ok(),
                }
            })
        },
    )))
}

pub async fn checkout_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    headers: HeaderMap,
    Json(payload): Json<CheckoutRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| {
            invalid_request("An idempotency key is required for subscription checkout.")
        })?;
    let agent = Address::from_str(&payload.agent)
        .map_err(|_| invalid_request("The settlement wallet address is invalid."))?;
    let price = sqlx::query(
        r#"SELECT pp.amount_base_units::text AS amount_base_units, pp.interval,
                  pp.chain_id, pp.token_address
           FROM plan_prices pp JOIN plans p ON p.id = pp.plan_id
           WHERE pp.id = $1 AND pp.active = TRUE AND p.active = TRUE"#,
    )
    .bind(payload.plan_price_id)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The plan price catalog is temporarily unavailable."))?
    .ok_or_else(|| invalid_request("The selected subscription price is not available."))?;
    let chain_id = price
        .try_get::<i64, _>("chain_id")
        .map_err(|_| invalid_request("The selected price has no valid network."))?
        as u64;
    let token_address: String = price
        .try_get("token_address")
        .map_err(|_| invalid_request("The selected price has no valid settlement token."))?;
    let amount_base_units: String = price
        .try_get("amount_base_units")
        .map_err(|_| invalid_request("The selected price has no valid amount."))?;
    if chain_id != state.config.chain_id
        || Address::from_str(&token_address).ok() != Some(state.config.usdc_token_address)
    {
        return Err(invalid_request(
            "The selected price is not configured for this network.",
        ));
    }
    let amount = amount_base_units
        .parse::<U256>()
        .map_err(|_| invalid_request("The selected price amount is invalid."))?;
    let now = Utc::now();
    let deadline = now + Duration::minutes(15);
    let nonce = U256::from(Uuid::now_v7().as_u128());
    let request = crate::types::SpendRequest {
        agent,
        merchant: state.config.merchant_address,
        amount,
        category: keccak256("agentguard.subscription".as_bytes()),
        timestamp: U256::from(now.timestamp() as u64),
        deadline: U256::from(deadline.timestamp() as u64),
        nonce,
    };
    let interval: String = price
        .try_get("interval")
        .map_err(|_| invalid_request("The selected price interval is invalid."))?;
    let period = if interval == "annual" {
        Duration::days(365)
    } else {
        Duration::days(30)
    };
    let subscription_id = Uuid::now_v7();
    let payment_id = Uuid::now_v7();
    let request_json = serde_json::json!({
        "agent": format!("{:#x}", request.agent),
        "merchant": format!("{:#x}", request.merchant),
        "amount": amount_base_units,
        "category": format!("0x{:x}", request.category),
        "timestamp": request.timestamp.to_string(),
        "deadline": request.deadline.to_string(),
        "nonce": request.nonce.to_string(),
    });
    let mut transaction = state
        .repository
        .pool
        .begin()
        .await
        .map_err(|_| service_unavailable("Subscription checkout could not be started."))?;
    if sqlx::query("SELECT 1 FROM subscriptions WHERE org_id = $1")
        .bind(&context.tenant.org_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| service_unavailable("The subscription record could not be checked."))?
        .is_some()
    {
        return Err(invalid_request(
            "This tenant already has a subscription record.",
        ));
    }
    sqlx::query("INSERT INTO subscriptions (id, org_id, plan_price_id, status, current_period_start, current_period_end) VALUES ($1, $2, $3, 'pending', $4, $5)")
        .bind(subscription_id).bind(&context.tenant.org_id).bind(payload.plan_price_id).bind(now).bind(now + period)
        .execute(&mut *transaction).await.map_err(|_| invalid_request("The subscription could not be created."))?;
    sqlx::query("INSERT INTO billing_payments (id, subscription_id, idempotency_key, chain_id, token_address, merchant_address, amount_base_units, spend_request, status) VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,'created')")
        .bind(payment_id).bind(subscription_id).bind(idempotency_key).bind(chain_id as i64).bind(&token_address).bind(format!("{:#x}", state.config.merchant_address)).bind(&amount_base_units).bind(request_json.clone())
        .execute(&mut *transaction).await.map_err(|_| invalid_request("The checkout idempotency key is already in use."))?;
    transaction
        .commit()
        .await
        .map_err(|_| service_unavailable("Subscription checkout could not be committed."))?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "subscriptionId": subscription_id,
            "paymentId": payment_id,
            "status": "created",
            "settlement": { "chainId": chain_id, "tokenAddress": token_address, "merchantAddress": format!("{:#x}", state.config.merchant_address), "request": request_json }
        })),
    ))
}

pub async fn submit_payment_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(payment_id): Path<Uuid>,
    Json(payload): Json<PaymentSubmissionRequest>,
) -> Result<Json<Value>, ApiError> {
    if !payload.transaction_hash.starts_with("0x")
        || payload.transaction_hash.len() != 66
        || hex::decode(&payload.transaction_hash[2..]).is_err()
    {
        return Err(invalid_request(
            "The settlement transaction hash is invalid.",
        ));
    }
    let payment = sqlx::query("SELECT bp.subscription_id, bp.amount_base_units::text AS amount_base_units, bp.merchant_address, bp.token_address, bp.chain_id, bp.spend_request FROM billing_payments bp JOIN subscriptions s ON s.id = bp.subscription_id WHERE bp.id = $1 AND s.org_id = $2")
        .bind(payment_id).bind(&context.tenant.org_id).fetch_optional(&state.repository.pool).await
        .map_err(|_| service_unavailable("The payment record is temporarily unavailable."))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, AccessReasonCode::TenantScope, "The payment record was not found in your organization.", "Use a payment created for this organization."))?;
    let receipt = state
        .chain
        .transaction_receipt(&payload.transaction_hash)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                AccessReasonCode::DependencyUnavailable,
                "Settlement confirmation is temporarily unavailable.",
                "Retry after the Monad network is reachable.",
            )
        })?;
    let Some(receipt) = receipt else {
        sqlx::query("UPDATE billing_payments SET status = 'submitted', transaction_hash = $2, updated_at = NOW() WHERE id = $1")
            .bind(payment_id).bind(&payload.transaction_hash).execute(&state.repository.pool).await.map_err(|_| service_unavailable("The payment status could not be recorded."))?;
        return Ok(Json(
            serde_json::json!({ "paymentId": payment_id, "status": "submitted" }),
        ));
    };
    let spend_request: Value = payment
        .try_get("spend_request")
        .map_err(|_| service_unavailable("The payment request is invalid."))?;
    let expected_agent = spend_request
        .get("agent")
        .and_then(Value::as_str)
        .and_then(|value| Address::from_str(value).ok())
        .ok_or_else(|| service_unavailable("The payment agent is invalid."))?;
    let expected_merchant = spend_request
        .get("merchant")
        .and_then(Value::as_str)
        .and_then(|value| Address::from_str(value).ok())
        .ok_or_else(|| service_unavailable("The payment merchant is invalid."))?;
    let expected_nonce = spend_request
        .get("nonce")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<U256>().ok())
        .ok_or_else(|| service_unavailable("The payment nonce is invalid."))?;
    let expected_amount = payment
        .try_get::<String, _>("amount_base_units")
        .map_err(|_| service_unavailable("The payment amount is invalid."))?
        .parse::<U256>()
        .map_err(|_| service_unavailable("The payment amount is invalid."))?;
    let expected_token = payment
        .try_get::<String, _>("token_address")
        .map_err(|_| service_unavailable("The payment token is invalid."))?
        .parse::<Address>()
        .map_err(|_| service_unavailable("The payment token is invalid."))?;
    if !receipt.matches_payment_execution(
        state.config.agent_wallet_guard_address,
        expected_agent,
        expected_merchant,
        expected_amount,
        expected_nonce,
        expected_token,
    ) {
        sqlx::query("UPDATE billing_payments SET status = 'failed', transaction_hash = $2, failure_reason = $3, updated_at = NOW() WHERE id = $1")
            .bind(payment_id).bind(&payload.transaction_hash).bind("Settlement transaction did not succeed through the configured payment guard.").execute(&state.repository.pool).await.map_err(|_| service_unavailable("The payment status could not be recorded."))?;
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The settlement transaction was not accepted.",
            "Submit a successful transaction through the configured payment guard.",
        ));
    }
    let block_number = receipt.block_number.as_deref().and_then(parse_hex_quantity);
    let mut transaction = state
        .repository
        .pool
        .begin()
        .await
        .map_err(|_| service_unavailable("The payment confirmation could not be started."))?;
    sqlx::query("UPDATE billing_payments SET status = 'confirmed', transaction_hash = $2, block_number = $3, updated_at = NOW() WHERE id = $1")
        .bind(payment_id).bind(&payload.transaction_hash).bind(block_number.map(|value| value as i64)).execute(&mut *transaction).await.map_err(|_| service_unavailable("The payment confirmation could not be recorded."))?;
    sqlx::query("UPDATE subscriptions SET status = 'active', updated_at = NOW() WHERE id = $1")
        .bind(
            payment
                .try_get::<Uuid, _>("subscription_id")
                .map_err(|_| service_unavailable("The payment subscription is invalid."))?,
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| service_unavailable("The subscription could not be activated."))?;
    sqlx::query("INSERT INTO billing_ledger_entries (org_id, billing_payment_id, entry_type, amount_base_units, chain_id, transaction_hash) VALUES ($1,$2,'subscription_charge',$3::numeric,$4,$5)")
        .bind(&context.tenant.org_id).bind(payment_id).bind(payment.try_get::<String, _>("amount_base_units").map_err(|_| service_unavailable("The payment amount is invalid."))?).bind(payment.try_get::<i64, _>("chain_id").map_err(|_| service_unavailable("The payment network is invalid."))?).bind(&payload.transaction_hash).execute(&mut *transaction).await.map_err(|_| service_unavailable("The billing ledger could not be updated."))?;
    transaction
        .commit()
        .await
        .map_err(|_| service_unavailable("The payment confirmation could not be committed."))?;
    Ok(Json(
        serde_json::json!({ "paymentId": payment_id, "status": "confirmed", "transactionHash": payload.transaction_hash, "blockNumber": block_number }),
    ))
}

fn parse_hex_quantity(value: &str) -> Option<u64> {
    u64::from_str_radix(value.strip_prefix("0x").unwrap_or(value), 16).ok()
}

fn network_name(chain_id: u64) -> &'static str {
    match chain_id {
        143 => "monad-mainnet",
        10143 => "monad-testnet",
        _ => "monad-local",
    }
}

fn invalid_request(message: &'static str) -> ApiError {
    ApiError::new(
        StatusCode::BAD_REQUEST,
        AccessReasonCode::InvalidRequest,
        message,
        "Correct the request and try again.",
    )
}

fn service_unavailable(message: &'static str) -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        AccessReasonCode::DependencyUnavailable,
        message,
        "Retry after the service is healthy.",
    )
}

pub async fn inference_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Response {
    let auth_header = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok());
    let Some(auth_header) = auth_header.filter(|value| !value.trim().is_empty()) else {
        let challenge = X402Challenge {
            standard: "x402".to_string(),
            version: "1.0".to_string(),
            network: network_name(state.config.chain_id).to_string(),
            chain_id: state.config.chain_id,
            challenge: X402ChallengeDetails {
                pay_to: format!("{:#x}", state.config.merchant_address),
                amount_wei: state.config.inference_price_base_units.clone(),
                token: format!("{:#x}", state.config.usdc_token_address),
                service_id: state.config.inference_service_id.clone(),
                category: state.config.inference_category.clone(),
                description: "Policy-gated autonomous agent inference request".to_string(),
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
    };

    let (request, signature) = match crate::crypto::parse_x402_authorization_header(auth_header) {
        Ok(value) => value,
        Err(_) => {
            return x402_rejection(
                StatusCode::BAD_REQUEST,
                OnchainReasonCode::SignatureInvalid,
                None,
                state.config.chain_id,
            );
        }
    };
    let digest = crate::crypto::compute_eip712_digest(
        crate::crypto::compute_domain_separator(
            state.config.chain_id,
            state.config.agent_wallet_guard_address,
        ),
        crate::crypto::compute_spend_request_hash(&request),
    );
    let recovered = match crate::crypto::recover_signer(digest, &signature) {
        Ok(address) => address,
        Err(_) => {
            return x402_rejection(
                StatusCode::FORBIDDEN,
                OnchainReasonCode::SignatureInvalid,
                Some(request.agent),
                state.config.chain_id,
            );
        }
    };
    if recovered != request.agent {
        return x402_rejection(
            StatusCode::FORBIDDEN,
            OnchainReasonCode::SignatureInvalid,
            Some(request.agent),
            state.config.chain_id,
        );
    }
    if request.merchant != state.config.merchant_address {
        return x402_rejection(
            StatusCode::FORBIDDEN,
            OnchainReasonCode::MerchantNotAllowed,
            Some(request.agent),
            state.config.chain_id,
        );
    }

    match state.chain.evaluate_policy(request.clone()).await {
        Ok((true, allowed_amount, reason_code, evaluated_at)) => {
            if reason_code != OnchainReasonCode::None.as_u8() {
                let reason = OnchainReasonCode::from_u8(reason_code)
                    .unwrap_or(OnchainReasonCode::SignatureInvalid);
                return x402_rejection(
                    StatusCode::FORBIDDEN,
                    reason,
                    Some(request.agent),
                    state.config.chain_id,
                );
            }
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "policy_allowed",
                    "settlement": "PolicyEngine read-only evaluation completed; no settlement transaction was submitted.",
                    "policyDecision": {
                        "allowed": true,
                        "allowedAmount": allowed_amount.to_string(),
                        "reasonCode": reason_code,
                        "evaluatedAt": evaluated_at.to_string()
                    },
                    "request": {
                        "agent": format!("{:#x}", request.agent),
                        "merchant": format!("{:#x}", request.merchant),
                        "amount": request.amount.to_string(),
                        "nonce": request.nonce.to_string()
                    },
                    "input": body.map(|value| value.0)
                })),
            ).into_response()
        }
        Ok((false, _, reason_code, _)) => {
            let reason = OnchainReasonCode::from_u8(reason_code)
                .unwrap_or(OnchainReasonCode::SignatureInvalid);
            x402_rejection(
                StatusCode::FORBIDDEN,
                reason,
                Some(request.agent),
                state.config.chain_id,
            )
        }
        Err(_) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The policy chain could not be reached.",
            "Retry after Monad RPC connectivity is restored.",
        )
        .into_response(),
    }
}

fn x402_rejection(
    status: StatusCode,
    code: OnchainReasonCode,
    agent: Option<alloy::primitives::Address>,
    chain_id: u64,
) -> Response {
    let body = X402PolicyRejectionBody {
        error: code.as_str().to_string(),
        reason_code: code.as_u8(),
        message: code.message().to_string(),
        remediation: code.remediation().to_string(),
        agent: agent
            .map(|value| format!("{value:#x}"))
            .unwrap_or_else(|| "unresolved".to_string()),
        network: network_name(chain_id).to_string(),
        chain_id,
        evaluated_at: Utc::now().to_rfc3339(),
    };
    (
        status,
        [("X-AgentGuard-Reason-Code", code.as_u8().to_string())],
        Json(body),
    )
        .into_response()
}

pub async fn telemetry_stream(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    Sse::new(state.events.stream_for_tenant(context.tenant.org_id)).keep_alive(KeepAlive::default())
}

pub async fn get_user_role_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(subject): Path<String>,
) -> Result<Json<RoleResponse>, ApiError> {
    if subject != context.subject && context.role != Role::SuperAdmin {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            AccessReasonCode::TenantScope,
            "The requested operator is outside your permitted scope.",
            "Request only operators in your organization.",
        ));
    }
    let role = if subject == context.subject {
        context.role
    } else {
        let operator = state
            .repository
            .load_operator(&context.tenant.org_id, &subject)
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "The identity store is temporarily unavailable.",
                    "Retry after the identity store is healthy.",
                )
            })?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::NOT_FOUND,
                    AccessReasonCode::TenantScope,
                    "The operator record was not found in your organization.",
                    "Verify the operator identifier.",
                )
            })?;
        Role::parse(&operator.role).ok_or_else(|| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                AccessReasonCode::ConfigurationInvalid,
                "The organization role record is invalid.",
                "Repair the role record before continuing.",
            )
        })?
    };
    Ok(Json(RoleResponse {
        success: true,
        subject: subject.clone(),
        org_id: context.tenant.org_id,
        role: role.as_str().to_string(),
        updated_at: Utc::now().to_rfc3339(),
    }))
}

pub async fn list_tenant_operators_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        "SELECT subject, role, status, mfa_authenticated, updated_at FROM operators WHERE org_id = $1 ORDER BY subject",
    )
    .bind(&context.tenant.org_id)
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The organization access directory is unavailable."))?;
    rows.into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "subject": row.try_get::<String, _>("subject")?,
                "role": row.try_get::<String, _>("role")?,
                "status": row.try_get::<String, _>("status")?,
                "mfaAuthenticated": row.try_get::<bool, _>("mfa_authenticated")?,
                "updatedAt": row.try_get::<chrono::DateTime<Utc>, _>("updated_at")?
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map(Json)
        .map_err(|_| {
            service_unavailable("The organization access directory returned invalid data.")
        })
}

pub async fn update_user_role_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(subject): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<UpdateRoleRequest>,
) -> Result<Json<RoleResponse>, ApiError> {
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                AccessReasonCode::InvalidRequest,
                "An idempotency key is required for role changes.",
                "Provide a unique Idempotency-Key header and retry the request.",
            )
        })?;
    let role = Role::parse(&payload.role).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            AccessReasonCode::InvalidRequest,
            "The requested role is not supported.",
            "Use one of the six supported enterprise roles.",
        )
    })?;
    let request_hash = Sha256::digest(
        serde_json::to_vec(&(subject.as_str(), role.as_str())).map_err(|_| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                AccessReasonCode::InvalidRequest,
                "The role request could not be normalized.",
                "Submit a valid role update payload.",
            )
        })?,
    )
    .to_vec();
    if let Some(row) = sqlx::query(
        "SELECT request_hash, status, response FROM idempotency_keys WHERE org_id = $1 AND key = $2",
    )
    .bind(&context.tenant.org_id)
    .bind(idempotency_key)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            AccessReasonCode::DependencyUnavailable,
            "The operation ledger is temporarily unavailable.",
            "Retry after the organization store is healthy.",
        )
    })? {
        let stored_hash: Vec<u8> = row.try_get("request_hash").map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The operation ledger returned an invalid record.",
                "Repair the operation ledger before retrying.",
            )
        })?;
        if stored_hash != request_hash {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                AccessReasonCode::InvalidRequest,
                "The idempotency key was already used for another request.",
                "Use a new idempotency key for a different role change.",
            ));
        }
        let status: String = row.try_get("status").map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The operation ledger returned an invalid status.",
                "Repair the operation ledger before retrying.",
            )
        })?;
        if status == "confirmed"
            && let Some(response) = row.try_get::<Option<Value>, _>("response").map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "The operation result could not be loaded.",
                    "Retry after the organization store is healthy.",
                )
            })?
        {
            return serde_json::from_value(response).map(Json).map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "The operation result is invalid.",
                    "Repair the operation ledger before retrying.",
                )
            });
        }
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            AccessReasonCode::InvalidRequest,
            "An operation with this idempotency key is already recorded.",
            "Wait for the recorded operation to finish or use a new idempotency key.",
        ));
    }
    sqlx::query(
        "INSERT INTO idempotency_keys (org_id, key, request_hash, status) VALUES ($1, $2, $3, 'pending')",
    )
    .bind(&context.tenant.org_id)
    .bind(idempotency_key)
    .bind(&request_hash)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| {
        ApiError::new(
            StatusCode::CONFLICT,
            AccessReasonCode::InvalidRequest,
            "An operation with this idempotency key is already in progress.",
            "Wait for that operation or use a new idempotency key.",
        )
    })?;
    let response = RoleResponse {
        success: true,
        subject: subject.clone(),
        org_id: context.tenant.org_id.clone(),
        role: role.as_str().to_string(),
        updated_at: Utc::now().to_rfc3339(),
    };
    let response_value = serde_json::to_value(&response).map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            AccessReasonCode::DependencyUnavailable,
            "The role operation result could not be recorded.",
            "Review the operation ledger before retrying.",
        )
    })?;
    let operation_id = uuid::Uuid::now_v7();
    let transaction_result: Result<(), ApiError> = async {
        let mut transaction = state.repository.pool.begin().await.map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The role operation could not be started.",
                "Retry after the organization store is healthy.",
            )
        })?;
        sqlx::query(
            "INSERT INTO role_change_operations (id, org_id, subject, requested_role, status) VALUES ($1, $2, $3, $4, 'pending')",
        )
        .bind(operation_id)
        .bind(&context.tenant.org_id)
        .bind(&subject)
        .bind(role.as_str())
        .execute(&mut *transaction)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The role operation could not be recorded.",
                "Retry after the organization store is healthy.",
            )
        })?;
        sqlx::query(
            r#"INSERT INTO operators (org_id, subject, role, mfa_authenticated)
               VALUES ($1, $2, $3, FALSE)
               ON CONFLICT (org_id, subject) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW(), status = 'active'"#,
        )
        .bind(&context.tenant.org_id)
        .bind(&subject)
        .bind(role.as_str())
        .execute(&mut *transaction)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The organization role store is temporarily unavailable.",
                "Retry after the organization store is healthy.",
            )
        })?;
        sqlx::query(
            "UPDATE role_change_operations SET status = 'succeeded', completed_at = NOW() WHERE id = $1",
        )
        .bind(operation_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The role operation status could not be recorded.",
                "Review the pending role operation before retrying.",
            )
        })?;
        sqlx::query(
            "UPDATE idempotency_keys SET status = 'confirmed', response = $3, updated_at = NOW() WHERE org_id = $1 AND key = $2",
        )
        .bind(&context.tenant.org_id)
        .bind(idempotency_key)
        .bind(response_value)
        .execute(&mut *transaction)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The role operation result could not be recorded.",
                "Review the operation ledger before retrying.",
            )
        })?;
        transaction.commit().await.map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The role operation could not be committed.",
                "Retry after the organization store is healthy.",
            )
        })?;
        Ok(())
    }
    .await;
    if let Err(error) = transaction_result {
        let _ = sqlx::query(
            "UPDATE idempotency_keys SET status = 'failed', updated_at = NOW() WHERE org_id = $1 AND key = $2 AND status = 'pending'",
        )
        .bind(&context.tenant.org_id)
        .bind(idempotency_key)
        .execute(&state.repository.pool)
        .await;
        return Err(error);
    }
    Ok(Json(response))
}
