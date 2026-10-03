use axum::response::sse::Event;
use futures_util::Stream;
use serde::Serialize;
use serde_json::Value;
use std::{convert::Infallible, pin::Pin};
use tokio::sync::broadcast;
use tokio_stream::{StreamExt, wrappers::BroadcastStream};

pub const EVENT_CHANNEL_CAPACITY: usize = 2048;

#[derive(Debug, Clone, Serialize)]
pub struct GatewayEvent {
    pub event_type: String,
    pub org_id: Option<String>,
    pub agent: Option<String>,
    pub chain_id: Option<u64>,
    pub block_number: Option<u64>,
    pub transaction_hash: Option<String>,
    pub finalized: bool,
    pub payload: Value,
}

/// UI change notifications published after a successful mutation. They carry no data beyond the
/// kind: clients react by refetching the affected queries, so the stream never needs to be the
/// source of truth and a missed event is repaired by the client's safety-net refetch.
pub const UI_APPROVALS_CHANGED: &str = "approvals_changed";
pub const UI_TRANSFERS_CHANGED: &str = "transfers_changed";
pub const UI_WALLETS_CHANGED: &str = "wallets_changed";
pub const UI_AGENTS_CHANGED: &str = "agents_changed";

impl GatewayEvent {
    pub fn ui_change(org_id: &str, kind: &str) -> Self {
        Self {
            event_type: kind.to_string(),
            org_id: Some(org_id.to_string()),
            agent: None,
            chain_id: None,
            block_number: None,
            transaction_hash: None,
            finalized: true,
            payload: Value::Object(Default::default()),
        }
    }

    /// The SSE `data:` line: the event as plain JSON.
    pub fn sse_data(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

/// Which UI change events a successful request implies. `path` is the full request path.
pub fn ui_change_kinds(method: &http::Method, path: &str) -> &'static [&'static str] {
    let path = path.trim_end_matches('/');
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let mutating = matches!(
        *method,
        http::Method::POST | http::Method::PUT | http::Method::PATCH | http::Method::DELETE
    );
    if !mutating || segments.len() < 3 || segments[0] != "api" || segments[1] != "v1" {
        return &[];
    }
    match (segments[2], segments.get(3), segments.get(4)) {
        ("wallet-transfers", Some(_), Some(&"approve" | &"submit")) => &[
            UI_APPROVALS_CHANGED,
            UI_TRANSFERS_CHANGED,
            UI_WALLETS_CHANGED,
        ],
        ("agents", Some(_), Some(&"load" | &"unload")) => &[
            UI_APPROVALS_CHANGED,
            UI_TRANSFERS_CHANGED,
            UI_WALLETS_CHANGED,
        ],
        ("organization", Some(&"wallets"), _) => &[UI_WALLETS_CHANGED],
        ("agents", None, None) => &[UI_AGENTS_CHANGED],
        _ => &[],
    }
}

#[derive(Clone)]
pub struct EventHub {
    sender: broadcast::Sender<GatewayEvent>,
}

impl EventHub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self { sender }
    }

    pub fn publish(&self, event: GatewayEvent) {
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GatewayEvent> {
        self.sender.subscribe()
    }

    pub fn stream_for_tenant(
        &self,
        org_id: String,
    ) -> Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> {
        let stream = BroadcastStream::new(self.subscribe()).filter_map(move |result| {
            let org_id = org_id.clone();
            match result {
                Ok(event) if event.org_id.as_deref() == Some(org_id.as_str()) => {
                    Some(Ok(Event::default()
                        .event(event.event_type.clone())
                        .data(event.sse_data())))
                }
                Ok(_) => None,
                Err(_) => Some(Ok(Event::default()
                    .event("telemetry_gap")
                    .data(r#"{"reasonCode":"ERR_DEPENDENCY_UNAVAILABLE","message":"Telemetry continuity was interrupted; resubscribe to continue."}"#))),
            }
        });
        Box::pin(stream)
    }
}

impl Default for EventHub {
    fn default() -> Self {
        Self::new()
    }
}

/// Generates or extracts a standard W3C Trace Context (traceparent: 00-<trace_id>-<span_id>-01).
pub fn extract_or_generate_traceparent(headers: &axum::http::HeaderMap) -> (String, String) {
    if let Some(traceparent) = headers.get("traceparent").and_then(|v| v.to_str().ok()) {
        let parts: Vec<&str> = traceparent.split('-').collect();
        if parts.len() == 4 && parts[0] == "00" && parts[1].len() == 32 {
            let trace_id = parts[1].to_string();
            return (traceparent.to_string(), trace_id);
        }
    }
    // Generate standard W3C Trace ID (16 bytes = 32 hex chars) and Span ID (8 bytes = 16 hex chars)
    let trace_uuid = uuid::Uuid::now_v7();
    let span_uuid = uuid::Uuid::now_v7();
    let trace_id = hex::encode(trace_uuid.as_bytes());
    let span_id = hex::encode(&span_uuid.as_bytes()[0..8]);
    let traceparent = format!("00-{trace_id}-{span_id}-01");
    (traceparent, trace_id)
}
