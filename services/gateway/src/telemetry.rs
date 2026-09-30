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
                    let event_type = event.event_type.clone();
                    let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
                    Some(Ok(Event::default()
                        .event(event_type)
                        .json_data(data)
                        .unwrap_or_else(|_| Event::default().data("{}"))))
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

