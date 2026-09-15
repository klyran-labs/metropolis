use agentguard_gateway::{
    auth::AuthService,
    chain::ChainClient,
    config::Config,
    handlers::{
        AppState, authentication_middleware, authorization_middleware, checkout_handler,
        create_api_key_handler, create_onboarding_tenant_handler,
        create_or_revise_pbac_policy_handler, create_plan_handler, create_signing_wallet_handler,
        create_tenant_handler, deactivate_pbac_policy_handler, get_abac_policy_handler,
        get_agent_policy_handler, get_platform_reconciliation_handler,
        get_platform_revenue_summary_handler, get_subscription_handler, get_user_role_handler,
        grant_wallet_access_handler, health_handler, inference_handler, list_agents_handler,
        list_api_keys_handler, list_organization_wallets_handler, list_pbac_policies_handler,
        list_plans_handler, list_platform_ledger_handler, list_platform_operators_handler,
        list_platform_subscriptions_handler, list_signing_wallets_handler,
        list_telemetry_events_handler, list_tenant_operators_handler, list_tenants_handler,
        list_wallet_access_handler, list_wallet_transfers_handler,
        onboarding_authentication_middleware, prepare_agent_policy_handler, prepare_load_handler,
        prepare_unload_handler, put_abac_policy_handler, ready_handler, register_agent_handler,
        register_organization_wallet_handler, revoke_api_key_handler, revoke_wallet_access_handler,
        rotate_api_key_handler, sign_approval_ticket_handler, submit_payment_handler,
        submit_wallet_transfer_handler, telemetry_stream, update_user_role_handler,
        update_wallet_threshold_handler, upsert_platform_operator_handler,
    },
    repository::PgRepository,
    telemetry::EventHub,
};
use axum::{Router, http::HeaderValue, middleware, routing::get};
use reqwest::Client;
use sqlx::postgres::PgPoolOptions;
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "agentguard_gateway=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env().map_err(|error| {
        error!(%error, "Gateway configuration rejected");
        error
    })?;
    let http_client = Client::builder().timeout(Duration::from_secs(10)).build()?;
    let pool = PgPoolOptions::new()
        .max_connections(32)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let repository = PgRepository::new(pool);
    let chain = ChainClient::new(config.clone(), http_client.clone())?;
    chain.verify_contracts().await?;
    let events = EventHub::new();
    let auth = AuthService::new(config.clone(), http_client.clone(), repository.clone());
    let state = Arc::new(AppState {
        config: config.clone(),
        http_client,
        repository: repository.clone(),
        auth,
        chain: chain.clone(),
        events: events.clone(),
    });

    let public = Router::new()
        .route("/health", get(health_handler))
        .route("/api/v1/health", get(health_handler))
        .route("/ready", get(ready_handler))
        .route(
            "/v1/inference",
            get(inference_handler).post(inference_handler),
        )
        .route(
            "/api/v1/inference",
            get(inference_handler).post(inference_handler),
        );

    let onboarding = Router::new()
        .route(
            "/api/v1/onboarding/tenant",
            axum::routing::post(create_onboarding_tenant_handler),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            onboarding_authentication_middleware,
        ));

    let protected = Router::new()
        .route(
            "/api/v1/telemetry/events",
            get(list_telemetry_events_handler),
        )
        .route("/api/v1/telemetry/stream", get(telemetry_stream))
        .route(
            "/api/v1/agents",
            get(list_agents_handler).post(register_agent_handler),
        )
        .route(
            "/api/v1/agents/:agent/policy",
            get(get_agent_policy_handler).post(prepare_agent_policy_handler),
        )
        .route(
            "/api/v1/platform/plans",
            get(list_plans_handler).post(create_plan_handler),
        )
        .route("/api/v1/plans", get(list_plans_handler))
        .route(
            "/api/v1/platform/tenants",
            get(list_tenants_handler).post(create_tenant_handler),
        )
        .route(
            "/api/v1/platform/subscriptions",
            get(list_platform_subscriptions_handler),
        )
        .route(
            "/api/v1/platform/billing/ledger",
            get(list_platform_ledger_handler),
        )
        .route(
            "/api/v1/platform/billing/revenue-summary",
            get(get_platform_revenue_summary_handler),
        )
        .route(
            "/api/v1/platform/billing/reconciliation",
            get(get_platform_reconciliation_handler),
        )
        .route(
            "/api/v1/platform/operators",
            get(list_platform_operators_handler).post(upsert_platform_operator_handler),
        )
        .route("/api/v1/subscription", get(get_subscription_handler))
        .route(
            "/api/v1/subscription/checkout",
            axum::routing::post(checkout_handler),
        )
        .route(
            "/api/v1/billing/payments/:payment_id/submit",
            axum::routing::post(submit_payment_handler),
        )
        .route(
            "/api/v1/users/:subject/role",
            get(get_user_role_handler).post(update_user_role_handler),
        )
        .route(
            "/api/v1/tenant/operators",
            get(list_tenant_operators_handler),
        )
        .route(
            "/api/v1/signing/vault",
            get(list_signing_wallets_handler).post(create_signing_wallet_handler),
        )
        .route(
            "/api/v1/organization/wallets",
            get(list_organization_wallets_handler).post(register_organization_wallet_handler),
        )
        .route(
            "/api/v1/organization/wallets/:wallet_id",
            axum::routing::patch(update_wallet_threshold_handler),
        )
        .route(
            "/api/v1/organization/wallets/:wallet_id/access",
            get(list_wallet_access_handler).post(grant_wallet_access_handler),
        )
        .route(
            "/api/v1/organization/wallets/:wallet_id/access/:subject",
            axum::routing::delete(revoke_wallet_access_handler),
        )
        .route(
            "/api/v1/agents/:agent/load",
            axum::routing::post(prepare_load_handler),
        )
        .route(
            "/api/v1/agents/:agent/unload",
            axum::routing::post(prepare_unload_handler),
        )
        .route(
            "/api/v1/agents/:agent/wallet-transfers",
            get(list_wallet_transfers_handler),
        )
        .route(
            "/api/v1/wallet-transfers/:transfer_id/submit",
            axum::routing::post(submit_wallet_transfer_handler),
        )
        .route(
            "/api/v1/wallet-transfers/:transfer_id/approve",
            axum::routing::post(sign_approval_ticket_handler),
        )
        .route(
            "/api/v1/api-keys",
            get(list_api_keys_handler).post(create_api_key_handler),
        )
        .route(
            "/api/v1/api-keys/:id",
            axum::routing::patch(rotate_api_key_handler).delete(revoke_api_key_handler),
        )
        .route(
            "/api/v1/policies/pbac",
            get(list_pbac_policies_handler).post(create_or_revise_pbac_policy_handler),
        )
        .route(
            "/api/v1/policies/pbac/:id",
            axum::routing::delete(deactivate_pbac_policy_handler),
        )
        .route(
            "/api/v1/policies/abac",
            get(get_abac_policy_handler).put(put_abac_policy_handler),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            authorization_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            authentication_middleware,
        ));

    let cors_origins = config
        .cors_allowed_origins
        .iter()
        .map(|origin| origin.parse::<HeaderValue>())
        .collect::<Result<Vec<_>, _>>()?;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(cors_origins))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PATCH,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
        ])
        .allow_headers(Any);

    let app = public
        .merge(onboarding)
        .merge(protected)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    tokio::spawn(chain.run_event_listener(repository, events));
    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!(
        chain_id = config.chain_id,
        port = config.port,
        "AgentGuard gateway started"
    );
    let listener = tokio::net::TcpListener::bind(address).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
