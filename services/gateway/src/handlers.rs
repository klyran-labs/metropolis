use crate::{
    abac::{self, AbacContext, AbacPolicy, AgentEnvironment, RiskTier},
    auth::{AuthService, OnboardingIdentity, RequestContext, client_ip},
    chain::ChainClient,
    config::Config,
    error::{AccessReasonCode, ApiError},
    limits::TenantConcurrency,
    pbac::{self, PbacInput, PbacPolicy, PolicyEffect},
    rbac::{self, Capability, PlatformCapability, Role},
    repository::PgRepository,
    telemetry::EventHub,
    types::{
        AbacPolicyRequest, CheckoutRequest, CreateApiKeyRequest, CreateOnboardingTenantRequest,
        CreatePlanRequest, CreateSigningWalletRequest, CreateTenantRequest,
        GrantWalletAccessRequest, OnchainReasonCode, PaymentSubmissionRequest, PbacPolicyRequest,
        PlanResponse, PlatformOperatorRequest, PolicyUpdateRequest, PrepareWalletTransferRequest,
        RegisterAgentRequest, RegisterOrganizationWalletRequest, RoleResponse, RotateApiKeyRequest,
        SubmitWalletTransferRequest, UpdateRoleRequest, UpdateWalletThresholdRequest,
        X402Challenge, X402ChallengeDetails, X402PolicyRejectionBody,
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
use rand::{RngCore, rngs::OsRng};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{convert::Infallible, str::FromStr, sync::Arc};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tracing::warn;
use uuid::Uuid;

pub struct AppState {
    pub config: Config,
    pub http_client: reqwest::Client,
    pub repository: PgRepository,
    pub auth: AuthService,
    pub chain: ChainClient,
    pub events: EventHub,
    pub streaming_reserves: crate::finops::StreamingReserveHold,
    pub tenant_concurrency: TenantConcurrency,
    pub provider_bulkhead: Arc<Semaphore>,
    pub settlement_queue: crate::settlement::SettlementQueue,
    pub anomaly_detector: crate::anomaly::AnomalyDetector,
    pub relayer_pool: crate::relayer_pool::RelayerPool,
    pub zk_engine: crate::zk::ZkPolicyEngine,
    pub bundle_relay: crate::bundle_relay::BundleRelayManager,
    pub heartbeat_manager: crate::heartbeat::HeartbeatManager,
    pub edge_sequencer: crate::edge_sequencer::EdgeSequencerManager,
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

pub async fn onboarding_authentication_middleware(
    State(state): State<SharedState>,
    mut request: axum::extract::Request,
    next: Next,
) -> Response {
    let ip = client_ip(&request, state.config.trust_proxy_headers);
    let identity = match state
        .auth
        .authenticate_onboarding(request.headers(), ip)
        .await
    {
        Ok(identity) => identity,
        Err(error) => return error.into_response(),
    };
    request.extensions_mut().insert(identity);
    next.run(request).await
}

async fn run_with_tenant_concurrency(
    state: &SharedState,
    context: &RequestContext,
    mut request: axum::extract::Request,
    next: Next,
) -> Response {
    let Some(permit) = state.tenant_concurrency.try_acquire(&context.tenant.org_id) else {
        return ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            AccessReasonCode::DependencyUnavailable,
            "Organization request capacity is temporarily exhausted.",
            "Retry after active organization requests complete.",
        )
        .into_response();
    };
    request.extensions_mut().insert(Arc::new(permit));
    next.run(request).await
}

fn try_provider_permit(state: &SharedState) -> Option<OwnedSemaphorePermit> {
    state.provider_bulkhead.clone().try_acquire_owned().ok()
}

fn provider_capacity_error() -> Response {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        AccessReasonCode::DependencyUnavailable,
        "The inference provider is at capacity.",
        "Retry after provider capacity becomes available.",
    )
    .into_response()
}

fn tenant_capacity_error() -> Response {
    ApiError::new(
        StatusCode::TOO_MANY_REQUESTS,
        AccessReasonCode::RateLimited,
        "The agent request capacity is currently exhausted.",
        "Retry with bounded concurrency after in-flight requests complete.",
    )
    .into_response()
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
        return run_with_tenant_concurrency(&state, &context, request, next).await;
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
                return run_with_tenant_concurrency(&state, &context, request, next).await;
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

    run_with_tenant_concurrency(&state, &context, request, next).await
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
    if path.starts_with("/api/v1/organization/wallets") {
        // Viewing the treasury wallet directory (label/address/kind, no balances-only
        // action) is needed by any fleet role to link an agent to an org wallet;
        // registering, granting access, or changing a threshold stays Treasury-only.
        if method == http::Method::GET {
            return (Capability::ReadFleet, Capability::ReadFleet.action());
        }
        return (
            Capability::ManageTreasury,
            Capability::ManageTreasury.action(),
        );
    }
    if path.starts_with("/api/v1/wallet-transfers")
        || (path.starts_with("/api/v1/agents/")
            && (path.ends_with("/load") || path.ends_with("/unload")))
    {
        return (
            Capability::DispatchSettlement,
            Capability::DispatchSettlement.action(),
        );
    }
    if path.starts_with("/api/v1/users/") {
        // GET is how every operator (any role) reads their own identity/role
        // record to bootstrap their session — get_user_role_handler already
        // enforces that a caller may only read their own record or, for
        // other operators, must be SuperAdmin. Role *changes* (non-GET)
        // still require the administrative ManageIam capability.
        if method == http::Method::GET {
            return (Capability::ReadSelf, Capability::ReadSelf.action());
        }
        return (Capability::ManageIam, Capability::ManageIam.action());
    }
    if path == "/api/v1/telemetry/stream" {
        return (
            Capability::SubscribeTelemetry,
            Capability::SubscribeTelemetry.action(),
        );
    }
    if path.starts_with("/api/v1/api-keys") {
        return (
            Capability::ManageCredentials,
            Capability::ManageCredentials.action(),
        );
    }
    if path.starts_with("/api/v1/policies/") {
        return (
            Capability::ManageAuthorizationPolicy,
            Capability::ManageAuthorizationPolicy.action(),
        );
    }
    if path.starts_with("/api/v1/tenant/pricing-model") {
        if method == http::Method::GET {
            return (Capability::ReadFleet, Capability::ReadFleet.action());
        }
        return (
            Capability::ManageTreasury,
            Capability::ManageTreasury.action(),
        );
    }
    if path.starts_with("/api/v1/finops/calculate-spend") {
        return (Capability::ReadFleet, Capability::ReadFleet.action());
    }
    if path.starts_with("/api/v1/copilot/compile-policy") {
        return (Capability::AuthorPolicy, Capability::AuthorPolicy.action());
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

pub async fn get_platform_revenue_summary_handler(
    State(state): State<SharedState>,
) -> Result<Json<Value>, ApiError> {
    let totals = sqlx::query(
        r#"SELECT entry_type, COALESCE(SUM(amount_base_units), 0)::text AS total
           FROM billing_ledger_entries
           GROUP BY entry_type"#,
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("Revenue totals are temporarily unavailable."))?;
    let mut total_revenue = "0".to_string();
    let mut total_refunds = "0".to_string();
    for row in totals {
        let entry_type: String = row
            .try_get("entry_type")
            .map_err(|_| service_unavailable("Revenue totals returned an invalid record."))?;
        let total: String = row
            .try_get("total")
            .map_err(|_| service_unavailable("Revenue totals returned an invalid amount."))?;
        match entry_type.as_str() {
            "subscription_charge" => total_revenue = total,
            "refund" => total_refunds = total,
            _ => {}
        }
    }

    let daily_rows = sqlx::query(
        r#"SELECT DATE_TRUNC('day', created_at) AS day,
                  entry_type,
                  COALESCE(SUM(amount_base_units), 0)::text AS total
           FROM billing_ledger_entries
           WHERE created_at >= NOW() - INTERVAL '90 days'
           GROUP BY day, entry_type
           ORDER BY day ASC"#,
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The revenue series is temporarily unavailable."))?;
    let daily_series = daily_rows
        .into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "day": row.try_get::<chrono::DateTime<Utc>, _>("day")?,
                "entryType": row.try_get::<String, _>("entry_type")?,
                "amountBaseUnits": row.try_get::<String, _>("total")?,
            }))
        })
        .collect::<Result<Vec<Value>, sqlx::Error>>()
        .map_err(|_| service_unavailable("The revenue series returned an invalid record."))?;

    let by_plan_rows = sqlx::query(
        r#"SELECT p.code, p.name, COALESCE(SUM(l.amount_base_units), 0)::text AS total
           FROM billing_ledger_entries l
           JOIN billing_payments bp ON bp.id = l.billing_payment_id
           JOIN subscriptions s ON s.id = bp.subscription_id
           JOIN plan_prices pp ON pp.id = s.plan_price_id
           JOIN plans p ON p.id = pp.plan_id
           WHERE l.entry_type = 'subscription_charge'
           GROUP BY p.code, p.name
           ORDER BY total DESC"#,
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("Revenue by plan is temporarily unavailable."))?;
    let by_plan = by_plan_rows
        .into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "code": row.try_get::<String, _>("code")?,
                "name": row.try_get::<String, _>("name")?,
                "amountBaseUnits": row.try_get::<String, _>("total")?,
            }))
        })
        .collect::<Result<Vec<Value>, sqlx::Error>>()
        .map_err(|_| service_unavailable("Revenue by plan returned an invalid record."))?;

    let status_rows = sqlx::query(
        "SELECT status, COUNT(*) AS count FROM subscriptions GROUP BY status ORDER BY status",
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("Subscription status counts are temporarily unavailable."))?;
    let subscriptions_by_status = status_rows
        .into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "status": row.try_get::<String, _>("status")?,
                "count": row.try_get::<i64, _>("count")?,
            }))
        })
        .collect::<Result<Vec<Value>, sqlx::Error>>()
        .map_err(|_| {
            service_unavailable("Subscription status counts returned an invalid record.")
        })?;

    Ok(Json(serde_json::json!({
        "totalRevenueBaseUnits": total_revenue,
        "totalRefundsBaseUnits": total_refunds,
        "dailySeries": daily_series,
        "revenueByPlan": by_plan,
        "subscriptionsByStatus": subscriptions_by_status,
    })))
}

pub async fn get_platform_reconciliation_handler(
    State(state): State<SharedState>,
) -> Result<Json<Value>, ApiError> {
    let rows = sqlx::query(
        r#"SELECT bp.id, o.display_name, bp.status, bp.transaction_hash, bp.reason_code,
                  bp.failure_reason, bp.amount_base_units::text AS amount_base_units,
                  bp.created_at, bp.updated_at, l.id AS ledger_id
           FROM billing_payments bp
           JOIN subscriptions s ON s.id = bp.subscription_id
           JOIN organizations o ON o.org_id = s.org_id
           LEFT JOIN billing_ledger_entries l ON l.billing_payment_id = bp.id
           ORDER BY bp.created_at DESC
           LIMIT 500"#,
    )
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The reconciliation report is temporarily unavailable."))?;

    let mut confirmed_reconciled = 0i64;
    let mut confirmed_unreconciled = 0i64;
    let mut pending = 0i64;
    let mut failed = 0i64;
    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let status: String = row.try_get("status").map_err(|_| {
            service_unavailable("The reconciliation report returned an invalid status.")
        })?;
        let ledger_id: Option<Uuid> = row.try_get("ledger_id").map_err(|_| {
            service_unavailable("The reconciliation report returned an invalid ledger reference.")
        })?;
        let reconciled = ledger_id.is_some();
        match status.as_str() {
            "confirmed" if reconciled => confirmed_reconciled += 1,
            "confirmed" => confirmed_unreconciled += 1,
            "created" | "submitted" => pending += 1,
            "failed" => failed += 1,
            _ => {}
        }
        entries.push(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").map_err(|_| service_unavailable("The reconciliation report returned an invalid payment identifier."))?,
            "tenantName": row.try_get::<String, _>("display_name").map_err(|_| service_unavailable("The reconciliation report returned an invalid tenant."))?,
            "status": status,
            "transactionHash": row.try_get::<Option<String>, _>("transaction_hash").map_err(|_| service_unavailable("The reconciliation report returned an invalid transaction hash."))?,
            "reasonCode": row.try_get::<Option<i16>, _>("reason_code").map_err(|_| service_unavailable("The reconciliation report returned an invalid reason code."))?,
            "failureReason": row.try_get::<Option<String>, _>("failure_reason").map_err(|_| service_unavailable("The reconciliation report returned an invalid failure reason."))?,
            "amountBaseUnits": row.try_get::<String, _>("amount_base_units").map_err(|_| service_unavailable("The reconciliation report returned an invalid amount."))?,
            "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map_err(|_| service_unavailable("The reconciliation report returned an invalid timestamp."))?,
            "updatedAt": row.try_get::<chrono::DateTime<Utc>, _>("updated_at").map_err(|_| service_unavailable("The reconciliation report returned an invalid timestamp."))?,
            "reconciled": reconciled,
        }));
    }

    Ok(Json(serde_json::json!({
        "summary": {
            "confirmedReconciled": confirmed_reconciled,
            "confirmedUnreconciled": confirmed_unreconciled,
            "pending": pending,
            "failed": failed,
        },
        "entries": entries,
    })))
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
    sqlx::query("INSERT INTO operators (org_id, subject, role) VALUES ($1, $2, 'super_admin')")
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

pub async fn create_onboarding_tenant_handler(
    State(state): State<SharedState>,
    Extension(identity): Extension<OnboardingIdentity>,
    Json(payload): Json<CreateOnboardingTenantRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if payload.display_name.trim().is_empty() || payload.display_name.len() > 160 {
        return Err(invalid_request(
            "Choose an organization name between 1 and 160 characters.",
        ));
    }
    let enterprise_address = Address::from_str(&payload.enterprise_address)
        .map_err(|_| invalid_request("The enterprise wallet address is invalid."))?;
    if enterprise_address == Address::ZERO {
        return Err(invalid_request(
            "The enterprise wallet address must not be zero.",
        ));
    }
    let signature = payload
        .signature
        .strip_prefix("0x")
        .unwrap_or(&payload.signature);
    let signature = hex::decode(signature)
        .map_err(|_| invalid_request("The enterprise wallet proof is invalid."))?;
    let message = tenant_ownership_message(&identity.subject, payload.display_name.trim());
    let signer = crate::crypto::recover_personal_signer(&message, &signature)
        .map_err(|_| invalid_request("The enterprise wallet proof could not be verified."))?;
    if signer != enterprise_address {
        return Err(invalid_request(
            "The enterprise wallet proof does not match the connected wallet.",
        ));
    }
    let tenant = provision_tenant(
        &state,
        payload.display_name.trim(),
        enterprise_address,
        &identity.subject,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(tenant)))
}

pub fn tenant_ownership_message(subject: &str, display_name: &str) -> String {
    format!(
        "AgentGuard organization ownership proof\nSubject: {subject}\nOrganization: {display_name}"
    )
}

async fn provision_tenant(
    state: &SharedState,
    display_name: &str,
    enterprise_address: Address,
    owner_subject: &str,
) -> Result<Value, ApiError> {
    let tenant_id = Uuid::now_v7().to_string();
    let mut transaction = state
        .repository
        .pool
        .begin()
        .await
        .map_err(|_| service_unavailable("Organization creation could not be started."))?;
    sqlx::query(
        "INSERT INTO organizations (org_id, display_name, enterprise_address) VALUES ($1, $2, $3)",
    )
    .bind(&tenant_id)
    .bind(display_name)
    .bind(format!("{enterprise_address:#x}"))
    .execute(&mut *transaction)
    .await
    .map_err(|_| {
        invalid_request("The organization name or enterprise address is already in use.")
    })?;
    sqlx::query("INSERT INTO operators (org_id, subject, role) VALUES ($1, $2, 'super_admin')")
        .bind(&tenant_id)
        .bind(owner_subject)
        .execute(&mut *transaction)
        .await
        .map_err(|_| invalid_request("This identity already belongs to an organization."))?;
    sqlx::query("INSERT INTO tenant_policies (org_id) VALUES ($1)")
        .bind(&tenant_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| service_unavailable("The organization controls could not be initialized."))?;
    transaction
        .commit()
        .await
        .map_err(|_| service_unavailable("Organization creation could not be committed."))?;
    Ok(serde_json::json!({
        "id": tenant_id,
        "displayName": display_name,
        "enterpriseAddress": format!("{enterprise_address:#x}"),
        "ownerSubject": owner_subject,
        "status": "active"
    }))
}

pub async fn list_agents_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        "SELECT a.agent_address, a.admin_address, a.environment, a.risk_tier, a.status, a.created_at, a.wallet_source, \
         COALESCE(NULLIF(a.label, ''), sw.label, ow.label, '') AS label \
         FROM agents a \
         LEFT JOIN signing_wallets sw ON sw.id = a.wallet_id \
         LEFT JOIN organization_wallets ow ON ow.address = a.agent_address AND ow.org_id = a.org_id \
         WHERE a.org_id = $1 ORDER BY a.created_at ASC",
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
                "walletSource": row.try_get::<String, _>("wallet_source")?,
                "label": row.try_get::<String, _>("label").unwrap_or_default(),
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

/// Calls OpenSigner to generate a real keypair and records it in `signing_wallets`. Shared by
/// agent registration (`kind = "agent"`) and organization treasury wallet provisioning
/// (`kind = "treasury"`) — both are the tenant's OpenSigner vault, disambiguated by `kind`.
async fn provision_sovereign_wallet(
    state: &SharedState,
    org_id: &str,
    label: &str,
    kind: &str,
) -> Result<(Uuid, String, Address), ApiError> {
    let label = label.trim();
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
    let row = sqlx::query(
        "INSERT INTO signing_wallets (org_id, wallet_id, wallet_address, label, kind) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(org_id)
    .bind(wallet_id)
    .bind(format!("{address:#x}"))
    .bind(label)
    .bind(kind)
    .fetch_one(&state.repository.pool)
    .await
    .map_err(|_| invalid_request("The signing address is already registered."))?;
    let row_id: Uuid = row
        .try_get("id")
        .map_err(|_| service_unavailable("The signing wallet record is invalid."))?;
    Ok((row_id, wallet_id.to_string(), address))
}

pub async fn create_signing_wallet_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<CreateSigningWalletRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (_, wallet_id, address) =
        provision_sovereign_wallet(&state, &context.tenant.org_id, &payload.label, "agent").await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "walletId": wallet_id,
            "address": format!("{address:#x}"),
            "label": payload.label.trim()
        })),
    ))
}

pub async fn register_agent_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<RegisterAgentRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
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
    if !matches!(
        payload.environment.as_str(),
        "production" | "staging" | "sandbox"
    ) || !matches!(
        payload.risk_tier.as_str(),
        "tier1_critical" | "tier2_standard" | "tier3_test"
    ) {
        return Err(invalid_request(
            "The agent environment or risk tier is not supported.",
        ));
    }
    let wallet_source = payload.wallet_source.as_deref().unwrap_or("external");
    let (agent, wallet_row_id) = match wallet_source {
        "sovereign" => {
            let label = payload
                .label
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    invalid_request("A label is required to generate an agent wallet.")
                })?;
            let (row_id, _, address) =
                provision_sovereign_wallet(&state, &context.tenant.org_id, label, "agent").await?;
            (address, Some(row_id))
        }
        "external" => {
            let address = payload
                .address
                .as_deref()
                .ok_or_else(|| invalid_request("An agent wallet address is required."))?;
            let agent = Address::from_str(address)
                .map_err(|_| invalid_request("The agent address is invalid."))?;
            if agent == Address::ZERO {
                return Err(invalid_request("The agent address must not be zero."));
            }
            (agent, None)
        }
        _ => return Err(invalid_request("The wallet source is not supported.")),
    };
    let agent_label = payload.label.as_deref().unwrap_or("").trim();
    sqlx::query(
        "INSERT INTO agents (org_id, agent_address, admin_address, environment, risk_tier, wallet_id, wallet_source, label) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&context.tenant.org_id)
    .bind(format!("{agent:#x}"))
    .bind(format!("{admin:#x}"))
    .bind(&payload.environment)
    .bind(&payload.risk_tier)
    .bind(wallet_row_id)
    .bind(wallet_source)
    .bind(agent_label)
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
            "walletSource": wallet_source,
            "status": "active",
            "label": agent_label
        })),
    ))
}

pub fn treasury_ownership_message(org_id: &str, label: &str) -> String {
    format!("AgentGuard treasury wallet ownership proof\nOrganization: {org_id}\nLabel: {label}")
}

pub async fn register_organization_wallet_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<RegisterOrganizationWalletRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let label = payload.label.trim();
    if label.is_empty() || label.len() > 160 {
        return Err(invalid_request("A treasury wallet requires a valid label."));
    }
    let (address, wallet_row_id) = match payload.kind.as_str() {
        "sovereign" => {
            let (row_id, _, address) =
                provision_sovereign_wallet(&state, &context.tenant.org_id, label, "treasury")
                    .await?;
            (address, Some(row_id))
        }
        "external" => {
            let address_str = payload
                .address
                .as_deref()
                .ok_or_else(|| invalid_request("A treasury wallet address is required."))?;
            let address = Address::from_str(address_str)
                .map_err(|_| invalid_request("The treasury wallet address is invalid."))?;
            if address == Address::ZERO {
                return Err(invalid_request(
                    "The treasury wallet address must not be zero.",
                ));
            }
            let signature_hex = payload
                .signature
                .as_deref()
                .ok_or_else(|| invalid_request("An ownership-proof signature is required."))?;
            let signature = hex::decode(signature_hex.strip_prefix("0x").unwrap_or(signature_hex))
                .map_err(|_| invalid_request("The ownership-proof signature is invalid."))?;
            let message = treasury_ownership_message(&context.tenant.org_id, label);
            let digest = crate::crypto::personal_sign_digest(&message);
            let ecdsa_match = crate::crypto::recover_personal_signer(&message, &signature)
                .map(|signer| signer == address)
                .unwrap_or(false);
            let verified = ecdsa_match
                || state
                    .chain
                    .verify_erc1271_signature(address, digest, &signature)
                    .await;
            if !verified {
                return Err(invalid_request(
                    "The ownership-proof signature does not match the wallet address.",
                ));
            }
            (address, None)
        }
        _ => {
            return Err(invalid_request(
                "The treasury wallet kind is not supported.",
            ));
        }
    };
    let row = sqlx::query(
        "INSERT INTO organization_wallets (org_id, address, label, kind, wallet_id, created_by_subject) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(&context.tenant.org_id)
    .bind(format!("{address:#x}"))
    .bind(label)
    .bind(&payload.kind)
    .bind(wallet_row_id)
    .bind(&context.subject)
    .fetch_one(&state.repository.pool)
    .await
    .map_err(|_| invalid_request("This wallet is already registered for the organization."))?;
    let organization_wallet_id: Uuid = row
        .try_get("id")
        .map_err(|_| service_unavailable("The treasury wallet record is invalid."))?;
    sqlx::query(
        "INSERT INTO organization_wallet_access (wallet_id, subject, granted_by_subject) VALUES ($1, $2, $2)",
    )
    .bind(organization_wallet_id)
    .bind(&context.subject)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("Initial wallet access could not be granted."))?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": organization_wallet_id,
            "address": format!("{address:#x}"),
            "label": label,
            "kind": payload.kind,
            "approvalThreshold": 1,
            "status": "active"
        })),
    ))
}

pub async fn list_organization_wallets_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Value>, ApiError> {
    let rows = sqlx::query(
        r#"SELECT ow.id, ow.address, ow.label, ow.kind, ow.approval_threshold, ow.status, ow.created_by_subject, ow.created_at,
                  (SELECT COUNT(*) FROM organization_wallet_access owa WHERE owa.wallet_id = ow.id) AS access_count,
                  EXISTS(SELECT 1 FROM organization_wallet_access owa WHERE owa.wallet_id = ow.id AND owa.subject = $2) AS has_access
           FROM organization_wallets ow WHERE ow.org_id = $1 ORDER BY ow.created_at DESC"#,
    )
    .bind(&context.tenant.org_id)
    .bind(&context.subject)
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The treasury wallet directory is unavailable."))?;
    let mut wallets = Vec::with_capacity(rows.len());
    for row in rows {
        let address_str: String = row
            .try_get("address")
            .map_err(|_| service_unavailable("A treasury wallet record is invalid."))?;
        let address = Address::from_str(&address_str)
            .map_err(|_| service_unavailable("A treasury wallet address is invalid."))?;
        let balance = state
            .chain
            .token_balance(state.config.usdc_token_address, address)
            .await
            .ok();
        wallets.push(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "address": address_str,
            "label": row.try_get::<String, _>("label").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "kind": row.try_get::<String, _>("kind").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "approvalThreshold": row.try_get::<i16, _>("approval_threshold").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "status": row.try_get::<String, _>("status").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "createdBySubject": row.try_get::<String, _>("created_by_subject").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "accessCount": row.try_get::<i64, _>("access_count").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "hasAccess": row.try_get::<bool, _>("has_access").map_err(|_| service_unavailable("A treasury wallet record is invalid."))?,
            "balanceBaseUnits": balance.map(|value| value.to_string()),
        }));
    }
    Ok(Json(serde_json::json!({ "wallets": wallets })))
}

async fn ensure_wallet_in_tenant(
    state: &SharedState,
    org_id: &str,
    wallet_id: Uuid,
) -> Result<(), ApiError> {
    let exists = sqlx::query("SELECT 1 FROM organization_wallets WHERE id = $1 AND org_id = $2")
        .bind(wallet_id)
        .bind(org_id)
        .fetch_optional(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("The treasury wallet record is unavailable."))?;
    if exists.is_none() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::TenantScope,
            "The treasury wallet was not found in your organization.",
            "Use a wallet registered for this organization.",
        ));
    }
    Ok(())
}

async fn require_wallet_access(
    state: &SharedState,
    context: &RequestContext,
    wallet_id: Uuid,
) -> Result<(), ApiError> {
    if context.role == Role::SuperAdmin {
        return Ok(());
    }
    let granted = sqlx::query(
        "SELECT 1 FROM organization_wallet_access WHERE wallet_id = $1 AND subject = $2",
    )
    .bind(wallet_id)
    .bind(&context.subject)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("Wallet access could not be verified."))?;
    if granted.is_none() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            AccessReasonCode::RoleForbidden,
            "You do not have access to this treasury wallet.",
            "Request access from an operator who already holds it.",
        ));
    }
    Ok(())
}

pub async fn list_wallet_access_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(wallet_id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_in_tenant(&state, &context.tenant.org_id, wallet_id).await?;
    require_wallet_access(&state, &context, wallet_id).await?;
    let rows = sqlx::query(
        "SELECT subject, granted_by_subject, granted_at FROM organization_wallet_access WHERE wallet_id = $1 ORDER BY granted_at ASC",
    )
    .bind(wallet_id)
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("Wallet access could not be listed."))?;
    let grants = rows
        .into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "subject": row.try_get::<String, _>("subject")?,
                "grantedBySubject": row.try_get::<String, _>("granted_by_subject")?,
                "grantedAt": row.try_get::<chrono::DateTime<Utc>, _>("granted_at")?,
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(|_| service_unavailable("Wallet access records are invalid."))?;
    Ok(Json(serde_json::json!({ "access": grants })))
}

pub async fn grant_wallet_access_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(wallet_id): Path<Uuid>,
    Json(payload): Json<GrantWalletAccessRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    ensure_wallet_in_tenant(&state, &context.tenant.org_id, wallet_id).await?;
    require_wallet_access(&state, &context, wallet_id).await?;
    let subject = payload.subject.trim();
    if subject.is_empty() || subject.len() > 320 {
        return Err(invalid_request("A valid identity subject is required."));
    }
    sqlx::query(
        "INSERT INTO organization_wallet_access (wallet_id, subject, granted_by_subject) VALUES ($1, $2, $3) ON CONFLICT (wallet_id, subject) DO NOTHING",
    )
    .bind(wallet_id)
    .bind(subject)
    .bind(&context.subject)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("Wallet access could not be granted."))?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "walletId": wallet_id, "subject": subject })),
    ))
}

pub async fn revoke_wallet_access_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path((wallet_id, subject)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    ensure_wallet_in_tenant(&state, &context.tenant.org_id, wallet_id).await?;
    require_wallet_access(&state, &context, wallet_id).await?;
    sqlx::query("DELETE FROM organization_wallet_access WHERE wallet_id = $1 AND subject = $2")
        .bind(wallet_id)
        .bind(&subject)
        .execute(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("Wallet access could not be revoked."))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_wallet_threshold_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(wallet_id): Path<Uuid>,
    Json(payload): Json<UpdateWalletThresholdRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_in_tenant(&state, &context.tenant.org_id, wallet_id).await?;
    require_wallet_access(&state, &context, wallet_id).await?;
    if !(1..=10).contains(&payload.approval_threshold) {
        return Err(invalid_request(
            "The approval threshold must be between 1 and 10.",
        ));
    }
    sqlx::query("UPDATE organization_wallets SET approval_threshold = $2 WHERE id = $1")
        .bind(wallet_id)
        .bind(payload.approval_threshold)
        .execute(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("The approval threshold could not be updated."))?;
    Ok(Json(serde_json::json!({
        "walletId": wallet_id,
        "approvalThreshold": payload.approval_threshold
    })))
}

struct OrganizationWalletRow {
    id: Uuid,
    approval_threshold: i16,
}

async fn fetch_organization_wallet(
    state: &SharedState,
    org_id: &str,
    wallet_row_id: Uuid,
) -> Result<OrganizationWalletRow, ApiError> {
    let row = sqlx::query(
        "SELECT id, approval_threshold, status FROM organization_wallets WHERE id = $1 AND org_id = $2",
    )
    .bind(wallet_row_id)
    .bind(org_id)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The treasury wallet record is unavailable."))?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::TenantScope,
            "The treasury wallet was not found in your organization.",
            "Use a wallet registered for this organization.",
        )
    })?;
    let status: String = row
        .try_get("status")
        .map_err(|_| service_unavailable("The treasury wallet record is invalid."))?;
    if status != "active" {
        return Err(invalid_request("The treasury wallet is not active."));
    }
    Ok(OrganizationWalletRow {
        id: row
            .try_get("id")
            .map_err(|_| service_unavailable("The treasury wallet record is invalid."))?,
        approval_threshold: row
            .try_get("approval_threshold")
            .map_err(|_| service_unavailable("The treasury wallet record is invalid."))?,
    })
}

async fn mark_wallet_transfer_failed(state: &SharedState, transfer_id: Uuid, reason: &str) {
    let _ = sqlx::query(
        "UPDATE wallet_transfers SET status = 'failed', failure_reason = $2 WHERE id = $1",
    )
    .bind(transfer_id)
    .bind(reason)
    .execute(&state.repository.pool)
    .await;
}

/// Executes a pending Load: a plain ERC-20 transfer from an organization treasury wallet into
/// an agent wallet. For a sovereign treasury, OpenSigner signs and submits it directly (its own
/// MON pays gas) and this function verifies the resulting receipt before recording confirmation.
/// For an external treasury, the gateway holds no key — it returns an intent for the connected
/// wallet to sign and submit itself, mirroring the existing checkout/submit_payment pattern.
async fn execute_load(
    state: &SharedState,
    org_id: &str,
    transfer_id: Uuid,
) -> Result<Value, ApiError> {
    let row = sqlx::query(
        r#"SELECT wt.agent_address, wt.token_address, wt.amount_base_units::text AS amount_base_units,
                  ow.address AS ow_address, ow.kind AS ow_kind, sw.wallet_id AS opensigner_wallet_id
           FROM wallet_transfers wt
           JOIN organization_wallets ow ON ow.id = wt.organization_wallet_id
           LEFT JOIN signing_wallets sw ON sw.id = ow.wallet_id
           WHERE wt.id = $1 AND wt.org_id = $2 AND wt.direction = 'load'"#,
    )
    .bind(transfer_id)
    .bind(org_id)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The load record is unavailable."))?
    .ok_or_else(|| service_unavailable("The load record was not found."))?;

    let agent_address: String = row
        .try_get("agent_address")
        .map_err(|_| service_unavailable("The load record is invalid."))?;
    let token_address: String = row
        .try_get("token_address")
        .map_err(|_| service_unavailable("The load record is invalid."))?;
    let amount_str: String = row
        .try_get("amount_base_units")
        .map_err(|_| service_unavailable("The load record is invalid."))?;
    let ow_kind: String = row
        .try_get("ow_kind")
        .map_err(|_| service_unavailable("The load record is invalid."))?;
    let ow_address: String = row
        .try_get("ow_address")
        .map_err(|_| service_unavailable("The load record is invalid."))?;

    if ow_kind != "sovereign" {
        return Ok(serde_json::json!({
            "transferId": transfer_id,
            "status": "awaiting_signature",
            "intent": { "to": agent_address, "tokenAddress": token_address, "amountBaseUnits": amount_str, "from": ow_address }
        }));
    }

    let amount = amount_str
        .parse::<U256>()
        .map_err(|_| service_unavailable("The load amount is invalid."))?;
    let token = Address::from_str(&token_address)
        .map_err(|_| service_unavailable("The load token is invalid."))?;
    let agent = Address::from_str(&agent_address)
        .map_err(|_| service_unavailable("The load agent is invalid."))?;
    let treasury = Address::from_str(&ow_address)
        .map_err(|_| service_unavailable("The load treasury address is invalid."))?;
    let Ok(opensigner_wallet_id) = row.try_get::<String, _>("opensigner_wallet_id") else {
        mark_wallet_transfer_failed(
            state,
            transfer_id,
            "The treasury has no linked sovereign signing wallet.",
        )
        .await;
        return Err(invalid_request(
            "The treasury has no linked sovereign signing wallet.",
        ));
    };

    let submission = state
        .http_client
        .post(format!(
            "{}/api/v1/execute-treasury-load",
            state.config.opensigner_url.trim_end_matches('/')
        ))
        .bearer_auth(&state.config.opensigner_api_token)
        .json(&serde_json::json!({
            "walletIdOrAddress": opensigner_wallet_id,
            "tokenAddress": token_address,
            "to": agent_address,
            "amount": amount_str,
            "chainId": state.config.chain_id,
        }))
        .send()
        .await;
    let response = match submission {
        Ok(response) => response,
        Err(_) => {
            mark_wallet_transfer_failed(
                state,
                transfer_id,
                "The treasury signing vault is unavailable.",
            )
            .await;
            return Err(service_unavailable(
                "The treasury signing vault is unavailable.",
            ));
        }
    };
    let status_code = response.status();
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    let transaction_hash = if status_code.is_success() {
        body.get("transactionHash")
            .and_then(Value::as_str)
            .map(str::to_string)
    } else {
        None
    };
    let Some(transaction_hash) = transaction_hash else {
        mark_wallet_transfer_failed(
            state,
            transfer_id,
            "The treasury signing vault rejected the transfer.",
        )
        .await;
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The treasury signing vault rejected the transfer.",
            "Retry after the signing vault is healthy.",
        ));
    };

    let receipt = state
        .chain
        .transaction_receipt(&transaction_hash)
        .await
        .ok()
        .flatten();
    let confirmed = receipt
        .as_ref()
        .is_some_and(|receipt| receipt.matches_erc20_transfer(token, treasury, agent, amount));
    if !confirmed {
        mark_wallet_transfer_failed(
            state,
            transfer_id,
            "The load transaction could not be verified onchain.",
        )
        .await;
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The load transaction could not be verified onchain.",
            "Retry the load once the treasury signing vault is healthy.",
        ));
    }

    sqlx::query(
        "UPDATE wallet_transfers SET status = 'confirmed', transaction_hash = $2, confirmed_at = NOW() WHERE id = $1",
    )
    .bind(transfer_id)
    .bind(&transaction_hash)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The load confirmation could not be recorded."))?;

    Ok(
        serde_json::json!({ "transferId": transfer_id, "status": "confirmed", "transactionHash": transaction_hash }),
    )
}

/// True only when the agent's policy has merchant whitelisting turned on AND the merchant isn't
/// whitelisted yet. Best-effort: an RPC failure here is treated as "no whitelisting needed" —
/// PolicyEngine.evaluateAndSpend is still the real authority and will reject the spend onchain
/// if that assumption was wrong, at the cost of a failed transaction rather than a fund-safety issue.
async fn merchant_needs_whitelisting(
    state: &SharedState,
    agent: Address,
    merchant: Address,
) -> bool {
    match state.chain.agent_policy(agent).await {
        Ok(policy) if policy.whitelist_enabled => !state
            .chain
            .is_merchant_whitelisted(agent, merchant)
            .await
            .unwrap_or(false),
        _ => false,
    }
}

/// Executes a pending Unload: an agent's own sovereign wallet signs and submits a
/// policy-gated sweep to a treasury wallet, exactly like any other agent spend. Auto-whitelists
/// the treasury as a merchant first if the agent's policy requires it and it isn't already.
async fn execute_unload(
    state: &SharedState,
    org_id: &str,
    transfer_id: Uuid,
) -> Result<Value, ApiError> {
    let row = sqlx::query(
        r#"SELECT wt.agent_address, wt.token_address, wt.amount_base_units::text AS amount_base_units,
                  ow.address AS ow_address, sw.wallet_id AS opensigner_wallet_id
           FROM wallet_transfers wt
           JOIN organization_wallets ow ON ow.id = wt.organization_wallet_id
           JOIN agents a ON a.org_id = wt.org_id AND a.agent_address = wt.agent_address
           LEFT JOIN signing_wallets sw ON sw.id = a.wallet_id
           WHERE wt.id = $1 AND wt.org_id = $2 AND wt.direction = 'unload'"#,
    )
    .bind(transfer_id)
    .bind(org_id)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The unload record is unavailable."))?
    .ok_or_else(|| service_unavailable("The unload record was not found."))?;

    let agent_address: String = row
        .try_get("agent_address")
        .map_err(|_| service_unavailable("The unload record is invalid."))?;
    let token_address: String = row
        .try_get("token_address")
        .map_err(|_| service_unavailable("The unload record is invalid."))?;
    let amount_str: String = row
        .try_get("amount_base_units")
        .map_err(|_| service_unavailable("The unload record is invalid."))?;
    let ow_address: String = row
        .try_get("ow_address")
        .map_err(|_| service_unavailable("The unload record is invalid."))?;
    let Ok(opensigner_wallet_id) = row.try_get::<String, _>("opensigner_wallet_id") else {
        mark_wallet_transfer_failed(
            state,
            transfer_id,
            "The agent has no sovereign signing wallet linked.",
        )
        .await;
        return Err(invalid_request(
            "The agent has no sovereign signing wallet linked.",
        ));
    };
    let agent = Address::from_str(&agent_address)
        .map_err(|_| service_unavailable("The unload agent is invalid."))?;
    let merchant = Address::from_str(&ow_address)
        .map_err(|_| service_unavailable("The unload treasury address is invalid."))?;
    let token = Address::from_str(&token_address)
        .map_err(|_| service_unavailable("The unload token is invalid."))?;
    let amount = amount_str
        .parse::<U256>()
        .map_err(|_| service_unavailable("The unload amount is invalid."))?;

    let now = Utc::now();
    let deadline = now + Duration::minutes(15);
    let nonce = U256::from(Uuid::now_v7().as_u128());
    let request = serde_json::json!({
        "agent": format!("{agent:#x}"),
        "merchant": format!("{merchant:#x}"),
        "amount": amount_str,
        "category": format!("0x{:x}", keccak256("agentguard.treasury_sweep".as_bytes())),
        "timestamp": (now.timestamp() as u64).to_string(),
        "deadline": (deadline.timestamp() as u64).to_string(),
        "nonce": nonce.to_string(),
    });

    let needs_whitelist = merchant_needs_whitelisting(state, agent, merchant).await;
    let mut payload = serde_json::json!({
        "walletIdOrAddress": opensigner_wallet_id,
        "request": request,
        "verifyingContract": format!("{:#x}", state.config.agent_wallet_guard_address),
        "tokenAddress": token_address,
        "chainId": state.config.chain_id,
    });
    if needs_whitelist {
        payload["whitelistMerchant"] = serde_json::json!({
            "policyEngineAddress": format!("{:#x}", state.config.policy_engine_address)
        });
    }

    let submission = state
        .http_client
        .post(format!(
            "{}/api/v1/execute-gated-payment",
            state.config.opensigner_url.trim_end_matches('/')
        ))
        .bearer_auth(&state.config.opensigner_api_token)
        .json(&payload)
        .send()
        .await;
    let response = match submission {
        Ok(response) => response,
        Err(_) => {
            mark_wallet_transfer_failed(
                state,
                transfer_id,
                "The agent signing vault is unavailable.",
            )
            .await;
            return Err(service_unavailable(
                "The agent signing vault is unavailable.",
            ));
        }
    };
    let status_code = response.status();
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    let transaction_hash = if status_code.is_success() {
        body.get("transactionHash")
            .and_then(Value::as_str)
            .map(str::to_string)
    } else {
        None
    };
    let Some(transaction_hash) = transaction_hash else {
        mark_wallet_transfer_failed(
            state,
            transfer_id,
            "The agent signing vault rejected the sweep.",
        )
        .await;
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The agent signing vault rejected the sweep.",
            "Retry after the signing vault and policy are healthy.",
        ));
    };

    let receipt = state
        .chain
        .transaction_receipt(&transaction_hash)
        .await
        .ok()
        .flatten();
    let confirmed = receipt.as_ref().is_some_and(|receipt| {
        receipt.matches_payment_execution(
            state.config.agent_wallet_guard_address,
            agent,
            merchant,
            amount,
            nonce,
            token,
        )
    });
    if !confirmed {
        mark_wallet_transfer_failed(
            state,
            transfer_id,
            "The unload transaction could not be verified onchain.",
        )
        .await;
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The unload transaction could not be verified onchain.",
            "Retry the unload once the network is healthy.",
        ));
    }

    sqlx::query(
        "UPDATE wallet_transfers SET status = 'confirmed', transaction_hash = $2, confirmed_at = NOW() WHERE id = $1",
    )
    .bind(transfer_id)
    .bind(&transaction_hash)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The unload confirmation could not be recorded."))?;

    Ok(
        serde_json::json!({ "transferId": transfer_id, "status": "confirmed", "transactionHash": transaction_hash }),
    )
}

pub async fn prepare_load_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(agent_address): Path<String>,
    Json(payload): Json<PrepareWalletTransferRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let agent = Address::from_str(&agent_address)
        .map_err(|_| invalid_request("The agent address is invalid."))?;
    let agent_exists = sqlx::query("SELECT 1 FROM agents WHERE org_id = $1 AND agent_address = $2")
        .bind(&context.tenant.org_id)
        .bind(format!("{agent:#x}"))
        .fetch_optional(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("The agent record is unavailable."))?;
    if agent_exists.is_none() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::TenantScope,
            "The agent was not found in your organization.",
            "Register the agent before loading its wallet.",
        ));
    }
    let amount = payload
        .amount_base_units
        .parse::<U256>()
        .map_err(|_| invalid_request("The load amount is invalid."))?;
    if amount.is_zero() {
        return Err(invalid_request(
            "The load amount must be greater than zero.",
        ));
    }
    let wallet = fetch_organization_wallet(
        &state,
        &context.tenant.org_id,
        payload.organization_wallet_id,
    )
    .await?;
    require_wallet_access(&state, &context, wallet.id).await?;

    let transfer_id = Uuid::now_v7();
    let needs_approval = wallet.approval_threshold > 1;
    let initial_status = if needs_approval {
        "pending_approval"
    } else {
        "pending"
    };
    sqlx::query(
        "INSERT INTO wallet_transfers (id, org_id, direction, organization_wallet_id, agent_address, token_address, amount_base_units, status, initiated_by_subject) VALUES ($1,$2,'load',$3,$4,$5,$6::numeric,$7,$8)",
    )
    .bind(transfer_id)
    .bind(&context.tenant.org_id)
    .bind(wallet.id)
    .bind(format!("{agent:#x}"))
    .bind(format!("{:#x}", state.config.usdc_token_address))
    .bind(payload.amount_base_units.clone())
    .bind(initial_status)
    .bind(&context.subject)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The load could not be recorded."))?;

    if needs_approval {
        let ticket_row = sqlx::query(
            "INSERT INTO approval_tickets (org_id, resource, required_signatures, signatures, expires_at) VALUES ($1, $2, $3, $4::jsonb, NOW() + INTERVAL '24 hours') RETURNING id",
        )
        .bind(&context.tenant.org_id)
        .bind(format!("wallet-transfer:{transfer_id}"))
        .bind(wallet.approval_threshold)
        .bind(serde_json::json!([context.subject]))
        .fetch_one(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("The approval ticket could not be created."))?;
        let ticket_id: Uuid = ticket_row
            .try_get("id")
            .map_err(|_| service_unavailable("The approval ticket record is invalid."))?;
        sqlx::query("UPDATE wallet_transfers SET approval_ticket_id = $2 WHERE id = $1")
            .bind(transfer_id)
            .bind(ticket_id)
            .execute(&state.repository.pool)
            .await
            .map_err(|_| service_unavailable("The approval ticket could not be linked."))?;
        return Ok((
            StatusCode::ACCEPTED,
            Json(serde_json::json!({
                "transferId": transfer_id,
                "status": "pending_approval",
                "ticketId": ticket_id,
                "requiredSignatures": wallet.approval_threshold,
                "signatures": 1
            })),
        ));
    }

    let result = execute_load(&state, &context.tenant.org_id, transfer_id).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn submit_wallet_transfer_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(transfer_id): Path<Uuid>,
    Json(payload): Json<SubmitWalletTransferRequest>,
) -> Result<Json<Value>, ApiError> {
    if !payload.transaction_hash.starts_with("0x")
        || payload.transaction_hash.len() != 66
        || hex::decode(&payload.transaction_hash[2..]).is_err()
    {
        return Err(invalid_request("The transfer transaction hash is invalid."));
    }
    let row = sqlx::query(
        r#"SELECT wt.direction, wt.agent_address, wt.token_address, wt.amount_base_units::text AS amount_base_units, wt.status,
                  ow.address AS ow_address
           FROM wallet_transfers wt JOIN organization_wallets ow ON ow.id = wt.organization_wallet_id
           WHERE wt.id = $1 AND wt.org_id = $2"#,
    )
    .bind(transfer_id)
    .bind(&context.tenant.org_id)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The transfer record is unavailable."))?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::TenantScope,
            "The transfer was not found in your organization.",
            "Use a transfer created for this organization.",
        )
    })?;
    let direction: String = row
        .try_get("direction")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    if direction != "load" {
        return Err(invalid_request(
            "Only externally-sourced loads require manual submission.",
        ));
    }
    let status: String = row
        .try_get("status")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    if status == "confirmed" {
        return Ok(Json(
            serde_json::json!({ "transferId": transfer_id, "status": "confirmed" }),
        ));
    }
    let agent_address: String = row
        .try_get("agent_address")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    let token_address: String = row
        .try_get("token_address")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    let amount_str: String = row
        .try_get("amount_base_units")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    let ow_address: String = row
        .try_get("ow_address")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    let token = Address::from_str(&token_address)
        .map_err(|_| service_unavailable("The transfer token is invalid."))?;
    let agent = Address::from_str(&agent_address)
        .map_err(|_| service_unavailable("The transfer agent is invalid."))?;
    let treasury = Address::from_str(&ow_address)
        .map_err(|_| service_unavailable("The transfer treasury address is invalid."))?;
    let amount = amount_str
        .parse::<U256>()
        .map_err(|_| service_unavailable("The transfer amount is invalid."))?;

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
        return Ok(Json(
            serde_json::json!({ "transferId": transfer_id, "status": "pending" }),
        ));
    };
    if !receipt.matches_erc20_transfer(token, treasury, agent, amount) {
        mark_wallet_transfer_failed(
            &state,
            transfer_id,
            "The load transaction did not match the expected transfer.",
        )
        .await;
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The load transaction was not accepted.",
            "Submit a successful token transfer to the agent wallet.",
        ));
    }
    sqlx::query(
        "UPDATE wallet_transfers SET status = 'confirmed', transaction_hash = $2, confirmed_at = NOW() WHERE id = $1",
    )
    .bind(transfer_id)
    .bind(&payload.transaction_hash)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The load confirmation could not be recorded."))?;
    Ok(Json(serde_json::json!({
        "transferId": transfer_id,
        "status": "confirmed",
        "transactionHash": payload.transaction_hash
    })))
}

pub async fn sign_approval_ticket_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(transfer_id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let row = sqlx::query(
        "SELECT organization_wallet_id, status, approval_ticket_id FROM wallet_transfers WHERE id = $1 AND org_id = $2",
    )
    .bind(transfer_id)
    .bind(&context.tenant.org_id)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The transfer record is unavailable."))?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::TenantScope,
            "The transfer was not found in your organization.",
            "Use a transfer created for this organization.",
        )
    })?;
    let status: String = row
        .try_get("status")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    let organization_wallet_id: Uuid = row
        .try_get("organization_wallet_id")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    let ticket_id: Option<Uuid> = row
        .try_get("approval_ticket_id")
        .map_err(|_| service_unavailable("The transfer record is invalid."))?;
    let Some(ticket_id) = ticket_id else {
        return Err(service_unavailable(
            "The transfer has no linked approval ticket.",
        ));
    };
    require_wallet_access(&state, &context, organization_wallet_id).await?;
    if status != "pending_approval" {
        // A retry after the transfer already advanced (for example a double click) is harmless.
        if let Some((collected, required)) = crate::approvals::signed_state(
            &state.repository.pool,
            &context.tenant.org_id,
            ticket_id,
            &context.subject,
        )
        .await
        .map_err(|_| service_unavailable("The approval ticket is unavailable."))?
        {
            return Ok(Json(serde_json::json!({
                "transferId": transfer_id,
                "status": status,
                "signatures": collected,
                "requiredSignatures": required,
                "alreadySigned": true
            })));
        }
        return Err(invalid_request("This transfer is not awaiting approval."));
    }

    let outcome = crate::approvals::record_signature(
        &state.repository.pool,
        &context.tenant.org_id,
        ticket_id,
        &context.subject,
    )
    .await
    .map_err(|_| service_unavailable("The approval could not be recorded."))?;
    match outcome {
        crate::approvals::SignOutcome::NotFound => {
            return Err(service_unavailable("The approval ticket was not found."));
        }
        crate::approvals::SignOutcome::NotOpen => {
            return Err(invalid_request("This approval ticket is no longer open."));
        }
        crate::approvals::SignOutcome::AlreadySigned {
            collected,
            required,
        } => {
            return Ok(Json(serde_json::json!({
                "transferId": transfer_id,
                "status": "pending_approval",
                "signatures": collected,
                "requiredSignatures": required,
                "alreadySigned": true
            })));
        }
        crate::approvals::SignOutcome::Recorded {
            collected,
            required,
            reached: false,
        } => {
            return Ok(Json(serde_json::json!({
                "transferId": transfer_id,
                "status": "pending_approval",
                "signatures": collected,
                "requiredSignatures": required
            })));
        }
        crate::approvals::SignOutcome::Recorded { reached: true, .. } => {}
    }

    sqlx::query("UPDATE wallet_transfers SET status = 'pending' WHERE id = $1")
        .bind(transfer_id)
        .execute(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("The transfer could not be advanced."))?;
    let result = execute_load(&state, &context.tenant.org_id, transfer_id).await?;
    Ok(Json(result))
}

pub async fn prepare_unload_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(agent_address): Path<String>,
    Json(payload): Json<PrepareWalletTransferRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let agent = Address::from_str(&agent_address)
        .map_err(|_| invalid_request("The agent address is invalid."))?;
    let agent_row =
        sqlx::query("SELECT wallet_id FROM agents WHERE org_id = $1 AND agent_address = $2")
            .bind(&context.tenant.org_id)
            .bind(format!("{agent:#x}"))
            .fetch_optional(&state.repository.pool)
            .await
            .map_err(|_| service_unavailable("The agent record is unavailable."))?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::NOT_FOUND,
                    AccessReasonCode::TenantScope,
                    "The agent was not found in your organization.",
                    "Register the agent before unloading its wallet.",
                )
            })?;
    let has_sovereign_wallet: Option<Uuid> = agent_row
        .try_get("wallet_id")
        .map_err(|_| service_unavailable("The agent record is invalid."))?;
    if has_sovereign_wallet.is_none() {
        return Err(invalid_request(
            "Only agents with a sovereign signing wallet can be unloaded through this flow.",
        ));
    }
    let amount = payload
        .amount_base_units
        .parse::<U256>()
        .map_err(|_| invalid_request("The unload amount is invalid."))?;
    if amount.is_zero() {
        return Err(invalid_request(
            "The unload amount must be greater than zero.",
        ));
    }
    let wallet = fetch_organization_wallet(
        &state,
        &context.tenant.org_id,
        payload.organization_wallet_id,
    )
    .await?;
    require_wallet_access(&state, &context, wallet.id).await?;

    let transfer_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO wallet_transfers (id, org_id, direction, organization_wallet_id, agent_address, token_address, amount_base_units, status, initiated_by_subject) VALUES ($1,$2,'unload',$3,$4,$5,$6::numeric,'pending',$7)",
    )
    .bind(transfer_id)
    .bind(&context.tenant.org_id)
    .bind(wallet.id)
    .bind(format!("{agent:#x}"))
    .bind(format!("{:#x}", state.config.usdc_token_address))
    .bind(payload.amount_base_units.clone())
    .bind(&context.subject)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The unload could not be recorded."))?;

    let result = execute_unload(&state, &context.tenant.org_id, transfer_id).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn list_wallet_transfers_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(agent_address): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let agent = Address::from_str(&agent_address)
        .map_err(|_| invalid_request("The agent address is invalid."))?;
    let rows = sqlx::query(
        r#"SELECT wt.id, wt.direction, wt.amount_base_units::text AS amount_base_units, wt.status, wt.transaction_hash,
                  wt.failure_reason, wt.initiated_by_subject, wt.created_at, wt.confirmed_at, ow.label AS wallet_label, ow.address AS wallet_address
           FROM wallet_transfers wt JOIN organization_wallets ow ON ow.id = wt.organization_wallet_id
           WHERE wt.org_id = $1 AND wt.agent_address = $2 ORDER BY wt.created_at DESC LIMIT 100"#,
    )
    .bind(&context.tenant.org_id)
    .bind(format!("{agent:#x}"))
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The wallet transfer history is unavailable."))?;
    let transfers = rows
        .into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id")?,
                "direction": row.try_get::<String, _>("direction")?,
                "amountBaseUnits": row.try_get::<String, _>("amount_base_units")?,
                "status": row.try_get::<String, _>("status")?,
                "transactionHash": row.try_get::<Option<String>, _>("transaction_hash")?,
                "failureReason": row.try_get::<Option<String>, _>("failure_reason")?,
                "initiatedBySubject": row.try_get::<String, _>("initiated_by_subject")?,
                "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at")?,
                "confirmedAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("confirmed_at")?,
                "walletLabel": row.try_get::<String, _>("wallet_label")?,
                "walletAddress": row.try_get::<String, _>("wallet_address")?,
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(|_| service_unavailable("The wallet transfer history returned invalid data."))?;
    Ok(Json(serde_json::json!({ "transfers": transfers })))
}

/// Approval progress for one pending transfer from a given operator's point of view.
#[derive(Debug, PartialEq, Eq)]
pub struct PendingApprovalState {
    pub signatures_collected: usize,
    pub signatures_required: i16,
    pub already_signed: bool,
    pub can_approve: bool,
}

/// Pure so the rules are unit-testable: an operator can approve only with wallet access and
/// only once, mirroring `sign_approval_ticket_handler`.
pub fn pending_approval_state(
    signatures: &[String],
    required: i16,
    subject: &str,
    has_wallet_access: bool,
) -> PendingApprovalState {
    let already_signed = signatures.iter().any(|signer| signer == subject);
    PendingApprovalState {
        signatures_collected: signatures.len(),
        signatures_required: required,
        already_signed,
        can_approve: has_wallet_access && !already_signed,
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct PendingApprovalsQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

const PENDING_APPROVALS_DEFAULT_LIMIT: i64 = 25;
const PENDING_APPROVALS_MAX_LIMIT: i64 = 100;

/// Cursor = base64url("<created_at RFC3339>|<transfer id>"), the sort key of the last row served.
pub fn encode_approvals_cursor(created_at: chrono::DateTime<Utc>, id: Uuid) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!(
        "{}|{}",
        created_at.to_rfc3339(),
        id
    ))
}

pub fn decode_approvals_cursor(cursor: &str) -> Option<(chrono::DateTime<Utc>, Uuid)> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(cursor)
        .ok()?;
    let text = String::from_utf8(bytes).ok()?;
    let (timestamp, id) = text.split_once('|')?;
    Some((
        chrono::DateTime::parse_from_rfc3339(timestamp)
            .ok()?
            .with_timezone(&Utc),
        Uuid::parse_str(id).ok()?,
    ))
}

pub async fn list_pending_approvals_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    axum::extract::Query(query): axum::extract::Query<PendingApprovalsQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = query
        .limit
        .unwrap_or(PENDING_APPROVALS_DEFAULT_LIMIT)
        .clamp(1, PENDING_APPROVALS_MAX_LIMIT);
    let cursor = match query.cursor.as_deref() {
        None => None,
        Some(raw) => Some(
            decode_approvals_cursor(raw)
                .ok_or_else(|| invalid_request("The pagination cursor is invalid."))?,
        ),
    };
    let is_super_admin = context.role == Role::SuperAdmin;
    let page = crate::approvals::list_pending(
        &state.repository.pool,
        &context.tenant.org_id,
        &context.subject,
        is_super_admin,
        limit,
        cursor,
    )
    .await
    .map_err(|_| service_unavailable("Pending approvals are unavailable."))?;

    let next_cursor = page
        .rows
        .last()
        .map(|row| encode_approvals_cursor(row.created_at, row.id));
    let approvals = page
        .rows
        .iter()
        .map(|row| {
            let progress = pending_approval_state(
                &row.signers,
                row.required_signatures,
                &context.subject,
                is_super_admin || row.has_access,
            );
            serde_json::json!({
                "transferId": row.id,
                "direction": row.direction,
                "amountBaseUnits": row.amount_base_units,
                "agentAddress": row.agent_address,
                "initiatedBySubject": row.initiated_by_subject,
                "createdAt": row.created_at,
                "expiresAt": row.expires_at,
                "walletId": row.wallet_id,
                "walletLabel": row.wallet_label,
                "walletAddress": row.wallet_address,
                "signatures": progress.signatures_collected,
                "requiredSignatures": progress.signatures_required,
                "alreadySigned": progress.already_signed,
                "canApprove": progress.can_approve,
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(serde_json::json!({
        "count": approvals.len(),
        "total": page.total,
        "approvableCount": page.approvable,
        "hasMore": page.has_more,
        "nextCursor": if page.has_more { next_cursor } else { None },
        "approvals": approvals,
    })))
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

/// Actions a machine credential may be issued with. Deliberately excludes
/// `iam.manage`, `credentials.manage`, `authorization_policy.manage`, and
/// `self.read` — a machine credential must never be able to self-escalate
/// into tenant IAM, credential, or policy administration.
const ASSIGNABLE_API_KEY_CAPABILITIES: [&str; 7] = [
    "fleet.read",
    "audit.read",
    "telemetry.subscribe",
    "policy.write",
    "circuit_breaker.trip",
    "treasury.manage",
    "settlement.dispatch",
];

pub fn is_assignable_api_key_capability(action: &str) -> bool {
    ASSIGNABLE_API_KEY_CAPABILITIES.contains(&action)
}

fn generate_api_key_secret() -> (String, Vec<u8>) {
    let mut entropy = [0u8; 32];
    OsRng.fill_bytes(&mut entropy);
    let secret = format!("ag_live_sec_{}", hex::encode(entropy));
    let hash = Sha256::digest(secret.as_bytes()).to_vec();
    (secret, hash)
}

fn validate_credential_expiry(expires_at: chrono::DateTime<Utc>) -> Result<(), ApiError> {
    let now = Utc::now();
    if expires_at <= now || expires_at > now + Duration::days(365) {
        return Err(invalid_request(
            "The credential expiry must be in the future and no more than 365 days out.",
        ));
    }
    Ok(())
}

pub async fn create_api_key_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<CreateApiKeyRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let subject = payload.subject.trim();
    if subject.is_empty() || subject.len() > 320 {
        return Err(invalid_request("A valid credential subject is required."));
    }
    if payload.capabilities.is_empty()
        || !payload
            .capabilities
            .iter()
            .all(|action| is_assignable_api_key_capability(action))
    {
        return Err(invalid_request(
            "The requested capabilities are not assignable to a machine credential.",
        ));
    }
    validate_credential_expiry(payload.expires_at)?;
    let agent = Address::from_str(&payload.agent_address)
        .map_err(|_| invalid_request("The agent address is invalid."))?;
    let owner = state
        .repository
        .organization_for_agent(&format!("{agent:#x}"))
        .await
        .map_err(|_| service_unavailable("The tenant fleet is temporarily unavailable."))?;
    if owner.as_deref() != Some(context.tenant.org_id.as_str()) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            AccessReasonCode::TenantScope,
            "The agent is outside this tenant.",
            "Issue a credential only for a tenant-owned agent.",
        ));
    }

    let (secret, key_hash) = generate_api_key_secret();
    let key_prefix = &secret[..16];
    let capabilities = serde_json::to_value(&payload.capabilities)
        .map_err(|_| invalid_request("The requested capabilities are invalid."))?;
    let row = sqlx::query(
        "INSERT INTO api_keys (org_id, subject, agent_address, key_prefix, key_hash, capabilities, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at",
    )
    .bind(&context.tenant.org_id)
    .bind(subject)
    .bind(format!("{agent:#x}"))
    .bind(key_prefix)
    .bind(key_hash)
    .bind(&capabilities)
    .bind(payload.expires_at)
    .fetch_one(&state.repository.pool)
    .await
    .map_err(|_| invalid_request("The credential could not be issued; retry."))?;
    let id: Uuid = row
        .try_get("id")
        .map_err(|_| service_unavailable("The credential record is invalid."))?;
    let created_at: chrono::DateTime<Utc> = row
        .try_get("created_at")
        .map_err(|_| service_unavailable("The credential record is invalid."))?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "keyPrefix": key_prefix,
            "secret": secret,
            "agentAddress": format!("{agent:#x}"),
            "subject": subject,
            "capabilities": payload.capabilities,
            "expiresAt": payload.expires_at,
            "revokedAt": Value::Null,
            "createdAt": created_at,
        })),
    ))
}

pub async fn list_api_keys_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, key_prefix, agent_address, subject, capabilities, expires_at, revoked_at, created_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC",
    )
    .bind(&context.tenant.org_id)
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The credential inventory is temporarily unavailable."))?;
    rows.into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id")?,
                "keyPrefix": row.try_get::<String, _>("key_prefix")?,
                "agentAddress": row.try_get::<String, _>("agent_address")?,
                "subject": row.try_get::<String, _>("subject")?,
                "capabilities": row.try_get::<Value, _>("capabilities")?,
                "expiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("expires_at")?,
                "revokedAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("revoked_at")?,
                "createdAt": row.try_get::<chrono::DateTime<Utc>, _>("created_at")?,
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map(Json)
        .map_err(|_| service_unavailable("The credential inventory returned an invalid record."))
}

pub async fn rotate_api_key_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(id): Path<Uuid>,
    Json(payload): Json<RotateApiKeyRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    validate_credential_expiry(payload.expires_at)?;
    let row = sqlx::query(
        "SELECT subject, agent_address, capabilities, revoked_at FROM api_keys WHERE id = $1 AND org_id = $2",
    )
    .bind(id)
    .bind(&context.tenant.org_id)
    .fetch_optional(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The credential record is unavailable."))?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::TenantScope,
            "The credential was not found in your organization.",
            "Use a credential issued for this organization.",
        )
    })?;
    let revoked_at: Option<chrono::DateTime<Utc>> = row
        .try_get("revoked_at")
        .map_err(|_| service_unavailable("The credential record is invalid."))?;
    if revoked_at.is_some() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            AccessReasonCode::InvalidRequest,
            "The credential is already revoked.",
            "Issue a new credential instead of rotating a revoked one.",
        ));
    }
    let subject: String = row
        .try_get("subject")
        .map_err(|_| service_unavailable("The credential record is invalid."))?;
    let agent_address: String = row
        .try_get("agent_address")
        .map_err(|_| service_unavailable("The credential record is invalid."))?;
    let capabilities: Value = row
        .try_get("capabilities")
        .map_err(|_| service_unavailable("The credential record is invalid."))?;

    let (secret, key_hash) = generate_api_key_secret();
    let key_prefix = &secret[..16];

    let mut transaction = state
        .repository
        .pool
        .begin()
        .await
        .map_err(|_| service_unavailable("Credential rotation could not be started."))?;
    sqlx::query("UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL")
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| service_unavailable("The prior credential could not be revoked."))?;
    let inserted = sqlx::query(
        "INSERT INTO api_keys (org_id, subject, agent_address, key_prefix, key_hash, capabilities, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at",
    )
    .bind(&context.tenant.org_id)
    .bind(&subject)
    .bind(&agent_address)
    .bind(key_prefix)
    .bind(key_hash)
    .bind(&capabilities)
    .bind(payload.expires_at)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| invalid_request("The credential could not be rotated; retry."))?;
    transaction
        .commit()
        .await
        .map_err(|_| service_unavailable("Credential rotation could not be committed."))?;

    let new_id: Uuid = inserted
        .try_get("id")
        .map_err(|_| service_unavailable("The credential record is invalid."))?;
    let created_at: chrono::DateTime<Utc> = inserted
        .try_get("created_at")
        .map_err(|_| service_unavailable("The credential record is invalid."))?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "id": new_id,
            "keyPrefix": key_prefix,
            "secret": secret,
            "agentAddress": agent_address,
            "subject": subject,
            "capabilities": capabilities,
            "expiresAt": payload.expires_at,
            "revokedAt": Value::Null,
            "createdAt": created_at,
        })),
    ))
}

pub async fn revoke_api_key_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let exists = sqlx::query("SELECT 1 FROM api_keys WHERE id = $1 AND org_id = $2")
        .bind(id)
        .bind(&context.tenant.org_id)
        .fetch_optional(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("The credential record is unavailable."))?;
    if exists.is_none() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::TenantScope,
            "The credential was not found in your organization.",
            "Use a credential issued for this organization.",
        ));
    }
    sqlx::query("UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL")
        .bind(id)
        .execute(&state.repository.pool)
        .await
        .map_err(|_| service_unavailable("The credential could not be revoked."))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_pbac_policies_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Vec<PbacPolicy>>, ApiError> {
    let policies = state
        .repository
        .load_pbac_policies(&context.tenant.org_id)
        .await
        .map_err(|_| {
            service_unavailable("The authorization policy set is temporarily unavailable.")
        })?;
    Ok(Json(policies))
}

pub async fn create_or_revise_pbac_policy_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<PbacPolicyRequest>,
) -> Result<(StatusCode, Json<PbacPolicy>), ApiError> {
    if payload.principals.len() > 64 || payload.actions.len() > 64 || payload.resources.len() > 64 {
        return Err(invalid_request(
            "A policy rule may declare at most 64 principals, actions, or resources.",
        ));
    }
    let principals = serde_json::to_value(&payload.principals)
        .map_err(|_| invalid_request("The policy principals are invalid."))?;
    let actions = serde_json::to_value(&payload.actions)
        .map_err(|_| invalid_request("The policy actions are invalid."))?;
    let resources = serde_json::to_value(&payload.resources)
        .map_err(|_| invalid_request("The policy resources are invalid."))?;
    let conditions = serde_json::to_value(&payload.conditions)
        .map_err(|_| invalid_request("The policy conditions are invalid."))?;
    let effect = match payload.effect {
        PolicyEffect::Allow => "allow",
        PolicyEffect::Deny => "deny",
    };

    let mut transaction = state
        .repository
        .pool
        .begin()
        .await
        .map_err(|_| service_unavailable("Policy authoring could not be started."))?;
    let (id, version, status) = if let Some(id) = payload.id {
        let current_version: Option<i64> = sqlx::query_scalar(
            "SELECT MAX(version) FROM authorization_policies WHERE org_id = $1 AND id = $2",
        )
        .bind(&context.tenant.org_id)
        .bind(id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| service_unavailable("The existing policy rule could not be read."))?;
        let Some(current_version) = current_version else {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                AccessReasonCode::InvalidRequest,
                "No policy rule with that id exists in your organization.",
                "Omit the id to create a new rule, or supply an existing one.",
            ));
        };
        sqlx::query(
            "UPDATE authorization_policies SET active = FALSE WHERE org_id = $1 AND id = $2 AND active = TRUE",
        )
        .bind(&context.tenant.org_id)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| service_unavailable("The prior policy version could not be retired."))?;
        (id, current_version + 1, StatusCode::OK)
    } else {
        (Uuid::now_v7(), 1i64, StatusCode::CREATED)
    };
    sqlx::query(
        "INSERT INTO authorization_policies (id, org_id, version, effect, principals, actions, resources, conditions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(id)
    .bind(&context.tenant.org_id)
    .bind(version)
    .bind(effect)
    .bind(&principals)
    .bind(&actions)
    .bind(&resources)
    .bind(&conditions)
    .execute(&mut *transaction)
    .await
    .map_err(|_| invalid_request("The policy rule could not be saved."))?;
    transaction
        .commit()
        .await
        .map_err(|_| service_unavailable("Policy authoring could not be committed."))?;

    Ok((
        status,
        Json(PbacPolicy {
            id,
            org_id: context.tenant.org_id.clone(),
            version,
            effect: payload.effect,
            principals: payload.principals,
            actions: payload.actions,
            resources: payload.resources,
            conditions: payload.conditions,
        }),
    ))
}

pub async fn deactivate_pbac_policy_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query(
        "UPDATE authorization_policies SET active = FALSE WHERE org_id = $1 AND id = $2 AND active = TRUE",
    )
    .bind(&context.tenant.org_id)
    .bind(id)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The policy rule could not be retired."))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::InvalidRequest,
            "No active policy rule with that id exists in your organization.",
            "Refresh the policy list and retry.",
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

fn default_abac_policy() -> AbacPolicy {
    AbacPolicy {
        allowed_cidrs: Vec::new(),
        require_mfa: false,
        max_amount: None,
        max_gas_price: None,
        trading_start_hour_utc: 0,
        trading_end_hour_utc: 24,
        allowed_environments: Vec::new(),
        blocked_risk_tiers: Vec::new(),
    }
}

pub async fn get_abac_policy_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<AbacPolicy>, ApiError> {
    let policy = state
        .repository
        .load_abac_policy(&context.tenant.org_id)
        .await
        .map_err(|_| service_unavailable("The organization controls are temporarily unavailable."))?
        .unwrap_or_else(default_abac_policy);
    Ok(Json(policy))
}

pub async fn put_abac_policy_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<AbacPolicyRequest>,
) -> Result<Json<AbacPolicy>, ApiError> {
    let policy = payload.policy;
    if policy.trading_start_hour_utc > 24 || policy.trading_end_hour_utc > 24 {
        return Err(invalid_request(
            "Trading hours must be between 0 and 24 UTC.",
        ));
    }
    let attributes = serde_json::to_value(&policy)
        .map_err(|_| invalid_request("The organization controls are invalid."))?;
    sqlx::query(
        "INSERT INTO tenant_policies (org_id, attributes) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET attributes = EXCLUDED.attributes, active = TRUE, updated_at = NOW()",
    )
    .bind(&context.tenant.org_id)
    .bind(&attributes)
    .execute(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("The organization controls could not be saved."))?;
    Ok(Json(policy))
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
    let (traceparent, trace_id) = crate::telemetry::extract_or_generate_traceparent(&headers);

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
                ("WWW-Authenticate", "x402".to_string()),
                ("X-402-Payment-Required", "true".to_string()),
                ("traceparent", traceparent),
                ("x-trace-id", trace_id),
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

    if state
        .chain
        .nonce_sequencer
        .try_acquire_nonce(request.agent, request.nonce)
        .is_err()
    {
        return x402_rejection(
            StatusCode::FORBIDDEN,
            OnchainReasonCode::NonceReused,
            Some(request.agent),
            state.config.chain_id,
        );
    }

    let Some(_tenant_permit) = state
        .tenant_concurrency
        .try_acquire(&format!("{:#x}", request.agent))
    else {
        state
            .chain
            .nonce_sequencer
            .release_nonce(request.agent, request.nonce);
        return tenant_capacity_error();
    };

    match state.chain.evaluate_policy(request.clone()).await {
        Ok((true, allowed_amount, reason_code, evaluated_at)) => {
            if reason_code != OnchainReasonCode::None.as_u8() {
                state
                    .chain
                    .nonce_sequencer
                    .release_nonce(request.agent, request.nonce);
                let reason = OnchainReasonCode::from_u8(reason_code)
                    .unwrap_or(OnchainReasonCode::SignatureInvalid);
                return x402_rejection(
                    StatusCode::FORBIDDEN,
                    reason,
                    Some(request.agent),
                    state.config.chain_id,
                );
            }

            let anomaly = state
                .anomaly_detector
                .assess_and_record(request.agent, request.amount);
            if anomaly.is_critical {
                state
                    .chain
                    .nonce_sequencer
                    .release_nonce(request.agent, request.nonce);
                return x402_rejection(
                    StatusCode::FORBIDDEN,
                    OnchainReasonCode::VelocityExceeded,
                    Some(request.agent),
                    state.config.chain_id,
                );
            }

            let task_id = Uuid::now_v7();
            let _ = state
                .settlement_queue
                .enqueue(crate::settlement::SettlementTask {
                    task_id,
                    request: request.clone(),
                    signature: signature.clone(),
                    token: state.config.usdc_token_address,
                    enqueued_at: Utc::now(),
                    trace_id: Some(trace_id.clone()),
                })
                .await;

            (
                StatusCode::OK,
                [
                    ("traceparent", traceparent),
                    ("x-trace-id", trace_id.clone()),
                    ("x-settlement-task-id", task_id.to_string()),
                    ("x-agentguard-anomaly-score", format!("{:.2}", anomaly.z_score)),
                ],
                Json(serde_json::json!({
                    "status": "policy_allowed",
                    "settlement": "Voucher admitted and enqueued into asynchronous settlement clearing pipeline.",
                    "taskId": task_id.to_string(),
                    "traceId": trace_id,
                    "anomalyScore": anomaly.z_score,
                    "isAnomaly": anomaly.is_anomaly,
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
            state
                .chain
                .nonce_sequencer
                .release_nonce(request.agent, request.nonce);
            let reason = OnchainReasonCode::from_u8(reason_code)
                .unwrap_or(OnchainReasonCode::SignatureInvalid);
            x402_rejection(
                StatusCode::FORBIDDEN,
                reason,
                Some(request.agent),
                state.config.chain_id,
            )
        }
        Err(_) => {
            state
                .chain
                .nonce_sequencer
                .release_nonce(request.agent, request.nonce);
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                AccessReasonCode::DependencyUnavailable,
                "The policy chain could not be reached.",
                "Retry after Monad RPC connectivity is restored.",
            )
            .into_response()
        }
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

fn x402_sse_rejection(
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
    let json_data = serde_json::to_string(&serde_json::json!({
        "type": "error",
        "error": {
            "type": "policy_denied",
            "reason_code": code.as_u8(),
            "reason_name": code.as_str(),
            "message": code.message(),
            "remediation": code.remediation(),
            "agent": body.agent,
            "window_reset_seconds": 3600
        }
    }))
    .unwrap_or_default();

    let sse_payload = format!("event: error\ndata: {json_data}\n\ndata: [DONE]\n\n");

    (
        status,
        [
            ("Content-Type", "text/event-stream"),
            ("Cache-Control", "no-cache"),
            ("Connection", "keep-alive"),
            ("X-AgentGuard-Reason-Code", &code.as_u8().to_string()),
        ],
        sse_payload,
    )
        .into_response()
}

pub async fn telemetry_stream(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    Sse::new(state.events.stream_for_tenant(context.tenant.org_id)).keep_alive(KeepAlive::default())
}

pub async fn list_telemetry_events_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        r#"SELECT event_name, agent_address, block_number, transaction_hash,
                  payload, observed_at
           FROM chain_events
           WHERE org_id = $1 AND finalized = TRUE
           ORDER BY block_number DESC, log_index DESC
           LIMIT 60"#,
    )
    .bind(&context.tenant.org_id)
    .fetch_all(&state.repository.pool)
    .await
    .map_err(|_| service_unavailable("Finalized telemetry is temporarily unavailable."))?;
    rows.into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "eventName": row.try_get::<String, _>("event_name")?,
                "agentAddress": row.try_get::<Option<String>, _>("agent_address")?,
                "blockNumber": row.try_get::<i64, _>("block_number")? as u64,
                "transactionHash": row.try_get::<String, _>("transaction_hash")?,
                "payload": row.try_get::<Value, _>("payload")?,
                "observedAt": row.try_get::<chrono::DateTime<Utc>, _>("observed_at")?
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map(Json)
        .map_err(|_| service_unavailable("Finalized telemetry returned an invalid record."))
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
    let tenant_name =
        sqlx::query_scalar::<_, String>("SELECT display_name FROM organizations WHERE org_id = $1")
            .bind(&context.tenant.org_id)
            .fetch_optional(&state.repository.pool)
            .await
            .unwrap_or(None);

    Ok(Json(RoleResponse {
        success: true,
        subject: subject.clone(),
        org_id: context.tenant.org_id,
        tenant_name,
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
    let tenant_name =
        sqlx::query_scalar::<_, String>("SELECT display_name FROM organizations WHERE org_id = $1")
            .bind(&context.tenant.org_id)
            .fetch_optional(&state.repository.pool)
            .await
            .unwrap_or(None);

    let response = RoleResponse {
        success: true,
        subject: subject.clone(),
        org_id: context.tenant.org_id.clone(),
        tenant_name,
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

pub async fn get_tenant_pricing_model_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
) -> Result<Json<crate::types::TenantPricingModelResponse>, ApiError> {
    let pricing = state
        .repository
        .load_tenant_pricing_model(&context.tenant.org_id)
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Failed to load tenant pricing model");
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The organization pricing model could not be loaded.",
                "Retry after the policy store is healthy.",
            )
        })?;

    let catalog = crate::finops::get_official_catalog();
    let tool_catalog = crate::finops::get_official_tool_catalog();
    Ok(Json(crate::types::TenantPricingModelResponse {
        pricing,
        catalog,
        tool_catalog,
    }))
}

pub async fn update_tenant_pricing_model_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<crate::types::UpdatePricingModelRequest>,
) -> Result<Json<crate::types::TenantPricingModel>, ApiError> {
    crate::finops::validate_pricing_model(&payload).map_err(invalid_request)?;
    let updated = state
        .repository
        .upsert_tenant_pricing_model(&context.tenant.org_id, &payload)
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Failed to update tenant pricing model");
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The organization pricing model could not be saved.",
                "Retry after the policy store is healthy.",
            )
        })?;

    Ok(Json(updated))
}

pub async fn calculate_spend_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<crate::types::CalculateSpendRequest>,
) -> Result<Json<crate::types::FinOpsSpendResult>, ApiError> {
    let pricing = state
        .repository
        .load_tenant_pricing_model(&context.tenant.org_id)
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Failed to load tenant pricing model for calculation");
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                AccessReasonCode::DependencyUnavailable,
                "The organization pricing model could not be loaded.",
                "Retry after the policy store is healthy.",
            )
        })?;

    let mut result = crate::finops::calculate_inference_spend(
        &payload.model_name,
        payload.input_tokens,
        payload.output_tokens,
        payload.cache_read_tokens,
        payload.cache_creation_tokens,
        &pricing,
    )
    .map_err(|_| invalid_request("The requested model has no configured pricing rate."))?;

    if payload.is_batch && result.contract_model != crate::types::PricingModelType::BatchDiscount {
        result.effective_cost_micro_dollars /= 2;
        result.effective_discount_bps = result.effective_discount_bps.max(5000);
    }

    for tc in &payload.tool_calls {
        let tool_cost = crate::finops::calculate_tool_spend(&tc.tool_id, tc.count, &pricing);
        result.tool_cost_micro_dollars = result.tool_cost_micro_dollars.saturating_add(tool_cost);
        result.effective_cost_micro_dollars = result
            .effective_cost_micro_dollars
            .saturating_add(tool_cost);
        result.nominal_list_cost_micro_dollars = result
            .nominal_list_cost_micro_dollars
            .saturating_add(tool_cost);
    }

    Ok(Json(result))
}

pub async fn compile_policy_handler(
    State(_state): State<SharedState>,
    Extension(_context): Extension<RequestContext>,
    Json(payload): Json<crate::qwen::CompilePolicyRequest>,
) -> Result<Json<crate::qwen::CompiledPolicyResult>, ApiError> {
    let result = crate::qwen::compile_policy_from_prompt(&payload.prompt);
    Ok(Json(result))
}

pub async fn chat_completions_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(payload): Json<crate::qwen::QwenChatRequest>,
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
                service_id: "alibaba.qwen.chat.completions".to_string(),
                category: "inference".to_string(),
                description: "Qwen 3.8 Max policy-gated LLM chat completions".to_string(),
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

    let is_stream = payload.stream.unwrap_or(false)
        || headers
            .get("accept")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|h| h.contains("text/event-stream"));

    let reject = |status, code, agent| {
        if is_stream {
            x402_sse_rejection(status, code, agent, state.config.chain_id)
        } else {
            x402_rejection(status, code, agent, state.config.chain_id)
        }
    };

    let (request, signature) = match crate::crypto::parse_x402_authorization_header(auth_header) {
        Ok(value) => value,
        Err(_) => {
            return reject(
                StatusCode::BAD_REQUEST,
                OnchainReasonCode::SignatureInvalid,
                None,
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
            return reject(
                StatusCode::FORBIDDEN,
                OnchainReasonCode::SignatureInvalid,
                Some(request.agent),
            );
        }
    };
    if recovered != request.agent {
        return reject(
            StatusCode::FORBIDDEN,
            OnchainReasonCode::SignatureInvalid,
            Some(request.agent),
        );
    }
    if request.merchant != state.config.merchant_address {
        return reject(
            StatusCode::FORBIDDEN,
            OnchainReasonCode::MerchantNotAllowed,
            Some(request.agent),
        );
    }

    let Some(_tenant_permit) = state
        .tenant_concurrency
        .try_acquire(&format!("{:#x}", request.agent))
    else {
        return tenant_capacity_error();
    };

    let _streaming_guard = if is_stream {
        let agent_str = format!("{:#x}", request.agent);
        let estimated_tokens = payload.max_tokens.unwrap_or(2048) as u64 + 1024;
        Some(
            state
                .streaming_reserves
                .acquire_guard(&agent_str, estimated_tokens),
        )
    } else {
        None
    };

    match state.chain.evaluate_policy(request.clone()).await {
        Ok((true, allowed_amount, reason_code, evaluated_at)) => {
            if reason_code != OnchainReasonCode::None.as_u8() {
                let reason = OnchainReasonCode::from_u8(reason_code)
                    .unwrap_or(OnchainReasonCode::SignatureInvalid);
                return reject(StatusCode::FORBIDDEN, reason, Some(request.agent));
            }

            // Upstream forward to Alibaba Model Studio if key is provisioned
            if is_stream {
                return ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "Streaming Qwen responses are not configured on this gateway.",
                    "Use a non-streaming request or configure the streaming provider adapter.",
                )
                .into_response();
            }

            let Some(_provider_permit) = try_provider_permit(&state) else {
                return provider_capacity_error();
            };

            let qwen_res = match crate::qwen::forward_to_qwen_api(
                &state.http_client,
                &state.config.dashscope_base_url,
                state.config.dashscope_api_key.as_deref(),
                payload.clone(),
            )
            .await
            {
                Ok(resp) => resp,
                Err(err) => return err.into_response(),
            };

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "policy_allowed",
                    "model": payload.model,
                    "qwenResponse": qwen_res,
                    "policyDecision": {
                        "allowed": true,
                        "allowedAmount": allowed_amount.to_string(),
                        "reasonCode": reason_code,
                        "evaluatedAt": evaluated_at.to_string()
                    },
                    "settlement": "Policy authorization completed; provider response verified by the configured upstream adapter."
                })),
            )
                .into_response()
        }
        Ok((false, _, reason_code, _)) => {
            let reason = OnchainReasonCode::from_u8(reason_code)
                .unwrap_or(OnchainReasonCode::SignatureInvalid);
            reject(StatusCode::FORBIDDEN, reason, Some(request.agent))
        }
        Err(_) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            crate::error::AccessReasonCode::DependencyUnavailable,
            "The policy chain could not be reached.",
            "Retry after Monad RPC connectivity is restored.",
        )
        .into_response(),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnthropicMessagesRequest {
    pub model: String,
    pub messages: Vec<serde_json::Value>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub system: Option<serde_json::Value>,
    #[serde(default)]
    pub stream: Option<bool>,
}

pub async fn anthropic_messages_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(payload): Json<AnthropicMessagesRequest>,
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
                service_id: "anthropic.messages.completion".to_string(),
                category: "inference".to_string(),
                description: "Anthropic Messages policy-gated LLM inference proxy".to_string(),
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

    let is_stream = payload.stream.unwrap_or(false)
        || headers
            .get("accept")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|h| h.contains("text/event-stream"));

    let reject = |status, code, agent| {
        if is_stream {
            x402_sse_rejection(status, code, agent, state.config.chain_id)
        } else {
            x402_rejection(status, code, agent, state.config.chain_id)
        }
    };

    let (request, signature) = match crate::crypto::parse_x402_authorization_header(auth_header) {
        Ok(value) => value,
        Err(_) => {
            return reject(
                StatusCode::BAD_REQUEST,
                OnchainReasonCode::SignatureInvalid,
                None,
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
            return reject(
                StatusCode::FORBIDDEN,
                OnchainReasonCode::SignatureInvalid,
                Some(request.agent),
            );
        }
    };
    if recovered != request.agent {
        return reject(
            StatusCode::FORBIDDEN,
            OnchainReasonCode::SignatureInvalid,
            Some(request.agent),
        );
    }
    if request.merchant != state.config.merchant_address {
        return reject(
            StatusCode::FORBIDDEN,
            OnchainReasonCode::MerchantNotAllowed,
            Some(request.agent),
        );
    }

    let Some(_tenant_permit) = state
        .tenant_concurrency
        .try_acquire(&format!("{:#x}", request.agent))
    else {
        return tenant_capacity_error();
    };

    let _streaming_guard = if is_stream {
        let agent_str = format!("{:#x}", request.agent);
        let estimated_tokens = payload.max_tokens.unwrap_or(2048) as u64 + 1024;
        Some(
            state
                .streaming_reserves
                .acquire_guard(&agent_str, estimated_tokens),
        )
    } else {
        None
    };

    match state.chain.evaluate_policy(request.clone()).await {
        Ok((true, allowed_amount, reason_code, evaluated_at)) => {
            if reason_code != OnchainReasonCode::None.as_u8() {
                let reason = OnchainReasonCode::from_u8(reason_code)
                    .unwrap_or(OnchainReasonCode::SignatureInvalid);
                return reject(StatusCode::FORBIDDEN, reason, Some(request.agent));
            }

            if is_stream {
                return ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    AccessReasonCode::DependencyUnavailable,
                    "Streaming Anthropic responses are not configured on this gateway.",
                    "Use a non-streaming request or configure the streaming provider adapter.",
                )
                .into_response();
            }

            let Some(_provider_permit) = try_provider_permit(&state) else {
                return provider_capacity_error();
            };

            let mut provider_response = match forward_to_anthropic_api(
                &state.http_client,
                &state.config.anthropic_base_url,
                state.config.anthropic_api_key.as_deref(),
                &payload,
            )
            .await
            {
                Ok(response) => response,
                Err(error) => return error.into_response(),
            };
            if let Some(object) = provider_response.as_object_mut() {
                object.insert(
                    "policyDecision".to_string(),
                    serde_json::json!({
                        "allowed": true,
                        "allowedAmount": allowed_amount.to_string(),
                        "reasonCode": reason_code,
                        "evaluatedAt": evaluated_at.to_string()
                    }),
                );
                object.insert(
                    "settlement".to_string(),
                    serde_json::json!("Policy authorization completed; provider response verified by the configured upstream adapter."),
                );
            }

            (StatusCode::OK, Json(provider_response)).into_response()
        }
        Ok((false, _, reason_code, _)) => {
            let reason = OnchainReasonCode::from_u8(reason_code)
                .unwrap_or(OnchainReasonCode::SignatureInvalid);
            reject(StatusCode::FORBIDDEN, reason, Some(request.agent))
        }
        Err(_) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            crate::error::AccessReasonCode::DependencyUnavailable,
            "The policy chain could not be reached.",
            "Retry after Monad RPC connectivity is restored.",
        )
        .into_response(),
    }
}

async fn forward_to_anthropic_api(
    http_client: &reqwest::Client,
    base_url: &str,
    api_key: Option<&str>,
    request: &AnthropicMessagesRequest,
) -> Result<Value, ApiError> {
    let Some(key) = api_key else {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            AccessReasonCode::DependencyUnavailable,
            "Anthropic API credentials are not provisioned on this gateway instance.",
            "Configure ANTHROPIC_API_KEY to enable real Anthropic Messages responses.",
        ));
    };

    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "max_tokens": request.max_tokens.unwrap_or(1024),
        "stream": false
    });
    if let Some(temperature) = request.temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    if let Some(system) = &request.system {
        body["system"] = system.clone();
    }

    let response = http_client
        .post(format!("{}/messages", base_url.trim_end_matches('/')))
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Anthropic upstream request failed");
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                AccessReasonCode::DependencyUnavailable,
                "Unable to connect to the Anthropic provider.",
                "Retry after Anthropic provider connectivity is restored.",
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let _ = response.bytes().await;
        tracing::warn!(%status, "Anthropic upstream returned an error");
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The Anthropic provider rejected the request.",
            "Verify provider credentials, model access, and quota.",
        ));
    }

    response.json::<Value>().await.map_err(|error| {
        tracing::warn!(%error, "Invalid Anthropic response payload");
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            AccessReasonCode::DependencyUnavailable,
            "The Anthropic provider returned an invalid response.",
            "Retry after the provider returns a valid Messages response.",
        )
    })
}

/// ERC-7677 / ERC-4337 Paymaster JSON-RPC endpoint (ADR-0014 / Tier-1 Paymaster Architecture)
pub async fn paymaster_rpc_handler(
    State(state): State<SharedState>,
    Json(req): Json<crate::types::PaymasterRpcRequest>,
) -> Response {
    let id = req.id;
    if !matches!(
        req.method.as_str(),
        "pm_getPaymasterStubData" | "pm_getPaymasterData"
    ) {
        return paymaster_rpc_error(id, -32601, &format!("Method '{}' not found", req.method));
    }
    let paymaster_addr = format!("{:#x}", state.config.circuit_paymaster_address);

    let params = req.params.as_ref().and_then(Value::as_array);
    let user_operation = params
        .and_then(|values| values.first())
        .and_then(Value::as_object);
    let Some(user_operation) = user_operation else {
        return paymaster_rpc_error(
            id,
            -32602,
            "Paymaster requests must include a UserOperation object.",
        );
    };
    let Some(sender) = user_operation
        .get("sender")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<Address>().ok())
    else {
        return paymaster_rpc_error(id, -32602, "UserOperation.sender is invalid.");
    };

    let max_cost = match paymaster_max_cost(user_operation) {
        Ok(value) => value,
        Err(message) => return paymaster_rpc_error(id, -32602, &message),
    };

    let (eligible, reason_code) = match state
        .chain
        .paymaster_sponsorship_eligibility(sender, max_cost)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "Paymaster eligibility RPC failed");
            return paymaster_rpc_error(
                id,
                -32000,
                "Paymaster eligibility could not be verified onchain.",
            );
        }
    };
    if !eligible {
        return paymaster_rpc_error(
            id,
            -32000,
            &format!("Paymaster sponsorship rejected with reason code {reason_code}."),
        );
    }

    match req.method.as_str() {
        "pm_getPaymasterStubData" => {
            let res = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "paymaster": paymaster_addr,
                    "paymasterData": "0x",
                    "paymasterVerificationGasLimit": format!(
                        "{:#x}",
                        state.config.paymaster_verification_gas_limit
                    ),
                    "paymasterPostOpGasLimit": format!(
                        "{:#x}",
                        state.config.paymaster_post_op_gas_limit
                    ),
                    "sponsor": true
                }
            });
            (StatusCode::OK, Json(res)).into_response()
        }
        "pm_getPaymasterData" => {
            let res = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "paymasterAndData": paymaster_addr
                }
            });
            (StatusCode::OK, Json(res)).into_response()
        }
        _ => unreachable!("unsupported paymaster method was rejected above"),
    }
}

fn paymaster_rpc_error(id: Value, code: i32, message: &str) -> Response {
    let res = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    });
    (StatusCode::OK, Json(res)).into_response()
}

fn paymaster_max_cost(operation: &serde_json::Map<String, Value>) -> Result<U256, String> {
    let quantity = |name: &str| -> Result<U256, String> {
        let value = operation
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("UserOperation.{name} is required."))?;
        let normalized = value.strip_prefix("0x").unwrap_or(value);
        U256::from_str_radix(normalized, 16)
            .map_err(|_| format!("UserOperation.{name} is invalid."))
    };
    let gas = quantity("callGasLimit")?
        .checked_add(quantity("verificationGasLimit")?)
        .ok_or_else(|| "UserOperation gas limits overflow.".to_string())?;
    let gas = gas
        .checked_add(quantity("preVerificationGas")?)
        .ok_or_else(|| "UserOperation gas limits overflow.".to_string())?;
    gas.checked_mul(quantity("maxFeePerGas")?)
        .ok_or_else(|| "UserOperation max cost overflows.".to_string())
}

/// Distributed FinOps Multi-Region Token Volume Synchronization (ADR-0010 multi-region)
pub async fn finops_sync_handler(
    State(state): State<SharedState>,
    Extension(context): Extension<RequestContext>,
    Json(payload): Json<crate::finops::FinopsSyncPayload>,
) -> Result<Json<crate::finops::FinopsSyncResponse>, ApiError> {
    let org_id = context.tenant.org_id.to_string();
    if payload.org_id != org_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            AccessReasonCode::TenantScope,
            "The synchronization payload does not belong to the authenticated organization.",
            "Submit the payload within its organization scope.",
        ));
    }
    if payload.sequence_number == 0 {
        return Err(invalid_request(
            "The synchronization sequence number must be positive.",
        ));
    }

    let (synced, model) = state
        .repository
        .apply_finops_sync(
            &org_id,
            &payload.node_id,
            payload.sequence_number,
            payload.delta_tokens,
        )
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Durable FinOps synchronization failed");
            service_unavailable(
                "The distributed FinOps synchronization could not be durably recorded.",
            )
        })?;
    let (tier_idx, discount) = crate::finops::compute_active_tier_and_discount(&model);

    Ok(Json(crate::finops::FinopsSyncResponse {
        synced,
        org_id,
        reconciled_monthly_tokens: model.monthly_tokens_consumed,
        active_discount_bps: discount,
        current_tier_index: tier_idx,
    }))
}

#[derive(Debug, serde::Deserialize)]
pub struct SettlementOutboxQuery {
    pub limit: Option<i64>,
    pub status: Option<String>,
}

pub async fn list_settlement_outbox_handler(
    State(state): State<SharedState>,
    axum::extract::Query(query): axum::extract::Query<SettlementOutboxQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let status_filter = query.status.as_deref();

    let items = state
        .repository
        .list_settlement_outbox(limit, status_filter)
        .await
        .map_err(|error| {
            tracing::error!(%error, "Failed to list settlement outbox");
            service_unavailable("Unable to query settlement outbox records.")
        })?;

    let stats = state
        .repository
        .get_settlement_queue_stats()
        .await
        .map_err(|error| {
            tracing::error!(%error, "Failed to get settlement queue stats");
            service_unavailable("Unable to query settlement queue stats.")
        })?;

    Ok(Json(serde_json::json!({
        "stats": stats,
        "items": items,
    })))
}

pub async fn retry_settlement_outbox_handler(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let replayed = state
        .repository
        .retry_dead_letter_settlement(id)
        .await
        .map_err(|error| {
            tracing::error!(%error, %id, "Failed to retry dead letter voucher");
            service_unavailable("Unable to retry dead letter voucher.")
        })?;

    if !replayed {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::InvalidRequest,
            "The dead-letter voucher was not found or is not in dead_letter status.",
            "Verify the outbox voucher ID and status.",
        ));
    }

    Ok(Json(serde_json::json!({
        "status": "requeued",
        "id": id,
        "message": "Voucher requeued into pending settlement pipeline for immediate clearing."
    })))
}

/// Returns live status, active nonces, and tip escalation stats for the sharded relayer fleet.
pub async fn list_relayers_handler(State(state): State<SharedState>) -> impl IntoResponse {
    let stats = state.relayer_pool.stats();
    Json(stats)
}

/// Generates a cryptographic Merkle inclusion proof for a settlement outbox record against recent batch state.
pub async fn get_audit_proof_handler(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let items = state
        .repository
        .list_settlement_outbox(100, None)
        .await
        .map_err(|error| {
            tracing::error!(%error, "Failed to list settlement outbox for audit proof");
            service_unavailable("Unable to query settlement outbox records.")
        })?;

    let target_idx = items.iter().position(|it| it.id == id);
    let Some(idx) = target_idx else {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            AccessReasonCode::InvalidRequest,
            "The requested settlement voucher was not found in the recent audit batch.",
            "Verify the voucher ID.",
        ));
    };

    let leaves: Vec<alloy::primitives::B256> = items
        .iter()
        .map(|it| {
            crate::audit_anchor::compute_outbox_leaf(
                it.id,
                &it.agent_address,
                &it.merchant_address,
                &it.amount,
                &it.nonce,
                it.tx_hash.as_deref(),
            )
        })
        .collect();

    let mut proof = crate::audit_anchor::generate_merkle_proof(&leaves, idx).ok_or_else(|| {
        service_unavailable("Failed to construct Merkle inclusion proof for voucher.")
    })?;
    proof.outbox_id = id;

    Ok(Json(serde_json::json!({
        "status": "verified",
        "proof": proof,
        "anchor_registry": format!("{:#x}", state.config.agent_wallet_guard_address),
    })))
}

/// Evaluates zero-knowledge spend proofs with confidential nullifiers and policy commitments.
pub async fn verify_zk_spend_handler(
    State(state): State<SharedState>,
    Json(payload): Json<crate::zk::ZkSpendRequest>,
) -> Result<Json<crate::zk::ZkVerificationResult>, ApiError> {
    let agent: Address = payload.agent.parse().map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            AccessReasonCode::InvalidRequest,
            "The provided agent address is invalid.",
            "Provide a valid 20-byte EVM agent address.",
        )
    })?;

    let result = state.zk_engine.verify_and_consume(agent, &payload.proof);
    Ok(Json(result))
}

/// Dispatches an MEV-shielded private bundle directly to Monad block builders.
pub async fn dispatch_mev_bundle_handler(
    State(state): State<SharedState>,
    Json(payload): Json<crate::bundle_relay::MevBundleRequest>,
) -> Result<Json<crate::bundle_relay::MevBundleResult>, ApiError> {
    let result = state.bundle_relay.dispatch_bundle(payload).await;
    Ok(Json(result))
}

/// Returns real-time metrics for private builder relay and sandwich defense.
pub async fn get_mev_stats_handler(
    State(state): State<SharedState>,
) -> Result<Json<crate::bundle_relay::MevRelayStats>, ApiError> {
    let stats = state.bundle_relay.get_stats();
    Ok(Json(stats))
}

/// Inspects raw transaction calldata and returns human-readable clear-signing metadata and risk analysis.
pub async fn inspect_calldata_handler(
    Json(payload): Json<crate::calldata_decoder::CalldataInspectionRequest>,
) -> Result<Json<crate::calldata_decoder::CalldataInspectionResponse>, ApiError> {
    let result = crate::calldata_decoder::CalldataDecoder::inspect(&payload);
    Ok(Json(result))
}

/// Records a liveness heartbeat for an autonomous agent.
pub async fn record_heartbeat_handler(
    State(state): State<SharedState>,
    Json(payload): Json<crate::heartbeat::AgentHeartbeatRequest>,
) -> Result<Json<crate::heartbeat::AgentLivenessStatus>, ApiError> {
    let result = state.heartbeat_manager.record_heartbeat(payload);
    Ok(Json(result))
}

/// Retrieves the current liveness telemetry and expiration status for an agent.
pub async fn get_heartbeat_status_handler(
    State(state): State<SharedState>,
    Path(agent): Path<String>,
) -> Result<Json<crate::heartbeat::AgentLivenessStatus>, ApiError> {
    let now = chrono::Utc::now().timestamp() as u64;
    let result = state.heartbeat_manager.get_status(&agent, now);
    Ok(Json(result))
}

/// Returns the current multi-region edge cluster topology and budget partition leases.
pub async fn get_edge_topology_handler(
    State(state): State<SharedState>,
) -> Result<Json<crate::edge_sequencer::EdgeTopologyResponse>, ApiError> {
    let result = state.edge_sequencer.get_topology();
    Ok(Json(result))
}
