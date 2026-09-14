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
