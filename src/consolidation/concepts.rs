//! Concept management — drift tracking, tension scoring, tier lifecycle.
//!
//! Ports TypeScript `concepts-drift.ts` and concept lifecycle from `concepts-helpers.ts`.

use anyhow::Result;
use tracing::debug;

use crate::config::definitions::ConceptConfig;
use crate::db::pool::DbPool;
use crate::search::scoring::cosine_similarity;

// ============================================================================
// Concept Snapshot
// ============================================================================

/// Record of a concept's state at a particular cycle.
#[derive(Debug, Clone)]
pub struct ConceptSnapshot {
    pub concept_id: String,
    pub cycle_number: i64,
    pub centroid_drift: f64,
    pub member_churn: f64,
    pub cohesion_delta: f64,
    pub event_type: String,
}

// ============================================================================
// Drift Computation
// ============================================================================

/// Compute centroid drift between two snapshots.
/// Returns 1 - cosine_similarity (0 = identical, 2 = opposite).
pub fn compute_centroid_drift(prev_centroid: &[f32], curr_centroid: &[f32]) -> f64 {
    if prev_centroid.len() != curr_centroid.len() || prev_centroid.is_empty() {
        return 1.0;
    }
    1.0 - cosine_similarity(prev_centroid, curr_centroid)
}

/// Compute member churn (Jaccard distance between member sets).
/// 0 = identical members, 1 = completely different.
pub fn compute_member_churn(prev_members: &[String], curr_members: &[String]) -> f64 {
    let prev_set: std::collections::HashSet<&str> =
        prev_members.iter().map(|s| s.as_str()).collect();
    let curr_set: std::collections::HashSet<&str> =
        curr_members.iter().map(|s| s.as_str()).collect();

    let intersection = prev_set.intersection(&curr_set).count();
    let union = prev_set.union(&curr_set).count();

    if union == 0 {
        0.0
    } else {
        1.0 - (intersection as f64 / union as f64)
    }
}

// ============================================================================
// Snapshot Recording
// ============================================================================

/// Record a concept snapshot with drift metrics.
pub fn record_concept_snapshot(
    pool: &DbPool,
    concept_id: &str,
    project_id: &str,
    cycle_number: i64,
    centroid_drift: f64,
    member_churn: f64,
    cohesion_delta: f64,
    event_type: &str,
) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO concept_snapshots \
         (concept_id, project_id, cycle_number, centroid_drift, member_churn, \
          cohesion_delta, event_type, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
        rusqlite::params![
            concept_id, project_id, cycle_number,
            centroid_drift, member_churn, cohesion_delta, event_type,
        ],
    )?;
    Ok(())
}

// ============================================================================
// Drift Alerts
// ============================================================================

/// Check and create drift alerts based on thresholds.
///
/// Alert types: rapid_drift, cohesion_collapse, membership_exodus, identity_shift.
pub fn check_drift_alerts(
    pool: &DbPool,
    concept_id: &str,
    project_id: &str,
    cycle_number: i64,
    drift: f64,
    cohesion_delta: f64,
    member_churn: f64,
) -> Result<usize> {
    let conn = pool.get()?;
    let mut alert_count = 0;

    // Rapid drift
    if drift >= ConceptConfig::DRIFT_RAPID_THRESHOLD {
        create_alert(&conn, concept_id, project_id, cycle_number, "rapid_drift",
            &format!("Centroid drift {drift:.3} exceeds threshold"))?;
        alert_count += 1;
    }

    // Cohesion collapse
    if cohesion_delta <= -ConceptConfig::DRIFT_COHESION_COLLAPSE {
        create_alert(&conn, concept_id, project_id, cycle_number, "cohesion_collapse",
            &format!("Cohesion dropped by {:.3}", cohesion_delta.abs()))?;
        alert_count += 1;
    }

    // Membership exodus
    if member_churn >= ConceptConfig::DRIFT_MEMBERSHIP_EXODUS {
        create_alert(&conn, concept_id, project_id, cycle_number, "membership_exodus",
            &format!("Member churn {member_churn:.3} exceeds threshold"))?;
        alert_count += 1;
    }

    // Identity shift (cumulative drift over window)
    let cumulative = get_cumulative_drift(pool, concept_id,
        Some(ConceptConfig::DRIFT_IDENTITY_SHIFT_WINDOW as usize))?;
    if cumulative >= ConceptConfig::DRIFT_IDENTITY_SHIFT_THRESHOLD {
        create_alert(&conn, concept_id, project_id, cycle_number, "identity_shift",
            &format!("Cumulative drift {cumulative:.3} over {} cycles",
                ConceptConfig::DRIFT_IDENTITY_SHIFT_WINDOW))?;
        alert_count += 1;
    }

    Ok(alert_count)
}

fn create_alert(
    conn: &rusqlite::Connection,
    concept_id: &str,
    project_id: &str,
    cycle_number: i64,
    alert_type: &str,
    message: &str,
) -> Result<()> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO concept_drift_alerts \
         (id, concept_id, project_id, cycle_number, alert_type, message, acknowledged, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, datetime('now'))",
        rusqlite::params![id, concept_id, project_id, cycle_number, alert_type, message],
    )?;
    debug!("Drift alert: {alert_type} for concept {concept_id}");
    Ok(())
}

// ============================================================================
// Drift Queries
// ============================================================================

/// Get cumulative centroid drift over the last N cycles.
pub fn get_cumulative_drift(
    pool: &DbPool,
    concept_id: &str,
    cycle_window: Option<usize>,
) -> Result<f64> {
    let conn = pool.get()?;
    let window = cycle_window.unwrap_or(ConceptConfig::DRIFT_IDENTITY_SHIFT_WINDOW as usize);

    let total: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(centroid_drift), 0.0) FROM concept_snapshots \
             WHERE concept_id = ?1 \
             ORDER BY cycle_number DESC LIMIT ?2",
            rusqlite::params![concept_id, window as i64],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    Ok(total)
}

/// Get drift history for a concept.
pub fn get_drift_history(
    pool: &DbPool,
    concept_id: &str,
    limit: usize,
) -> Result<Vec<ConceptSnapshot>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT concept_id, cycle_number, centroid_drift, member_churn, cohesion_delta, event_type \
         FROM concept_snapshots WHERE concept_id = ?1 \
         ORDER BY cycle_number DESC LIMIT ?2",
    )?;

    let snapshots = stmt
        .query_map(rusqlite::params![concept_id, limit as i64], |row| {
            Ok(ConceptSnapshot {
                concept_id: row.get(0)?,
                cycle_number: row.get(1)?,
                centroid_drift: row.get(2)?,
                member_churn: row.get(3)?,
                cohesion_delta: row.get(4)?,
                event_type: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(snapshots)
}

/// Get unacknowledged drift alerts for a project.
pub fn get_drift_alerts(
    pool: &DbPool,
    project_id: &str,
    limit: usize,
) -> Result<Vec<(String, String, String, String)>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, concept_id, alert_type, message FROM concept_drift_alerts \
         WHERE project_id = ?1 AND acknowledged = 0 \
         ORDER BY created_at DESC LIMIT ?2",
    )?;

    let alerts = stmt
        .query_map(rusqlite::params![project_id, limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(alerts)
}

/// Acknowledge a drift alert.
pub fn acknowledge_drift_alert(pool: &DbPool, alert_id: &str) -> Result<()> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE concept_drift_alerts SET acknowledged = 1 WHERE id = ?1",
        [alert_id],
    )?;
    Ok(())
}

// ============================================================================
// Concept Lifecycle Helpers
// ============================================================================

/// Assign a memory to matching concepts based on centroid similarity.
///
/// Called at memory store time for real-time concept membership.
pub fn assign_memory_to_concepts(
    pool: &DbPool,
    memory_id: &str,
    embedding: &[f32],
    project_id: &str,
) -> Result<usize> {
    let conn = pool.get()?;
    let threshold = 0.7; // STORE_TIME_CONCEPT_THRESHOLD

    let mut stmt = conn.prepare(
        "SELECT id, centroid FROM concept_nodes \
         WHERE project_id = ?1 AND status != 'removed' AND centroid IS NOT NULL",
    )?;

    let concepts: Vec<(String, Vec<f32>)> = stmt
        .query_map([project_id], |row| {
            let id: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob))
        })?
        .filter_map(|r| r.ok())
        .filter_map(|(id, blob)| {
            let centroid = decode_f32_blob(&blob);
            if centroid.is_empty() { None } else { Some((id, centroid)) }
        })
        .collect();

    let mut assigned = 0;
    for (concept_id, centroid) in &concepts {
        if centroid.len() != embedding.len() { continue; }
        let sim = cosine_similarity(centroid, embedding);
        if sim >= threshold {
            conn.execute(
                "INSERT OR REPLACE INTO concept_memberships \
                 (concept_id, memory_id, probability, assigned_at) \
                 VALUES (?1, ?2, ?3, datetime('now'))",
                rusqlite::params![concept_id, memory_id, sim],
            )?;
            assigned += 1;
        }
    }

    Ok(assigned)
}

/// Get concepts a memory belongs to.
pub fn get_concepts_for_memory(
    pool: &DbPool,
    memory_id: &str,
) -> Result<Vec<(String, Option<String>, f64)>> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT cm.concept_id, cn.name, cm.probability \
         FROM concept_memberships cm \
         LEFT JOIN concept_nodes cn ON cm.concept_id = cn.id \
         WHERE cm.memory_id = ?1 \
         ORDER BY cm.probability DESC",
    )?;

    let results = stmt
        .query_map([memory_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}

// ============================================================================
// Pruning
// ============================================================================

/// Prune old concept snapshots, keeping the most recent N per concept.
pub fn prune_concept_snapshots(
    pool: &DbPool,
    project_id: &str,
    keep_per_concept: usize,
) -> Result<usize> {
    let conn = pool.get()?;

    // Get concept IDs
    let mut stmt = conn.prepare(
        "SELECT DISTINCT concept_id FROM concept_snapshots \
         WHERE project_id = ?1",
    )?;
    let concept_ids: Vec<String> = stmt
        .query_map([project_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut total_deleted = 0;
    for cid in &concept_ids {
        let deleted = conn.execute(
            "DELETE FROM concept_snapshots WHERE concept_id = ?1 \
             AND rowid NOT IN ( \
                SELECT rowid FROM concept_snapshots WHERE concept_id = ?1 \
                ORDER BY cycle_number DESC LIMIT ?2 \
             )",
            rusqlite::params![cid, keep_per_concept as i64],
        )?;
        total_deleted += deleted;
    }

    if total_deleted > 0 {
        debug!("Pruned {total_deleted} concept snapshots");
    }
    Ok(total_deleted)
}

/// Clean orphaned concept memberships (referencing deleted memories).
pub fn clean_orphaned_memberships(pool: &DbPool, _project_id: &str) -> Result<usize> {
    let conn = pool.get()?;
    let deleted = conn.execute(
        "DELETE FROM concept_memberships WHERE memory_id IN ( \
            SELECT m.id FROM memories m WHERE m.deleted_at IS NOT NULL \
         )",
        [],
    )?;

    if deleted > 0 {
        debug!("Cleaned {deleted} orphaned concept memberships");
    }
    Ok(deleted)
}

// ============================================================================
// Utility
// ============================================================================

fn decode_f32_blob(blob: &[u8]) -> Vec<f32> {
    if blob.len() % 4 != 0 { return Vec::new(); }
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
    fn test_centroid_drift_identical() {
        let a = vec![1.0f32, 0.0, 0.0];
        let drift = compute_centroid_drift(&a, &a);
        assert!(drift.abs() < 0.001, "Identical centroids should have ~0 drift");
    }

    #[test]
    fn test_centroid_drift_orthogonal() {
        let a = vec![1.0f32, 0.0];
        let b = vec![0.0f32, 1.0];
        let drift = compute_centroid_drift(&a, &b);
        assert!((drift - 1.0).abs() < 0.001, "Orthogonal should have drift ~1.0");
    }

    #[test]
    fn test_member_churn_identical() {
        let a = vec!["m1".to_string(), "m2".to_string()];
        let churn = compute_member_churn(&a, &a);
        assert!(churn.abs() < 0.001);
    }

    #[test]
    fn test_member_churn_completely_different() {
        let a = vec!["m1".to_string(), "m2".to_string()];
        let b = vec!["m3".to_string(), "m4".to_string()];
        let churn = compute_member_churn(&a, &b);
        assert!((churn - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_member_churn_partial() {
        let a = vec!["m1".to_string(), "m2".to_string(), "m3".to_string()];
        let b = vec!["m2".to_string(), "m3".to_string(), "m4".to_string()];
        let churn = compute_member_churn(&a, &b);
        // Intersection: {m2, m3} = 2, Union: {m1,m2,m3,m4} = 4, Jaccard = 2/4 = 0.5
        assert!((churn - 0.5).abs() < 0.001);
    }
}
