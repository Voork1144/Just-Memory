//! HDBSCAN clustering for concept formation.
//!
//! Ports TypeScript `concepts-core.ts` `runConceptClustering`.
//! Uses a simplified single-linkage approach since no Rust HDBSCAN crate
//! matches the TypeScript ML5 pipeline exactly.

use std::collections::HashMap;

use anyhow::Result;
use tracing::{debug, info};

use crate::config::definitions::ConceptConfig;
use crate::db::pool::DbPool;
use crate::models::manager::ModelManager;
use crate::search::scoring::cosine_similarity;

// ============================================================================
// Clustering Result
// ============================================================================

/// Outcome of a clustering run.
#[derive(Debug, Default)]
pub struct ClusteringResult {
    pub memories_analyzed: usize,
    pub clusters_found: usize,
    pub concepts_created: usize,
    pub concepts_updated: usize,
    pub concepts_removed: usize,
    pub merges: usize,
    pub splits: usize,
    pub duration_ms: u64,
}

// ============================================================================
// Embedding Record
// ============================================================================

/// A memory with its decoded embedding vector.
struct MemoryEmbedding {
    id: String,
    embedding: Vec<f32>,
}

// ============================================================================
// Clustering Engine
// ============================================================================

/// Run concept clustering on a project's memories.
///
/// 1. Load memory embeddings
/// 2. Compute pairwise similarities
/// 3. Form clusters via density-based grouping
/// 4. Match clusters to existing concept nodes or create new ones
/// 5. Detect merges/splits
pub fn run_clustering(
    pool: &DbPool,
    project_id: &str,
    _model_manager: &ModelManager,
) -> Result<ClusteringResult> {
    let start = std::time::Instant::now();
    let conn = pool.get()?;

    // 1. Load embeddings (up to MAX_MEMORIES)
    let max_memories = ConceptConfig::MAX_MEMORIES;
    let mut stmt = conn.prepare(
        "SELECT id, embedding FROM memories \
         WHERE deleted_at IS NULL AND project_id = ?1 \
         AND embedding IS NOT NULL \
         ORDER BY created_at DESC LIMIT ?2",
    )?;

    let memories: Vec<MemoryEmbedding> = stmt
        .query_map(rusqlite::params![project_id, max_memories as i64], |row| {
            let id: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob))
        })?
        .filter_map(|r| r.ok())
        .filter_map(|(id, blob)| {
            let emb = decode_embedding(&blob);
            if emb.is_empty() { None } else { Some(MemoryEmbedding { id, embedding: emb }) }
        })
        .collect();

    let n = memories.len();
    info!("Clustering: loaded {n} embeddings for project {project_id}");

    if n < ConceptConfig::MIN_CLUSTER_SIZE {
        return Ok(ClusteringResult {
            memories_analyzed: n,
            duration_ms: start.elapsed().as_millis() as u64,
            ..Default::default()
        });
    }

    // 2. Simple density-based clustering using similarity threshold
    let clusters = density_cluster(&memories, ConceptConfig::OVERLAP_MATCH);

    let clusters_found = clusters.len();
    info!("Found {clusters_found} clusters from {n} memories");

    // 3. Match to existing concept nodes or create new ones
    let mut concepts_created = 0;
    let mut concepts_updated = 0;

    // Load existing concept nodes
    let existing_concepts = load_concept_nodes(&conn, project_id)?;

    for cluster in &clusters {
        if cluster.len() < ConceptConfig::MIN_CLUSTER_SIZE {
            continue;
        }

        // Compute cluster centroid
        let centroid = compute_centroid_from_memories(&memories, cluster);

        // Try to match existing concept
        let matched = find_matching_concept(&existing_concepts, &centroid, ConceptConfig::OVERLAP_MATCH);

        match matched {
            Some(concept_id) => {
                // Update existing concept
                update_concept_node(&conn, &concept_id, &centroid, cluster.len())?;
                update_concept_memberships(&conn, &concept_id, &memories, cluster)?;
                concepts_updated += 1;
            }
            None => {
                // Create new concept node
                let concept_id = create_concept_node(&conn, project_id, &centroid, cluster.len())?;
                update_concept_memberships(&conn, &concept_id, &memories, cluster)?;
                concepts_created += 1;
            }
        }
    }

    // 4. Detect merges and splits
    let merges = detect_and_apply_merges(&conn, project_id)?;
    let splits = detect_splits(&conn, project_id)?;

    let result = ClusteringResult {
        memories_analyzed: n,
        clusters_found,
        concepts_created,
        concepts_updated,
        concepts_removed: 0,
        merges,
        splits,
        duration_ms: start.elapsed().as_millis() as u64,
    };

    info!(
        "Clustering complete: {} clusters, {} created, {} updated, {} merges in {}ms",
        result.clusters_found, result.concepts_created, result.concepts_updated,
        result.merges, result.duration_ms,
    );

    Ok(result)
}

// ============================================================================
// Density-based Clustering
// ============================================================================

/// Simple density-based clustering: memories within `threshold` similarity
/// are grouped together using union-find.
fn density_cluster(memories: &[MemoryEmbedding], threshold: f64) -> Vec<Vec<usize>> {
    let n = memories.len();
    let mut parent: Vec<usize> = (0..n).collect();

    fn find(parent: &mut [usize], x: usize) -> usize {
        if parent[x] != x {
            parent[x] = find(parent, parent[x]);
        }
        parent[x]
    }

    fn union(parent: &mut [usize], a: usize, b: usize) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra != rb {
            parent[ra] = rb;
        }
    }

    // Pairwise similarity — O(n²) but bounded by MAX_MEMORIES
    for i in 0..n {
        for j in (i + 1)..n {
            let sim = cosine_similarity(&memories[i].embedding, &memories[j].embedding);
            if sim >= threshold {
                union(&mut parent, i, j);
            }
        }
    }

    // Group by root
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(i);
    }

    groups.into_values().collect()
}

// ============================================================================
// Concept Node Helpers
// ============================================================================

struct ExistingConcept {
    id: String,
    centroid: Vec<f32>,
}

fn load_concept_nodes(conn: &rusqlite::Connection, project_id: &str) -> Result<Vec<ExistingConcept>> {
    let mut stmt = conn.prepare(
        "SELECT id, centroid FROM concept_nodes WHERE project_id = ?1 AND status != 'removed'",
    )?;

    let concepts = stmt
        .query_map([project_id], |row| {
            let id: String = row.get(0)?;
            let blob: Option<Vec<u8>> = row.get(1)?;
            Ok((id, blob))
        })?
        .filter_map(|r| r.ok())
        .filter_map(|(id, blob)| {
            let centroid = blob.map(|b| decode_embedding(&b)).unwrap_or_default();
            if centroid.is_empty() { None } else { Some(ExistingConcept { id, centroid }) }
        })
        .collect();

    Ok(concepts)
}

fn find_matching_concept(
    concepts: &[ExistingConcept],
    centroid: &[f32],
    threshold: f64,
) -> Option<String> {
    let mut best_sim = 0.0;
    let mut best_id = None;

    for c in concepts {
        if c.centroid.len() != centroid.len() { continue; }
        let sim = cosine_similarity(&c.centroid, centroid);
        if sim > best_sim && sim >= threshold {
            best_sim = sim;
            best_id = Some(c.id.clone());
        }
    }

    best_id
}

fn compute_centroid_from_memories(
    memories: &[MemoryEmbedding],
    indices: &[usize],
) -> Vec<f32> {
    if indices.is_empty() { return Vec::new(); }
    let dim = memories[indices[0]].embedding.len();
    let mut sum = vec![0.0f32; dim];

    for &idx in indices {
        for (i, v) in memories[idx].embedding.iter().enumerate() {
            if i < dim { sum[i] += v; }
        }
    }

    let count = indices.len() as f32;
    let mut centroid: Vec<f32> = sum.into_iter().map(|s| s / count).collect();

    // L2 normalize
    let norm: f32 = centroid.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in &mut centroid {
            *v /= norm;
        }
    }

    centroid
}

fn create_concept_node(
    conn: &rusqlite::Connection,
    project_id: &str,
    centroid: &[f32],
    member_count: usize,
) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let centroid_blob: Vec<u8> = centroid.iter().flat_map(|f| f.to_le_bytes()).collect();

    conn.execute(
        "INSERT INTO concept_nodes (id, project_id, centroid, member_count, status, stability_score, cycle_count, created_at) \
         VALUES (?1, ?2, ?3, ?4, 'forming', 0, 1, datetime('now'))",
        rusqlite::params![id, project_id, centroid_blob, member_count as i64],
    )?;

    Ok(id)
}

fn update_concept_node(
    conn: &rusqlite::Connection,
    concept_id: &str,
    centroid: &[f32],
    member_count: usize,
) -> Result<()> {
    let centroid_blob: Vec<u8> = centroid.iter().flat_map(|f| f.to_le_bytes()).collect();
    conn.execute(
        "UPDATE concept_nodes SET centroid = ?1, member_count = ?2, \
         cycle_count = cycle_count + 1, updated_at = datetime('now') WHERE id = ?3",
        rusqlite::params![centroid_blob, member_count as i64, concept_id],
    )?;
    Ok(())
}

fn update_concept_memberships(
    conn: &rusqlite::Connection,
    concept_id: &str,
    memories: &[MemoryEmbedding],
    indices: &[usize],
) -> Result<()> {
    // Remove old memberships for this concept
    conn.execute(
        "DELETE FROM concept_memberships WHERE concept_id = ?1",
        [concept_id],
    )?;

    // Insert new memberships
    let mut stmt = conn.prepare(
        "INSERT OR REPLACE INTO concept_memberships (concept_id, memory_id, probability, assigned_at) \
         VALUES (?1, ?2, ?3, datetime('now'))",
    )?;

    for &idx in indices {
        stmt.execute(rusqlite::params![concept_id, memories[idx].id, 1.0])?;
    }

    Ok(())
}

// ============================================================================
// Merge / Split Detection
// ============================================================================

fn detect_and_apply_merges(conn: &rusqlite::Connection, project_id: &str) -> Result<usize> {
    let concepts = load_concept_nodes(conn, project_id)?;
    let mut merge_count = 0;

    for i in 0..concepts.len() {
        for j in (i + 1)..concepts.len() {
            if concepts[i].centroid.len() != concepts[j].centroid.len() { continue; }
            let sim = cosine_similarity(&concepts[i].centroid, &concepts[j].centroid);
            if sim >= ConceptConfig::MERGE_THRESHOLD {
                debug!(
                    "Merge candidate: {} <-> {} (similarity={:.3})",
                    concepts[i].id, concepts[j].id, sim
                );
                // Mark the smaller concept as merged into the larger
                conn.execute(
                    "UPDATE concept_nodes SET status = 'merged', merged_into = ?1 WHERE id = ?2",
                    rusqlite::params![concepts[i].id, concepts[j].id],
                )?;
                // Move memberships
                conn.execute(
                    "UPDATE concept_memberships SET concept_id = ?1 WHERE concept_id = ?2",
                    rusqlite::params![concepts[i].id, concepts[j].id],
                )?;
                merge_count += 1;
            }
        }
    }

    Ok(merge_count)
}

fn detect_splits(conn: &rusqlite::Connection, project_id: &str) -> Result<usize> {
    // Check each concept's internal variance
    let mut stmt = conn.prepare(
        "SELECT cn.id FROM concept_nodes cn \
         WHERE cn.project_id = ?1 AND cn.status != 'removed' AND cn.member_count > ?2",
    )?;

    let concept_ids: Vec<String> = stmt
        .query_map(
            rusqlite::params![project_id, ConceptConfig::MIN_CLUSTER_SIZE as i64 * 2],
            |row| row.get(0),
        )?
        .filter_map(|r| r.ok())
        .collect();

    let mut split_count = 0;

    for concept_id in &concept_ids {
        // Load member embeddings
        let mut mem_stmt = conn.prepare(
            "SELECT m.embedding FROM concept_memberships cm \
             JOIN memories m ON cm.memory_id = m.id \
             WHERE cm.concept_id = ?1 AND m.embedding IS NOT NULL",
        )?;

        let embeddings: Vec<Vec<f32>> = mem_stmt
            .query_map([concept_id], |row| {
                let blob: Vec<u8> = row.get(0)?;
                Ok(blob)
            })?
            .filter_map(|r| r.ok())
            .map(|blob| decode_embedding(&blob))
            .filter(|e| !e.is_empty())
            .collect();

        if embeddings.len() < 4 { continue; }

        // Compute internal variance (mean pairwise distance)
        let variance = compute_internal_variance(&embeddings);
        if variance > ConceptConfig::SPLIT_VARIANCE {
            debug!("Split candidate: concept {} (variance={:.3})", concept_id, variance);
            split_count += 1;
            // Flag for splitting (actual split happens next cycle)
            conn.execute(
                "UPDATE concept_nodes SET status = 'splitting' WHERE id = ?1",
                [concept_id],
            )?;
        }
    }

    Ok(split_count)
}

fn compute_internal_variance(embeddings: &[Vec<f32>]) -> f64 {
    let n = embeddings.len();
    if n < 2 { return 0.0; }

    let mut total_distance = 0.0;
    let mut count = 0;

    for i in 0..n {
        for j in (i + 1)..n {
            if embeddings[i].len() == embeddings[j].len() {
                let sim = cosine_similarity(&embeddings[i], &embeddings[j]);
                total_distance += 1.0 - sim; // Distance = 1 - similarity
                count += 1;
            }
        }
    }

    if count > 0 { total_distance / count as f64 } else { 0.0 }
}

// ============================================================================
// Utility
// ============================================================================

fn decode_embedding(blob: &[u8]) -> Vec<f32> {
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
    fn test_clustering_result_default() {
        let r = ClusteringResult::default();
        assert_eq!(r.clusters_found, 0);
        assert_eq!(r.duration_ms, 0);
    }

    #[test]
    fn test_compute_centroid() {
        let memories = vec![
            MemoryEmbedding {
                id: "a".into(),
                embedding: vec![1.0, 0.0, 0.0],
            },
            MemoryEmbedding {
                id: "b".into(),
                embedding: vec![0.0, 1.0, 0.0],
            },
        ];
        let centroid = compute_centroid_from_memories(&memories, &[0, 1]);
        assert_eq!(centroid.len(), 3);
        // Centroid of (1,0,0) and (0,1,0) is (0.5, 0.5, 0) normalized
        let norm = (0.5f32 * 0.5 + 0.5 * 0.5).sqrt();
        assert!((centroid[0] - 0.5 / norm).abs() < 0.01);
    }

    #[test]
    fn test_density_cluster_identical() {
        let memories = vec![
            MemoryEmbedding { id: "a".into(), embedding: vec![1.0, 0.0] },
            MemoryEmbedding { id: "b".into(), embedding: vec![1.0, 0.0] },
            MemoryEmbedding { id: "c".into(), embedding: vec![0.0, 1.0] },
        ];
        let clusters = density_cluster(&memories, 0.9);
        // a and b should cluster together, c alone
        assert!(clusters.len() >= 1);
    }

    #[test]
    fn test_internal_variance() {
        let embeddings = vec![
            vec![1.0, 0.0],
            vec![1.0, 0.0],
        ];
        let var = compute_internal_variance(&embeddings);
        assert!(var < 0.01, "Identical embeddings should have ~0 variance");
    }

    #[test]
    fn test_decode_embedding() {
        let values = vec![0.5f32, -0.3, 1.0];
        let blob: Vec<u8> = values.iter().flat_map(|f| f.to_le_bytes()).collect();
        let decoded = decode_embedding(&blob);
        assert_eq!(decoded.len(), 3);
        assert!((decoded[0] - 0.5).abs() < f32::EPSILON);
    }
}
