//! ServerContext — centralized dependency injection container.
//!
//! Holds all shared state: database pool, model manager, search engine,
//! consolidation scheduler, event bus, config.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::db::pool::DbPool;
use crate::models::manager::ModelManager;
use crate::search::scoring::SessionContextVector;

/// Centralized context passed to all tool handlers and background tasks.
#[derive(Clone)]
pub struct ServerContext {
    pub pool: DbPool,
    pub model_manager: Arc<ModelManager>,
    pub session_context: Arc<SessionContextVector>,
    pub project_id: String,
    /// Runtime-togglable flag for escape hatch tools (memory_reset, memory_export).
    pub escape_hatches_enabled: Arc<AtomicBool>,
}

impl ServerContext {
    pub fn new(
        pool: DbPool,
        model_manager: Arc<ModelManager>,
        project_id: String,
    ) -> Self {
        Self {
            pool,
            model_manager,
            session_context: Arc::new(SessionContextVector::new(0.3)),
            project_id,
            escape_hatches_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Check if escape hatches are enabled.
    pub fn escape_hatches(&self) -> bool {
        self.escape_hatches_enabled.load(Ordering::Relaxed)
    }

    /// Set the escape hatches flag.
    pub fn set_escape_hatches(&self, enabled: bool) {
        self.escape_hatches_enabled.store(enabled, Ordering::Relaxed);
    }
}
