//! Reactive behaviors — event-driven handlers.
//!
//! Subscribes to EventBus events and triggers side effects:
//! - Hebbian edge recording on search
//! - Embedding generation on store
//! - Quality scoring on update
//! - Session context tracking

use std::sync::Arc;

use tracing::debug;

use super::event_bus::{EventBus, MemoryEvent};
use super::server_context::ServerContext;

/// Start reactive behavior handlers that respond to memory events.
pub fn start_behaviors(
    ctx: Arc<ServerContext>,
    bus: Arc<EventBus>,
) -> tokio::task::JoinHandle<()> {
    let rx = bus.subscribe();

    tokio::spawn(async move {
        loop {
            match rx.recv_async().await {
                Ok(event) => handle_event(&ctx, &event),
                Err(_) => {
                    debug!("Event bus closed, stopping behaviors");
                    break;
                }
            }
        }
    })
}

fn handle_event(ctx: &ServerContext, event: &MemoryEvent) {
    match event {
        MemoryEvent::SearchPerformed { result_count, .. } => {
            ctx.session_context.record_search(*result_count);
        }
        MemoryEvent::MemoryStored { id, project_id: _ } => {
            debug!("Behavior: memory stored {id}");
            // Future: trigger embedding generation, concept assignment
        }
        MemoryEvent::MemoryDeleted { id, .. } => {
            debug!("Behavior: memory deleted {id}");
        }
        _ => {}
    }
}
