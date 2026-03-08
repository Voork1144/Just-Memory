//! Consolidation scheduler — LIGHT/MEDIUM/DEEP phase management.
//!
//! Ports TypeScript consolidation loop. Runs periodic background tasks:
//! decay, strengthening, similarity detection, scratchpad cleanup, clustering.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use tracing::{debug, error, info, warn};

use crate::config::definitions::ConsolidationConfig;
use crate::db::pool::DbPool;
use crate::models::manager::ModelManager;

// ============================================================================
// Consolidation Phase
// ============================================================================

/// Intensity level for a consolidation run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsolidationPhase {
    Light,
    Medium,
    Deep,
}

impl ConsolidationPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Medium => "medium",
            Self::Deep => "deep",
        }
    }
}

// ============================================================================
// Consolidation Result
// ============================================================================

/// Outcome of a single consolidation run.
#[derive(Debug, Default)]
pub struct ConsolidationResult {
    pub phase: &'static str,
    pub decay_applied: usize,
    pub strengthened: usize,
    pub scratchpad_cleaned: usize,
    pub tool_logs_pruned: usize,
    pub similar_pairs_found: usize,
    pub clusters_formed: usize,
    pub duration_ms: u64,
}

// ============================================================================
// Scheduler
// ============================================================================

/// Background consolidation scheduler.
///
/// Spawns a tokio task that runs consolidation at `INTERVAL_MS`.
/// Adapts intensity based on memory health signals.
pub struct ConsolidationScheduler {
    pool: DbPool,
    model_manager: Option<Arc<ModelManager>>,
    shutdown: Arc<AtomicBool>,
    last_deep_run: parking_lot::Mutex<Option<Instant>>,
    run_count: parking_lot::Mutex<u64>,
}

impl ConsolidationScheduler {
    pub fn new(pool: DbPool, model_manager: Option<Arc<ModelManager>>) -> Self {
        Self {
            pool,
            model_manager,
            shutdown: Arc::new(AtomicBool::new(false)),
            last_deep_run: parking_lot::Mutex::new(None),
            run_count: parking_lot::Mutex::new(0),
        }
    }

    /// Request shutdown of the background loop.
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }

    /// Determine appropriate phase based on memory health signals.
    pub fn determine_phase(&self, project_id: &str) -> ConsolidationPhase {
        let conn = match self.pool.get() {
            Ok(c) => c,
            Err(_) => return ConsolidationPhase::Light,
        };

        // Check time since last deep run
        let hours_since_deep = self
            .last_deep_run
            .lock()
            .map(|t| t.elapsed().as_secs() / 3600)
            .unwrap_or(u64::MAX);

        if hours_since_deep >= ConsolidationConfig::ADAPTIVE_TIME_SINCE_DEEP_HOURS as u64 {
            return ConsolidationPhase::Deep;
        }

        // Check memory count — high count suggests medium/deep needed
        let memory_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND project_id = ?1",
                [project_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // Check contradiction ratio
        let contradiction_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL \
                 AND project_id = ?1 AND contradiction_count > 0",
                [project_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let contradiction_ratio = if memory_count > 0 {
            contradiction_count as f64 / memory_count as f64
        } else {
            0.0
        };

        if contradiction_ratio >= ConsolidationConfig::ADAPTIVE_CONTRADICTION_DEEP_RATIO {
            return ConsolidationPhase::Deep;
        }

        // Default: alternate light/medium
        let count = *self.run_count.lock();
        if count % 3 == 0 {
            ConsolidationPhase::Medium
        } else {
            ConsolidationPhase::Light
        }
    }

    /// Execute a single consolidation cycle.
    pub fn run_cycle(&self, project_id: &str) -> Result<ConsolidationResult> {
        let start = Instant::now();
        let phase = self.determine_phase(project_id);
        info!("Consolidation cycle: phase={}", phase.as_str());

        let mut result = ConsolidationResult {
            phase: phase.as_str(),
            ..Default::default()
        };

        // Always: decay + strengthen + scratchpad cleanup
        match super::decay::apply_memory_decay(&self.pool, project_id) {
            Ok(n) => result.decay_applied = n,
            Err(e) => warn!("Decay failed: {e}"),
        }

        match super::decay::strengthen_active_memories(&self.pool, project_id) {
            Ok(n) => result.strengthened = n,
            Err(e) => warn!("Strengthen failed: {e}"),
        }

        match super::decay::clean_expired_scratchpad(&self.pool, project_id) {
            Ok(n) => result.scratchpad_cleaned = n,
            Err(e) => warn!("Scratchpad cleanup failed: {e}"),
        }

        // Medium+: similarity detection, tool log pruning
        if phase != ConsolidationPhase::Light {
            match super::decay::prune_tool_logs(&self.pool, None) {
                Ok(n) => result.tool_logs_pruned = n,
                Err(e) => warn!("Tool log prune failed: {e}"),
            }
        }

        // Deep: clustering
        if phase == ConsolidationPhase::Deep {
            if let Some(ref mm) = self.model_manager {
                match super::clustering::run_clustering(&self.pool, project_id, mm) {
                    Ok(cr) => result.clusters_formed = cr.clusters_found,
                    Err(e) => warn!("Clustering failed: {e}"),
                }
            }
            *self.last_deep_run.lock() = Some(Instant::now());
        }

        result.duration_ms = start.elapsed().as_millis() as u64;
        *self.run_count.lock() += 1;

        info!(
            "Consolidation done: phase={} decay={} strengthen={} duration={}ms",
            result.phase, result.decay_applied, result.strengthened, result.duration_ms,
        );

        Ok(result)
    }

    /// Start the background consolidation loop.
    ///
    /// Returns a JoinHandle that can be awaited for graceful shutdown.
    pub fn start_background(
        self: Arc<Self>,
        project_id: String,
    ) -> tokio::task::JoinHandle<()> {
        let scheduler = Arc::clone(&self);
        tokio::spawn(async move {
            let interval = Duration::from_millis(ConsolidationConfig::INTERVAL_MS);
            loop {
                tokio::time::sleep(interval).await;

                if scheduler.shutdown.load(Ordering::Relaxed) {
                    info!("Consolidation scheduler shutting down");
                    break;
                }

                let pid = project_id.clone();
                let sched = Arc::clone(&scheduler);
                // Run consolidation in blocking context (SQLite is sync)
                let result = tokio::task::spawn_blocking(move || {
                    sched.run_cycle(&pid)
                })
                .await;

                match result {
                    Ok(Ok(r)) => debug!("Consolidation cycle complete: {:?}", r.phase),
                    Ok(Err(e)) => error!("Consolidation cycle error: {e}"),
                    Err(e) => error!("Consolidation task panicked: {e}"),
                }
            }
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phase_as_str() {
        assert_eq!(ConsolidationPhase::Light.as_str(), "light");
        assert_eq!(ConsolidationPhase::Medium.as_str(), "medium");
        assert_eq!(ConsolidationPhase::Deep.as_str(), "deep");
    }

    #[test]
    fn test_result_default() {
        let r = ConsolidationResult::default();
        assert_eq!(r.decay_applied, 0);
        assert_eq!(r.duration_ms, 0);
    }
}
