//! EventBus — typed publish/subscribe with event types.
//!
//! Uses flume channels for async-safe event delivery.


use tracing::{debug, warn};

/// Event types emitted by the memory system.
#[derive(Debug, Clone)]
pub enum MemoryEvent {
    MemoryStored { id: String, project_id: String },
    MemoryUpdated { id: String, project_id: String },
    MemoryDeleted { id: String, project_id: String },
    SearchPerformed { query: String, result_count: usize },
    ConsolidationRun { phase: String, duration_ms: u64 },
    ModelLoaded { model_id: String },
    ModelUnloaded { model_id: String },
    HealthCheck { status: String },
}

/// Simple broadcast event bus using flume.
pub struct EventBus {
    sender: flume::Sender<MemoryEvent>,
    receiver: flume::Receiver<MemoryEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, receiver) = flume::unbounded();
        Self { sender, receiver }
    }

    /// Publish an event (non-blocking).
    pub fn publish(&self, event: MemoryEvent) {
        debug!("Event: {:?}", event);
        if let Err(e) = self.sender.send(event) {
            warn!("EventBus: failed to send event (no subscribers?): {e}");
        }
    }

    /// Subscribe to events (returns a receiver clone).
    pub fn subscribe(&self) -> flume::Receiver<MemoryEvent> {
        self.receiver.clone()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_publish_subscribe() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        bus.publish(MemoryEvent::MemoryStored {
            id: "test".into(),
            project_id: "proj".into(),
        });

        let event = rx.try_recv().unwrap();
        match event {
            MemoryEvent::MemoryStored { id, .. } => assert_eq!(id, "test"),
            _ => panic!("Wrong event type"),
        }
    }
}
