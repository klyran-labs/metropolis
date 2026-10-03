//! Typed, schema-bearing responses for the endpoints the web console depends on most.
//!
//! The same structs serialize the real responses and generate `docs/api/ui-contract.json`, so the
//! published contract cannot drift from the gateway. The web test suite validates its fixtures
//! against that file, which in turn keeps the UI honest about what the gateway returns.

use chrono::{DateTime, Utc};
use schemars::{JsonSchema, schema_for};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentDto {
    pub address: String,
    pub admin_address: String,
    pub environment: String,
    pub risk_tier: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    /// `sovereign` (wallet hosted by AgentGuard) or `external`.
    pub wallet_source: String,
    pub label: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationWalletDto {
    pub id: Uuid,
    pub address: String,
    pub label: String,
    /// `sovereign` or `external`.
    pub kind: String,
    pub approval_threshold: i16,
    pub status: String,
    pub created_by_subject: String,
    pub created_at: DateTime<Utc>,
    pub access_count: i64,
    pub has_access: bool,
    /// USDC balance in base units; absent when the chain could not be read.
    pub balance_base_units: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WalletsResponse {
    pub wallets: Vec<OrganizationWalletDto>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WalletTransferDto {
    pub id: Uuid,
    /// `load` or `unload`.
    pub direction: String,
    pub amount_base_units: String,
    /// `pending`, `pending_approval`, `confirmed` or `failed`.
    pub status: String,
    pub transaction_hash: Option<String>,
    pub failure_reason: Option<String>,
    pub initiated_by_subject: String,
    pub created_at: DateTime<Utc>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub wallet_label: String,
    pub wallet_address: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WalletTransfersResponse {
    pub transfers: Vec<WalletTransferDto>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEventDto {
    pub event_name: String,
    pub agent_address: Option<String>,
    pub block_number: u64,
    pub transaction_hash: String,
    pub payload: Value,
    pub observed_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingApprovalDto {
    pub transfer_id: Uuid,
    pub direction: String,
    pub amount_base_units: String,
    pub agent_address: String,
    pub initiated_by_subject: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub wallet_id: Uuid,
    pub wallet_label: String,
    pub wallet_address: String,
    pub signatures: usize,
    pub required_signatures: i16,
    pub already_signed: bool,
    pub can_approve: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingApprovalsResponse {
    /// Rows in this page.
    pub count: usize,
    /// All transfers awaiting approval in the organization.
    pub total: i64,
    /// How many of them the caller can sign right now.
    pub approvable_count: i64,
    pub has_more: bool,
    /// Pass back as `cursor` to fetch the next page; absent on the last page.
    pub next_cursor: Option<String>,
    pub approvals: Vec<PendingApprovalDto>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApproveResponse {
    pub transfer_id: Uuid,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signatures: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_signatures: Option<i16>,
    /// Present and true when the caller had already signed (the request was a harmless retry).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub already_signed: Option<bool>,
    /// Present once the transfer has been executed on chain.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transaction_hash: Option<String>,
}

/// The published contract: one schema per `METHOD /path` (paths relative to `/api/v1`).
pub fn ui_contract() -> Value {
    let endpoints: Vec<(&str, Value)> = vec![
        (
            "GET /agents",
            serde_json::to_value(schema_for!(Vec<AgentDto>)).expect("schema"),
        ),
        (
            "GET /organization/wallets",
            serde_json::to_value(schema_for!(WalletsResponse)).expect("schema"),
        ),
        (
            "GET /agents/{agent}/wallet-transfers",
            serde_json::to_value(schema_for!(WalletTransfersResponse)).expect("schema"),
        ),
        (
            "GET /telemetry/events",
            serde_json::to_value(schema_for!(Vec<TelemetryEventDto>)).expect("schema"),
        ),
        (
            "GET /wallet-transfers/pending",
            serde_json::to_value(schema_for!(PendingApprovalsResponse)).expect("schema"),
        ),
        (
            "POST /wallet-transfers/{id}/approve",
            serde_json::to_value(schema_for!(ApproveResponse)).expect("schema"),
        ),
    ];
    let mut map = serde_json::Map::new();
    for (name, schema) in endpoints {
        map.insert(name.to_string(), schema);
    }
    serde_json::json!({
        "description": "Response contract for the web console. Generated from gateway types; do not edit by hand. Regenerate with UPDATE_UI_CONTRACT=1 cargo test --test ui_contract.",
        "endpoints": Value::Object(map),
    })
}
