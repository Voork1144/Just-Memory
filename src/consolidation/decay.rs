//! ACT-R power-law forgetting curves and strength decay.
//!
//! Ports TypeScript `consolidation.ts` functions:
//! - `computeActRRetention`
//! - `applyMemoryDecay`
//! - `strengthenActiveMemories`
//! - `cleanExpiredScratchpad`
//! - `pruneToolLogs`

use anyhow::Result;
use tracing::debug;

use crate::config::definitions::{ConsolidationConfig, DecayConfig};
use crate::db::pool::DbPool;

// ============================================================================
// ACT-R Retention
// ============================================================================

/// Compute ACT-R power-law retention for a memory.
///
/// retention = a × (1 + b×t)^(-c)
/// where t = days since last access, and (a, b, c) vary by tier.
pub fn compute_act_r_retention(days_since_access: f64, tier: &str) -> f64 {
    let params = DecayConfig::act_r_params(tier);
    let retention = params.a * (1.0 + params.b * days_since_access).powf(-params.c);
    retention.clamp(0.0, 1.0)
}

// ============================================================================
// Memory Decay
// ============================================================================

/// Apply ACT-R decay to all non-high-importance memories.
///
/// Reduces `strength` based on time since last access and memory tier.
/// Returns count of memories updated.
pub fn apply_memory_decay(pool: &DbPool, project_id: &str) -> Result<usize> {
    let conn = pool.get()?;

    // Select candidates: non-deleted, not high importance, with a last_accessed time
    let mut stmt = conn.prepare(
        "SELECT id, tier, importance, strength, processing_depth, \
         julianday('now') - julianday(COALESCE(last_accessed, created_at)) as days_elapsed \
         FROM memories \
         WHERE deleted_at IS NULL AND project_id = ?1 \
         AND importance < 0.9",
    )?;

    let candidates: Vec<(String, String, f64, f64, Option<f64>, f64)> = stmt
        .query_map([project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1).unwrap_or_else(|_| "ephemeral".to_string()),
                row.get::<_, f64>(2).unwrap_or(0.5),
                row.get::<_, f64>(3).unwrap_or(1.0),
                row.get::<_, Option<f64>>(4)?,
                row.get::<_, f64>(5).unwrap_or(0.0),
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut update_stmt = conn.prepare(
        "UPDATE memories SET strength = ?1 WHERE id = ?2",
    )?;

    let mut updated = 0;
    let floor = 0.1_f64;

    for (id, tier, _importance, current_strength, processing_depth, days_elapsed) in &candidates {
        let retention = compute_act_r_retention(*days_elapsed, tier);

        // Processing depth resistance: deeper processing resists decay
        let depth_factor = processing_depth.unwrap_or(0.0);
        let adjusted_retention = retention + (1.0 - retention) * depth_factor * 0.3;
        let adjusted_retention = adjusted_retention.clamp(0.0, 1.0);

        let new_strength = (current_strength * adjusted_retention).max(floor);
        if (new_strength - current_strength).abs() > 0.001 {
            update_stmt.execute(rusqlite::params![new_strength, id])?;
            updated += 1;
        }
    }

    debug!("Memory decay: updated {updated}/{} candidates", candidates.len());
    Ok(updated)
}

// ============================================================================
// Strengthening
// ============================================================================

/// Boost confidence of frequently-accessed memories.
///
/// Memories accessed multiple times get a small confidence increase.
pub fn strengthen_active_memories(pool: &DbPool, project_id: &str) -> Result<usize> {
    let conn = pool.get()?;
    let boost = 0.05_f64;
    let cap = 0.95_f64;

    let updated = conn.execute(
        "UPDATE memories SET confidence = MIN(confidence + ?1, ?2) \
         WHERE deleted_at IS NULL AND project_id = ?3 \
         AND access_count > 3 AND confidence < ?2",
        rusqlite::params![boost, cap, project_id],
    )?;

    debug!("Strengthened {updated} active memories");
    Ok(updated)
}

// ============================================================================
// Scratchpad Cleanup
// ============================================================================

/// Remove expired scratchpad entries.
pub fn clean_expired_scratchpad(pool: &DbPool, project_id: &str) -> Result<usize> {
    let conn = pool.get()?;
    let deleted = conn.execute(
        "DELETE FROM scratchpad WHERE project_id = ?1 AND expires_at < datetime('now')",
        [project_id],
    )?;

    if deleted > 0 {
        debug!("Cleaned {deleted} expired scratchpad entries");
    }
    Ok(deleted)
}

// ============================================================================
// Tool Log Pruning
// ============================================================================

/// Delete old tool_calls entries beyond retention window.
pub fn prune_tool_logs(pool: &DbPool, days_to_keep: Option<i64>) -> Result<usize> {
    let days = days_to_keep.unwrap_or(7);
    let conn = pool.get()?;
    let deleted = conn.execute(
        "DELETE FROM tool_calls WHERE created_at < datetime('now', ?1)",
        [format!("-{days} days")],
    )?;

    if deleted > 0 {
        debug!("Pruned {deleted} tool log entries older than {days} days");
    }
    Ok(deleted)
}

// ============================================================================
// Similarity Detection
// ============================================================================

/// Find pairs of similar memories using embedding cosine similarity.
///
/// Returns (id_a, id_b, similarity) triples above threshold.
pub fn find_similar_memories(
    pool: &DbPool,
    project_id: &str,
    threshold: f64,
    limit: usize,
) -> Result<Vec<(String, String, f64)>> {
    let conn = pool.get()?;
    let fetch_limit = limit.min(ConsolidationConfig::REPLAY_BATCH_SIZE * 2);

    // Load embeddings for recent memories
    let mut stmt = conn.prepare(
        "SELECT id, embedding FROM memories \
         WHERE deleted_at IS NULL AND project_id = ?1 \
         AND embedding IS NOT NULL \
         ORDER BY created_at DESC LIMIT ?2",
    )?;

    let rows: Vec<(String, Vec<u8>)> = stmt
        .query_map(rusqlite::params![project_id, fetch_limit as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut pairs = Vec::new();

    // Pairwise comparison (O(n²) — bounded by fetch_limit)
    for i in 0..rows.len() {
        for j in (i + 1)..rows.len() {
            let emb_a = decode_f32_blob(&rows[i].1);
            let emb_b = decode_f32_blob(&rows[j].1);
            if emb_a.len() != emb_b.len() || emb_a.is_empty() {
                continue;
            }
            let sim = crate::search::scoring::cosine_similarity(&emb_a, &emb_b);
            if sim >= threshold {
                pairs.push((rows[i].0.clone(), rows[j].0.clone(), sim));
            }
        }
        if pairs.len() >= limit {
            break;
        }
    }

    pairs.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    pairs.truncate(limit);

    Ok(pairs)
}

/// Decode little-endian f32 blob.
fn decode_f32_blob(blob: &[u8]) -> Vec<f32> {
    if blob.len() % 4 != 0 {
        return Vec::new();
    }
    blob.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_act_r_retention_at_zero() {
        let r = compute_act_r_retention(0.0, "core");
        assert!((r - 1.0).abs() < 0.001, "Zero days should give ~1.0 retention");
    }

    #[test]
    fn test_act_r_retention_decays() {
        let r0 = compute_act_r_retention(0.0, "ephemeral");
        let r30 = compute_act_r_retention(30.0, "ephemeral");
        let r365 = compute_act_r_retention(365.0, "ephemeral");
        assert!(r0 > r30, "Retention should decrease over time");
        assert!(r30 > r365, "Retention should decrease further over more time");
    }

    #[test]
    fn test_core_decays_slower_than_ephemeral() {
        let r_eph = compute_act_r_retention(90.0, "ephemeral");
        let r_core = compute_act_r_retention(90.0, "core");
        assert!(r_core > r_eph, "Core memories should decay slower");
    }

    #[test]
    fn test_retention_clamped() {
        let r = compute_act_r_retention(100000.0, "ephemeral");
        assert!(r >= 0.0);
        assert!(r <= 1.0);
    }

    #[test]
    fn test_decode_f32_blob() {
        let values = vec![1.0f32, 2.0, 3.0];
        let blob: Vec<u8> = values.iter().flat_map(|f| f.to_le_bytes()).collect();
        let decoded = decode_f32_blob(&blob);
        assert_eq!(decoded.len(), 3);
        assert!((decoded[0] - 1.0).abs() < f32::EPSILON);
        assert!((decoded[2] - 3.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_decode_f32_blob_invalid() {
        let blob = vec![1, 2, 3]; // Not divisible by 4
        assert!(decode_f32_blob(&blob).is_empty());
    }
}
