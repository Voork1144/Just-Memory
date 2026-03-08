//! Vector store backends — SqliteVec, Qdrant.
//!
//! Ports TypeScript `vector-manager.ts` and `qdrant-client.ts`.
//! Each backend implements the `VectorStore` trait for unified search.


use anyhow::Result;

use crate::config::definitions::{SearchConfig, StorageConfig};
use crate::db::pool::DbPool;
use crate::types::core::VecScoreRow;

// ============================================================================
// VectorStore Trait
// ============================================================================

/// Search options for vector store queries.
#[derive(Debug, Clone, Default)]
pub struct VectorSearchOptions {
    pub project_id: Option<String>,
    pub exclude_deleted: bool,
    pub limit: usize,
    pub min_similarity: f64,
}

/// Unified vector store interface.
pub trait VectorStore: Send + Sync {
    /// Search for similar vectors. Returns (id, score) pairs sorted by similarity.
    fn search(
        &self,
        embedding: &[f32],
        options: &VectorSearchOptions,
    ) -> Result<Vec<VecScoreRow>>;

    /// Upsert a vector by ID.
    fn upsert(
        &self,
        id: &str,
        embedding: &[f32],
        project_id: &str,
        deleted: bool,
    ) -> Result<()>;

    /// Delete a vector by ID.
    fn delete(&self, id: &str) -> Result<bool>;

    /// Count of stored vectors.
    fn count(&self) -> Result<i64>;

    /// Backend name.
    fn backend_name(&self) -> &'static str;

    /// Whether the backend is ready.
    fn is_ready(&self) -> bool;
}

// ============================================================================
// SqliteVec Backend
// ============================================================================

/// SQLite-based vector search using sqlite-vec extension.
///
/// Uses `vec_distance_cosine` for similarity computation. Falls back to
/// full table scan with manual cosine similarity if vec extension unavailable.
pub struct SqliteVecStore {
    pool: DbPool,
    dimension: usize,
}

impl SqliteVecStore {
    pub fn new(pool: DbPool, dimension: usize) -> Self {
        Self { pool, dimension }
    }

    /// Check if sqlite-vec is available.
    pub fn check_vec_available(&self) -> bool {
        let Ok(conn) = self.pool.get() else {
            return false;
        };
        // Try creating a test vec table
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS _vec_check USING vec0(v float[2]); \
             DROP TABLE IF EXISTS _vec_check;",
        )
        .is_ok()
    }
}

impl VectorStore for SqliteVecStore {
    fn search(
        &self,
        embedding: &[f32],
        options: &VectorSearchOptions,
    ) -> Result<Vec<VecScoreRow>> {
        let conn = self.pool.get()?;
        let limit = if options.limit > 0 { options.limit } else { 20 };
        let min_sim = if options.min_similarity > 0.0 {
            options.min_similarity
        } else {
            SearchConfig::semantic_min_similarity()
        };

        // Encode f32 embedding as little-endian bytes for sqlite-vec
        let embedding_bytes: Vec<u8> = embedding
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        // Build WHERE clause
        let mut conditions = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        params.push(Box::new(embedding_bytes));

        if let Some(ref pid) = options.project_id {
            conditions.push("m.project_id = ?".to_string());
            params.push(Box::new(pid.clone()));
        }
        if options.exclude_deleted {
            conditions.push("m.deleted_at IS NULL".to_string());
        }
        conditions.push("m.embedding IS NOT NULL".to_string());

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        // Using vec_distance_cosine: returns distance (0 = identical, 2 = opposite)
        // Convert to similarity: 1 - (distance / 2)
        let sql = format!(
            "SELECT m.id, (1.0 - (vec_distance_cosine(m.embedding, ?1) / 2.0)) as similarity \
             FROM memories m \
             {where_clause} \
             ORDER BY similarity DESC \
             LIMIT ?",
        );

        params.push(Box::new(limit as i64));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let results = stmt
            .query_map(param_refs.as_slice(), |row| {
                Ok(VecScoreRow {
                    id: row.get(0)?,
                    score: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .filter(|r| r.score >= min_sim)
            .collect();

        Ok(results)
    }

    fn upsert(
        &self,
        _id: &str,
        _embedding: &[f32],
        _project_id: &str,
        _deleted: bool,
    ) -> Result<()> {
        // Embeddings are stored directly in the memories table;
        // no separate upsert needed for sqlite-vec.
        Ok(())
    }

    fn delete(&self, _id: &str) -> Result<bool> {
        // Deletion handled by soft-delete on the memories table.
        Ok(true)
    }

    fn count(&self) -> Result<i64> {
        let conn = self.pool.get()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE embedding IS NOT NULL AND deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    fn backend_name(&self) -> &'static str {
        "sqlite-vec"
    }

    fn is_ready(&self) -> bool {
        self.pool.get().is_ok()
    }
}

// ============================================================================
// Qdrant Backend
// ============================================================================

/// Qdrant vector database backend via REST API.
///
/// Ports TypeScript `qdrant-client.ts`. Uses reqwest blocking client.
pub struct QdrantStore {
    base_url: String,
    collection: String,
    dimension: usize,
    client: reqwest::blocking::Client,
}

impl QdrantStore {
    pub fn new(port: u16, collection: &str, dimension: usize) -> Self {
        Self {
            base_url: format!("http://localhost:{port}"),
            collection: collection.to_string(),
            dimension,
            client: reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        }
    }

    pub fn with_defaults(dimension: usize) -> Self {
        Self::new(
            StorageConfig::qdrant_port(),
            StorageConfig::QDRANT_COLLECTION,
            dimension,
        )
    }

    fn collection_url(&self) -> String {
        format!("{}/collections/{}", self.base_url, self.collection)
    }

    /// Check if Qdrant is reachable and collection exists.
    pub fn health_check(&self) -> bool {
        self.client
            .get(&self.collection_url())
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

impl VectorStore for QdrantStore {
    fn search(
        &self,
        embedding: &[f32],
        options: &VectorSearchOptions,
    ) -> Result<Vec<VecScoreRow>> {
        let limit = if options.limit > 0 { options.limit } else { 20 };
        let min_sim = if options.min_similarity > 0.0 {
            options.min_similarity
        } else {
            SearchConfig::semantic_min_similarity()
        };

        // Build filter
        let mut must = Vec::new();
        if let Some(ref pid) = options.project_id {
            must.push(serde_json::json!({
                "key": "project_id",
                "match": { "value": pid }
            }));
        }
        if options.exclude_deleted {
            must.push(serde_json::json!({
                "key": "deleted",
                "match": { "value": false }
            }));
        }

        let filter = if must.is_empty() {
            None
        } else {
            Some(serde_json::json!({ "must": must }))
        };

        let mut body = serde_json::json!({
            "vector": embedding,
            "limit": limit,
            "score_threshold": min_sim,
        });

        if let Some(f) = filter {
            body["filter"] = f;
        }

        let url = format!("{}/points/search", self.collection_url());
        let resp = self.client
            .post(&url)
            .json(&body)
            .send()
            .map_err(|e| anyhow::anyhow!("Qdrant search request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().unwrap_or_default();
            anyhow::bail!("Qdrant search failed ({status}): {text}");
        }

        let result: serde_json::Value = resp.json()
            .map_err(|e| anyhow::anyhow!("Qdrant search parse failed: {e}"))?;

        let points = result["result"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        let results: Vec<VecScoreRow> = points
            .iter()
            .filter_map(|p| {
                let id = p["id"].as_str().map(|s| s.to_string())
                    .or_else(|| p["id"].as_u64().map(|n| n.to_string()))?;
                let score = p["score"].as_f64()?;
                Some(VecScoreRow { id, score })
            })
            .collect();

        Ok(results)
    }

    fn upsert(
        &self,
        id: &str,
        embedding: &[f32],
        project_id: &str,
        deleted: bool,
    ) -> Result<()> {
        let body = serde_json::json!({
            "points": [{
                "id": id,
                "vector": embedding,
                "payload": {
                    "project_id": project_id,
                    "deleted": deleted,
                }
            }]
        });

        let url = format!("{}/points", self.collection_url());
        let resp = self.client
            .put(&url)
            .json(&body)
            .send()
            .map_err(|e| anyhow::anyhow!("Qdrant upsert failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().unwrap_or_default();
            anyhow::bail!("Qdrant upsert failed ({status}): {text}");
        }

        Ok(())
    }

    fn delete(&self, id: &str) -> Result<bool> {
        let body = serde_json::json!({
            "points": [id]
        });

        let url = format!("{}/points/delete", self.collection_url());
        let resp = self.client
            .post(&url)
            .json(&body)
            .send()
            .map_err(|e| anyhow::anyhow!("Qdrant delete failed: {e}"))?;

        Ok(resp.status().is_success())
    }

    fn count(&self) -> Result<i64> {
        let resp = self.client
            .get(&self.collection_url())
            .send()
            .map_err(|e| anyhow::anyhow!("Qdrant count failed: {e}"))?;

        if !resp.status().is_success() {
            return Ok(0);
        }

        let result: serde_json::Value = resp.json()
            .map_err(|e| anyhow::anyhow!("Qdrant count parse failed: {e}"))?;

        Ok(result["result"]["points_count"].as_i64().unwrap_or(0))
    }

    fn backend_name(&self) -> &'static str {
        "qdrant"
    }

    fn is_ready(&self) -> bool {
        self.health_check()
    }
}

// ============================================================================
// Full-Table-Scan Fallback
// ============================================================================

/// Brute-force cosine similarity search over all memory embeddings.
///
/// Used when neither sqlite-vec nor Qdrant are available.
pub fn full_scan_search(
    pool: &DbPool,
    query_embedding: &[f32],
    project_id: Option<&str>,
    limit: usize,
    min_similarity: f64,
) -> Result<Vec<VecScoreRow>> {
    let conn = pool.get()?;
    let limit = if limit > 0 { limit } else { 20 };
    let min_sim = if min_similarity > 0.0 {
        min_similarity
    } else {
        SearchConfig::semantic_min_similarity()
    };

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match project_id {
        Some(pid) => (
            "SELECT id, embedding FROM memories \
             WHERE embedding IS NOT NULL AND deleted_at IS NULL AND project_id = ?"
                .to_string(),
            vec![Box::new(pid.to_string()) as Box<dyn rusqlite::types::ToSql>],
        ),
        None => (
            "SELECT id, embedding FROM memories \
             WHERE embedding IS NOT NULL AND deleted_at IS NULL"
                .to_string(),
            vec![],
        ),
    };

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        let id: String = row.get(0)?;
        let blob: Vec<u8> = row.get(1)?;
        Ok((id, blob))
    })?;

    let mut scored: Vec<VecScoreRow> = Vec::new();

    for row_result in rows {
        let (id, blob) = row_result?;
        // Decode f32 embedding from little-endian bytes
        if blob.len() % 4 != 0 {
            continue;
        }
        let stored: Vec<f32> = blob
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();

        if stored.len() != query_embedding.len() {
            continue;
        }

        let sim = crate::search::scoring::cosine_similarity(&stored, query_embedding);
        if sim >= min_sim {
            scored.push(VecScoreRow { id, score: sim });
        }
    }

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);

    Ok(scored)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vector_search_options_default() {
        let opts = VectorSearchOptions::default();
        assert!(opts.project_id.is_none());
        assert!(!opts.exclude_deleted);
        assert_eq!(opts.limit, 0);
    }

    #[test]
    fn test_qdrant_store_creation() {
        let store = QdrantStore::new(6333, "test_collection", 384);
        assert_eq!(store.backend_name(), "qdrant");
        assert_eq!(store.collection, "test_collection");
        assert_eq!(store.dimension, 384);
    }

    #[test]
    fn test_sqlite_vec_store_creation() {
        let pool = crate::db::pool::create_memory_pool().unwrap();
        let store = SqliteVecStore::new(pool, 384);
        assert_eq!(store.backend_name(), "sqlite-vec");
        assert_eq!(store.dimension, 384);
        assert!(store.is_ready());
    }

    #[test]
    fn test_full_scan_empty_db() {
        let pool = crate::db::pool::create_memory_pool().unwrap();
        let embedding = vec![0.1f32; 384];
        let results = full_scan_search(&pool, &embedding, None, 10, 0.3).unwrap();
        assert!(results.is_empty());
    }
}
