use axum::{routing::get, Router};
use reqwest::Client;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use agentguard_gateway::config::Config;
use agentguard_gateway::handlers::{
    get_user_role_handler, health_handler, inference_handler, paymaster_rpc_handler,
    ready_handler, update_user_role_handler, AppState,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "agentguard_gateway=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Initializing AgentGuard High-Throughput Rust Gateway...");

    let config = Config::from_env().map_err(|e| {
        tracing::error!("Configuration error: {}", e);
        e
    })?;

    info!("Loaded configuration: Chain ID = {}, RPC = {}", config.chain_id, config.rpc_url);
    info!("PolicyEngine Contract: {:#x}", config.policy_engine_address);
    info!("AgentWalletGuard Contract: {:#x}", config.agent_wallet_guard_address);
    info!("Super Admin Allowlist DIDs count: {}", config.initial_super_admin_dids.len());

    let http_client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let state = Arc::new(AppState {
        config: config.clone(),
        http_client,
        local_roles: RwLock::new(HashMap::new()),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers([
            axum::http::HeaderName::from_static("www-authenticate"),
            axum::http::HeaderName::from_static("x-402-payment-required"),
            axum::http::HeaderName::from_static("x-agentguard-reason-code"),
        ]);

    let app = Router::new()
        // Health & Status
        .route("/health", get(health_handler))
        .route("/ready", get(ready_handler))
        .route("/api/v1/health", get(health_handler))
        // x402 Protocol Routes
        .route("/v1/inference", get(inference_handler).post(inference_handler))
        .route("/api/v1/inference", get(inference_handler).post(inference_handler))
        // ERC-7677 Paymaster RPC Routes
        .route("/v1/paymaster", axum::routing::post(paymaster_rpc_handler))
        .route("/api/v1/paymaster", axum::routing::post(paymaster_rpc_handler))
        // Privy Role Administration Routes
        .route("/api/v1/users/:did/role", get(get_user_role_handler).post(update_user_role_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("AgentGuard Rust Gateway listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
