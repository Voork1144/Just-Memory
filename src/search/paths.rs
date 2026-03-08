//! Individual search paths — keyword, semantic, temporal, graph, concept, spreading activation.
//!
//! Ports TypeScript `search-paths.ts`, `concept-search.ts`, `spreading-activation.ts`.
//! Each path returns scored memory IDs for RRF fusion in the engine.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use tracing::warn;

use crate::config::definitions::SearchConfig;
use crate::db::pool::DbPool;
use crate::search::scoring::{cosine_similarity, recency_score};
use crate::search::vector_stores::{full_scan_search, VectorSearchOptions, VectorStore};
use crate::types::core::{MemoryRow, VecScoreRow};

// ============================================================================
// Keyword Search Result
// ============================================================================

/// Memory with keyword relevance score.
#[derive(Debug, Clone)]
pub struct KeywordResult {
    pub row: MemoryRow,
    pub keyword_score: f64,
}

/// Memory with semantic similarity score.
#[derive(Debug, Clone)]
pub struct SemanticResult {
    pub row: MemoryRow,
    pub similarity: f64,
}

/// Memory with temporal recency score.
#[derive(Debug, Clone)]
pub struct TemporalResult {
    pub row: MemoryRow,
    pub temporal_score: f64,
}

/// Memory with graph relevance score.
#[derive(Debug, Clone)]
pub struct GraphResult {
    pub row: MemoryRow,
    pub graph_score: f64,
}

/// Memory with concept membership score.
#[derive(Debug, Clone)]
pub struct ConceptResult {
    pub row: MemoryRow,
    pub concept_score: f64,
}

/// Activated memory from spreading activation.
#[derive(Debug, Clone)]
pub struct ActivatedMemory {
    pub id: String,
    pub score: f64,
}

// ============================================================================
// Temporal search options
// ============================================================================

#[derive(Debug, Clone, Default)]
pub struct TemporalSearchOptions {
    pub before: Option<String>,
    pub after: Option<String>,
    pub as_of: Option<String>,
    pub agent_id: Option<String>,
}

// ============================================================================
// Keyword Search
// ============================================================================

/// Keyword search using FTS5 with BM25 ranking, falling back to LIKE.
///
/// Ports TypeScript `keywordSearch()` from search-paths.ts.
pub fn keyword_search(
    pool: &DbPool,
    query: &str,
    project_id: &str,
    limit: usize,
    confidence_threshold: f64,
    use_fts5: bool,
    as_of: Option<&str>,
    sparse_tokens: Option<&str>,
    agent_id: Option<&str>,
) -> Result<Vec<KeywordResult>> {
    let trimmed = query.trim();
    if trimmed.is_empty() && sparse_tokens.is_none() {
        return Ok(Vec::new());
    }

    let conn = pool.get()?;

    // Build temporal and agent clauses
    let temporal_clause = if as_of.is_some() {
        "AND (m.valid_from IS NULL OR m.valid_from <= ?99) AND (m.valid_to IS NULL OR m.valid_to > ?98)"
    } else {
        ""
    };
    let _temporal_clause_no_alias = if as_of.is_some() {
        "AND (valid_from IS NULL OR valid_from <= ?99) AND (valid_to IS NULL OR valid_to > ?98)"
    } else {
        ""
    };
    let agent_clause = if agent_id.is_some() {
        "AND (m.agent_id = ?97 OR m.agent_id = 'system' OR m.agent_id IS NULL)"
    } else {
        ""
    };
    let _agent_clause_no_alias = if agent_id.is_some() {
        "AND (agent_id = ?97 OR agent_id = 'system' OR agent_id IS NULL)"
    } else {
        ""
    };

    let fetch_limit = (limit * 2) as i64;

    // Collect rows with optional fts_rank
    let rows: Vec<(MemoryRow, Option<f64>)>;

    if use_fts5 {
        // Build FTS5 query: escape special chars, implicit AND
        let fts_terms: Vec<String> = trimmed
            .split_whitespace()
            .filter(|t| t.len() > 1)
            .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
            .collect();

        let mut fts_query = fts_terms.join(" ");

        if let Some(sparse) = sparse_tokens {
            let sparse_clause: Vec<String> = sparse
                .split_whitespace()
                .filter(|t| t.len() > 1)
                .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
                .collect();
            let sparse_str = sparse_clause.join(" OR ");
            if !fts_query.is_empty() && !sparse_str.is_empty() {
                fts_query = format!("({fts_query}) OR ({sparse_str})");
            } else if !sparse_str.is_empty() {
                fts_query = sparse_str;
            }
        }

        if fts_query.is_empty() {
            return Ok(Vec::new());
        }

        // Try FTS5, fall back to LIKE on error
        let fts_result = (|| -> Result<Vec<(MemoryRow, Option<f64>)>> {
            let _sql = format!(
                "SELECT m.*, bm25(memories_fts) as fts_rank \
                 FROM memories_fts fts \
                 JOIN memories m ON fts.id = m.id \
                 WHERE memories_fts MATCH ?1 \
                 AND m.deleted_at IS NULL \
                 AND (m.project_id = ?2 OR m.project_id = 'global') \
                 {temporal_clause} {agent_clause} \
                 ORDER BY fts_rank \
                 LIMIT ?3"
            );
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            params.push(Box::new(fts_query.clone()));
            params.push(Box::new(project_id.to_string()));
            if let Some(ts) = as_of {
                params.push(Box::new(ts.to_string())); // ?99
                params.push(Box::new(ts.to_string())); // ?98
            }
            if let Some(aid) = agent_id {
                params.push(Box::new(aid.to_string())); // ?97
            }
            params.push(Box::new(fetch_limit));

            // We can't use numbered params with dynamic SQL easily, so rebuild with positional
            let sql_positional = rebuild_positional_sql(
                "SELECT m.*, bm25(memories_fts) as fts_rank \
                 FROM memories_fts fts \
                 JOIN memories m ON fts.id = m.id \
                 WHERE memories_fts MATCH ? \
                 AND m.deleted_at IS NULL \
                 AND (m.project_id = ? OR m.project_id = 'global')",
                as_of, agent_id,
                "ORDER BY fts_rank LIMIT ?",
                true,
            );

            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            let mut stmt = conn.prepare(&sql_positional)?;
            let result = stmt
                .query_map(param_refs.as_slice(), |row| {
                    let mem = row_to_memory(row)?;
                    let fts_rank: Option<f64> = row.get("fts_rank").ok();
                    Ok((mem, fts_rank))
                })?
                .filter_map(|r| r.ok())
                .collect();
            Ok(result)
        })();

        match fts_result {
            Ok(r) => rows = r,
            Err(_) => {
                // FTS5 failed, fall back to LIKE
                rows = like_fallback(
                    &conn, trimmed, project_id, as_of, agent_id, fetch_limit,
                )?;
            }
        }
    } else {
        rows = like_fallback(&conn, trimmed, project_id, as_of, agent_id, fetch_limit)?;
    }

    // Score results
    let query_terms: Vec<String> = trimmed
        .to_lowercase()
        .split_whitespace()
        .filter(|t| t.len() > 1)
        .map(|s| s.to_string())
        .collect();

    let results: Vec<KeywordResult> = rows
        .into_iter()
        .filter_map(|(m, fts_rank)| {
            let keyword_score = if let Some(rank) = fts_rank {
                // BM25: normalize negative rank to [0,1]
                1.0 / (1.0 + rank.abs())
            } else if !query_terms.is_empty() {
                // LIKE fallback: term overlap
                let content_lower = m.content.to_lowercase();
                let match_count = query_terms.iter().filter(|t| content_lower.contains(t.as_str())).count();
                match_count as f64 / query_terms.len() as f64
            } else {
                1.0
            };

            if keyword_score <= 0.0 {
                return None;
            }
            // Confidence filter
            if (m.confidence.unwrap_or(0.5)) < confidence_threshold {
                return None;
            }

            Some(KeywordResult { row: m, keyword_score })
        })
        .collect();

    Ok(results)
}

/// LIKE fallback for keyword search.
fn like_fallback(
    conn: &rusqlite::Connection,
    query: &str,
    project_id: &str,
    as_of: Option<&str>,
    agent_id: Option<&str>,
    limit: i64,
) -> Result<Vec<(MemoryRow, Option<f64>)>> {
    let sanitized = sanitize_like_pattern(query);
    let pattern = format!("%{sanitized}%");

    let sql = rebuild_positional_sql(
        "SELECT * FROM memories \
         WHERE deleted_at IS NULL \
         AND (project_id = ? OR project_id = 'global') \
         AND content LIKE ? ESCAPE '\\'",
        as_of, agent_id,
        "ORDER BY confidence DESC, importance DESC LIMIT ?",
        false,
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params.push(Box::new(project_id.to_string()));
    params.push(Box::new(pattern));
    if let Some(ts) = as_of {
        params.push(Box::new(ts.to_string()));
        params.push(Box::new(ts.to_string()));
    }
    if let Some(aid) = agent_id {
        params.push(Box::new(aid.to_string()));
    }
    params.push(Box::new(limit));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let mem = row_to_memory(row)?;
            Ok((mem, None))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// ============================================================================
// Semantic Search
// ============================================================================

/// Semantic search using VectorStore, falling back to full table scan.
///
/// Ports TypeScript `semanticSearch()` from search-paths.ts.
pub fn semantic_search(
    pool: &DbPool,
    query_embedding: &[f32],
    project_id: &str,
    limit: usize,
    confidence_threshold: f64,
    vector_store: Option<&dyn VectorStore>,
    as_of: Option<&str>,
    agent_id: Option<&str>,
) -> Result<Vec<SemanticResult>> {
    let min_sim = SearchConfig::semantic_min_similarity();
    let fetch_limit = limit * 2;

    // Try VectorStore first
    if let Some(store) = vector_store {
        if store.is_ready() {
            let results = store.search(
                query_embedding,
                &VectorSearchOptions {
                    project_id: Some(project_id.to_string()),
                    exclude_deleted: true,
                    limit: fetch_limit * 3,
                    min_similarity: min_sim,
                },
            )?;

            if !results.is_empty() {
                return enrich_semantic_results(
                    pool, &results, project_id, confidence_threshold,
                    as_of, agent_id, min_sim, fetch_limit,
                );
            }
        }
    }

    // Fallback: full table scan
    let results = full_scan_search(
        pool, query_embedding,
        Some(project_id), fetch_limit * 3, min_sim,
    )?;

    enrich_semantic_results(
        pool, &results, project_id, confidence_threshold,
        as_of, agent_id, min_sim, fetch_limit,
    )
}

/// Fetch full MemoryRows for vector search results and apply filters.
fn enrich_semantic_results(
    pool: &DbPool,
    vec_results: &[VecScoreRow],
    project_id: &str,
    confidence_threshold: f64,
    as_of: Option<&str>,
    agent_id: Option<&str>,
    min_sim: f64,
    limit: usize,
) -> Result<Vec<SemanticResult>> {
    if vec_results.is_empty() {
        return Ok(Vec::new());
    }

    let conn = pool.get()?;
    let ids: Vec<String> = vec_results.iter().map(|r| r.id.replace('-', "")).collect();
    let score_map: HashMap<String, f64> = vec_results
        .iter()
        .map(|r| (r.id.replace('-', ""), r.score))
        .collect();

    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT * FROM memories WHERE id IN ({placeholders}) \
         AND deleted_at IS NULL AND (project_id = ? OR project_id = 'global')"
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for id in &ids {
        params.push(Box::new(id.clone()));
    }
    params.push(Box::new(project_id.to_string()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<MemoryRow> = stmt
        .query_map(param_refs.as_slice(), |row| row_to_memory(row))?
        .filter_map(|r| r.ok())
        .collect();

    let mut results: Vec<SemanticResult> = rows
        .into_iter()
        .filter_map(|m| {
            // Temporal filter
            if let Some(ts) = as_of {
                if let Some(vf) = &m.valid_from {
                    if vf.as_str() > ts { return None; }
                }
                if let Some(vt) = &m.valid_to {
                    if vt.as_str() <= ts { return None; }
                }
            }
            // Agent filter
            if let Some(aid) = agent_id {
                if let Some(ref mid) = m.agent_id {
                    if mid != aid && mid != "system" { return None; }
                }
            }
            let sim = *score_map.get(&m.id).unwrap_or(&0.0);
            if sim <= min_sim { return None; }
            if m.confidence.unwrap_or(0.5) < confidence_threshold { return None; }
            Some(SemanticResult { row: m, similarity: sim })
        })
        .collect();

    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    Ok(results)
}

// ============================================================================
// Temporal Search
// ============================================================================

/// Temporal/recency retrieval path. Returns memories ordered by valid_from,
/// filtered by temporal validity window, scored by recency decay.
///
/// Ports TypeScript `temporalSearch()` from search-paths.ts.
pub fn temporal_search(
    pool: &DbPool,
    query: &str,
    project_id: &str,
    limit: usize,
    confidence_threshold: f64,
    options: &TemporalSearchOptions,
) -> Result<Vec<TemporalResult>> {
    let conn = pool.get()?;
    let mut conditions: Vec<String> = vec![
        "deleted_at IS NULL".into(),
        "(project_id = ? OR project_id = 'global')".into(),
    ];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params.push(Box::new(project_id.to_string()));

    // Temporal validity window
    if let Some(ref as_of) = options.as_of {
        conditions.push("(valid_from IS NULL OR valid_from <= ?)".into());
        params.push(Box::new(as_of.clone()));
        conditions.push("(valid_to IS NULL OR valid_to > ?)".into());
        params.push(Box::new(as_of.clone()));
    } else {
        conditions.push("(valid_to IS NULL OR valid_to > datetime('now'))".into());
    }

    if let Some(ref after) = options.after {
        conditions.push("valid_from >= ?".into());
        params.push(Box::new(after.clone()));
    }
    if let Some(ref before) = options.before {
        conditions.push("valid_from < ?".into());
        params.push(Box::new(before.clone()));
    }
    if let Some(ref aid) = options.agent_id {
        conditions.push("(agent_id = ? OR agent_id = 'system' OR agent_id IS NULL)".into());
        params.push(Box::new(aid.clone()));
    }

    // Optional content filter
    let trimmed = query.trim();
    if trimmed.len() > 2 {
        let sanitized = sanitize_like_pattern(trimmed);
        conditions.push("content LIKE ? ESCAPE '\\\\'".into());
        params.push(Box::new(format!("%{sanitized}%")));
    }

    let fetch_limit = (limit * 2) as i64;
    params.push(Box::new(fetch_limit));

    let sql = format!(
        "SELECT * FROM memories WHERE {} ORDER BY valid_from DESC LIMIT ?",
        conditions.join(" AND ")
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<MemoryRow> = stmt
        .query_map(param_refs.as_slice(), |row| row_to_memory(row))?
        .filter_map(|r| r.ok())
        .collect();

    let results: Vec<TemporalResult> = rows
        .into_iter()
        .filter(|m| m.confidence.unwrap_or(0.5) >= confidence_threshold)
        .map(|m| {
            let date = m.valid_from.as_deref().or(Some(&m.created_at)).unwrap_or("");
            let score = recency_score(date, SearchConfig::TEMPORAL_DECAY_HALF_LIFE_DAYS);
            TemporalResult { row: m, temporal_score: score }
        })
        .collect();

    Ok(results)
}

// ============================================================================
// Graph Search
// ============================================================================

/// Graph-based retrieval. Finds seed memories, expands via Hebbian co-retrieval edges.
///
/// Ports TypeScript `graphSearch()` from search-paths.ts.
pub fn graph_search(
    pool: &DbPool,
    query: &str,
    query_embedding: Option<&[f32]>,
    project_id: &str,
    limit: usize,
    confidence_threshold: f64,
    vector_store: Option<&dyn VectorStore>,
    as_of: Option<&str>,
    agent_id: Option<&str>,
) -> Result<Vec<GraphResult>> {
    let seed_count = SearchConfig::GRAPH_SEED_COUNT;
    let max_neighbors = SearchConfig::GRAPH_MAX_NEIGHBORS;

    // Step 1: Find seed memories via semantic search
    let mut seed_ids: Vec<String> = Vec::new();

    if let Some(emb) = query_embedding {
        if let Some(store) = vector_store {
            if store.is_ready() {
                match store.search(emb, &VectorSearchOptions {
                    project_id: Some(project_id.to_string()),
                    exclude_deleted: true,
                    limit: seed_count,
                    min_similarity: 0.0,
                }) {
                    Ok(results) => {
                        seed_ids = results.iter().map(|r| r.id.replace('-', "")).collect();
                    }
                    Err(e) => {
                        warn!("Graph search semantic seeds failed: {e}");
                    }
                }
            }
        }
    }

    // Fallback: keyword seeds
    if seed_ids.is_empty() {
        match keyword_search(pool, query, project_id, seed_count, 0.0, false, None, None, agent_id) {
            Ok(kw) => {
                seed_ids = kw.iter().map(|r| r.row.id.clone()).collect();
            }
            Err(e) => {
                warn!("Graph search keyword seeds failed: {e}");
                return Ok(Vec::new());
            }
        }
    }

    if seed_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: Expand via Hebbian neighbors
    let conn = pool.get()?;
    let mut neighbor_ids = HashSet::new();
    let mut neighbor_weights: HashMap<String, f64> = HashMap::new();

    for sid in &seed_ids {
        neighbor_ids.insert(sid.clone());
    }

    for sid in &seed_ids {
        let neighbors = get_hebbian_neighbors(&conn, sid, project_id, 0.05, max_neighbors)?;
        for (nid, weight) in neighbors {
            neighbor_ids.insert(nid.clone());
            let existing = neighbor_weights.get(&nid).copied().unwrap_or(0.0);
            neighbor_weights.insert(nid, existing.max(weight));
        }
    }

    // Step 3: Fetch full rows
    let all_ids: Vec<&str> = neighbor_ids.iter().map(|s| s.as_str()).collect();
    if all_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = all_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let temporal_filter = if as_of.is_some() {
        "AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to > ?)"
    } else {
        "AND (valid_to IS NULL OR valid_to > datetime('now'))"
    };
    let agent_filter = if agent_id.is_some() {
        "AND (agent_id = ? OR agent_id = 'system' OR agent_id IS NULL)"
    } else {
        ""
    };

    let sql = format!(
        "SELECT * FROM memories WHERE id IN ({placeholders}) \
         AND deleted_at IS NULL AND (project_id = ? OR project_id = 'global') \
         {temporal_filter} {agent_filter}"
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for id in &all_ids {
        params.push(Box::new(id.to_string()));
    }
    params.push(Box::new(project_id.to_string()));
    if let Some(ts) = as_of {
        params.push(Box::new(ts.to_string()));
        params.push(Box::new(ts.to_string()));
    }
    if let Some(aid) = agent_id {
        params.push(Box::new(aid.to_string()));
    }

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<MemoryRow> = stmt
        .query_map(param_refs.as_slice(), |row| row_to_memory(row))?
        .filter_map(|r| r.ok())
        .collect();

    // Step 4: Score — seeds get 1.0, neighbors get gradient based on edge weight
    let seed_set: HashSet<&str> = seed_ids.iter().map(|s| s.as_str()).collect();

    let mut results: Vec<GraphResult> = rows
        .into_iter()
        .filter(|m| m.confidence.unwrap_or(0.5) >= confidence_threshold)
        .map(|m| {
            let score = if seed_set.contains(m.id.as_str()) {
                1.0
            } else {
                0.3 + 0.6 * neighbor_weights.get(&m.id).copied().unwrap_or(0.1)
            };
            GraphResult { row: m, graph_score: score }
        })
        .collect();

    results.truncate(limit * 2);
    Ok(results)
}

// ============================================================================
// Concept Search
// ============================================================================

/// Concept-aware retrieval: match query to concept nodes, retrieve members.
///
/// Ports TypeScript `conceptSearch()` from concept-search.ts.
pub fn concept_search(
    pool: &DbPool,
    query: &str,
    query_embedding: Option<&[f32]>,
    project_id: &str,
    limit: usize,
    confidence_threshold: f64,
    as_of: Option<&str>,
    agent_id: Option<&str>,
) -> Result<Vec<ConceptResult>> {
    const MAX_CONCEPT_MATCHES: usize = 5;
    const MAX_CONCEPT_MEMBERS: usize = 20;
    const CONCEPT_CENTROID_MIN_SIM: f64 = 0.3;

    let query_words: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .map(|w| w.to_string())
        .collect();

    if query_words.is_empty() {
        return Ok(Vec::new());
    }

    let conn = pool.get()?;

    // Step 1: Get concept node candidates
    let concept_rows = conn.prepare(
        "SELECT id, name, description, centroid, cluster_size \
         FROM concept_nodes \
         WHERE (project_id = ? OR project_id = 'global') AND cluster_size > 0 \
         ORDER BY cluster_size DESC LIMIT 50"
    )?.query_map([project_id], |row| {
        Ok(ConceptNodeCandidate {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            centroid: row.get(3)?,
            _cluster_size: row.get(4)?,
        })
    })?.filter_map(|r| r.ok()).collect::<Vec<_>>();

    if concept_rows.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: Score concepts by keyword overlap + centroid similarity
    let mut scored: Vec<(String, f64)> = Vec::new();

    for concept in &concept_rows {
        let mut score = 0.0;

        // Keyword match on name + description
        let name_desc = format!(
            "{} {}",
            concept.name.as_deref().unwrap_or(""),
            concept.description.as_deref().unwrap_or("")
        ).to_lowercase();

        for word in &query_words {
            if name_desc.contains(word.as_str()) {
                score += 0.3;
            }
        }

        // Centroid similarity
        if let (Some(emb), Some(centroid_blob)) = (query_embedding, &concept.centroid) {
            if centroid_blob.len() >= emb.len() * 4 {
                let centroid: Vec<f32> = centroid_blob
                    .chunks_exact(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .collect();
                if centroid.len() == emb.len() {
                    let sim = cosine_similarity(&centroid, emb);
                    if sim >= CONCEPT_CENTROID_MIN_SIM {
                        score += sim;
                    }
                }
            }
        }

        if score > 0.0 {
            scored.push((concept.id.clone(), score));
        }
    }

    if scored.is_empty() {
        return Ok(Vec::new());
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top_concepts: Vec<(String, f64)> = scored.into_iter().take(MAX_CONCEPT_MATCHES).collect();

    // Step 3: Retrieve member memories
    let concept_ids: Vec<&str> = top_concepts.iter().map(|(id, _)| id.as_str()).collect();
    let concept_score_map: HashMap<&str, f64> = top_concepts.iter().map(|(id, s)| (id.as_str(), *s)).collect();

    let placeholders = concept_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let temporal_filter = if as_of.is_some() {
        "AND (m.valid_from IS NULL OR m.valid_from <= ?) AND (m.valid_to IS NULL OR m.valid_to > ?)"
    } else {
        "AND (m.valid_to IS NULL OR m.valid_to > datetime('now'))"
    };
    let agent_filter_sql = if agent_id.is_some() {
        "AND (m.agent_id = ? OR m.agent_id = 'system' OR m.agent_id IS NULL)"
    } else {
        ""
    };
    let confidence_filter = if confidence_threshold > 0.0 {
        "AND m.confidence >= ?"
    } else {
        ""
    };

    let sql = format!(
        "SELECT DISTINCT m.*, cm.concept_id, cm.probability \
         FROM concept_memberships cm \
         JOIN memories m ON m.id = cm.memory_id \
         WHERE cm.concept_id IN ({placeholders}) \
         AND m.deleted_at IS NULL \
         AND (m.project_id = ? OR m.project_id = 'global') \
         {temporal_filter} {agent_filter_sql} {confidence_filter} \
         ORDER BY cm.probability DESC LIMIT ?"
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for cid in &concept_ids {
        params.push(Box::new(cid.to_string()));
    }
    params.push(Box::new(project_id.to_string()));
    if let Some(ts) = as_of {
        params.push(Box::new(ts.to_string()));
        params.push(Box::new(ts.to_string()));
    }
    if let Some(aid) = agent_id {
        params.push(Box::new(aid.to_string()));
    }
    if confidence_threshold > 0.0 {
        params.push(Box::new(confidence_threshold));
    }
    params.push(Box::new(MAX_CONCEPT_MEMBERS as i64));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;

    let member_rows: Vec<(MemoryRow, String, f64)> = stmt
        .query_map(param_refs.as_slice(), |row| {
            let mem = row_to_memory(row)?;
            let concept_id: String = row.get("concept_id")?;
            let probability: f64 = row.get("probability").unwrap_or(0.5);
            Ok((mem, concept_id, probability))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Step 4: Deduplicate and score
    let mut seen = HashSet::new();
    let mut results = Vec::new();

    for (mem, concept_id, probability) in member_rows {
        if seen.contains(&mem.id) {
            continue;
        }
        seen.insert(mem.id.clone());

        let concept_score = concept_score_map.get(concept_id.as_str()).copied().unwrap_or(0.0) * probability;
        results.push(ConceptResult { row: mem, concept_score });

        if results.len() >= limit {
            break;
        }
    }

    Ok(results)
}

// ============================================================================
// Spreading Activation
// ============================================================================

/// Multi-hop spreading activation through Hebbian and entity graphs.
///
/// Ports TypeScript `spreadActivation()` / `getActivatedMemoryIds()`.
pub fn spreading_activation(
    pool: &DbPool,
    seed_ids: &[String],
    project_id: &str,
    max_results: usize,
    as_of: Option<&str>,
    agent_id: Option<&str>,
) -> Result<Vec<ActivatedMemory>> {
    let max_hops = SearchConfig::SPREADING_ACTIVATION_MAX_HOPS;
    let decay_factor = SearchConfig::SPREADING_ACTIVATION_DECAY;
    let min_weight = SearchConfig::SPREADING_ACTIVATION_MIN_WEIGHT;
    let max_results = if max_results > 0 {
        max_results
    } else {
        SearchConfig::SPREADING_ACTIVATION_MAX_RESULTS
    };

    if seed_ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = pool.get()?;

    // Temporal and agent filter fragments
    let temporal_filter = if as_of.is_some() {
        "AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to > ?)"
    } else {
        "AND (valid_to IS NULL OR valid_to > datetime('now'))"
    };
    let agent_filter = if agent_id.is_some() {
        "AND (agent_id = ? OR agent_id = 'system' OR agent_id IS NULL)"
    } else {
        ""
    };

    // Track activations: id -> (activation, hop_count)
    let mut activations: HashMap<String, (f64, usize)> = HashMap::new();
    let seed_set: HashSet<String> = seed_ids.iter().cloned().collect();

    // Initialize seeds
    for sid in seed_ids {
        activations.insert(sid.clone(), (1.0, 0));
    }

    // BFS spreading
    let mut current_frontier: HashSet<String> = seed_ids.iter().cloned().collect();

    for hop in 1..=max_hops {
        let mut next_frontier = HashSet::new();

        for node_id in &current_frontier {
            let node_activation = activations.get(node_id).map(|a| a.0).unwrap_or(0.0);

            // Get Hebbian neighbors
            let neighbors = get_hebbian_neighbors(&conn, node_id, project_id, min_weight, 10)?;

            for (neighbor_id, weight) in &neighbors {
                let new_activation = node_activation * weight * decay_factor;
                if new_activation < min_weight {
                    continue;
                }

                // Verify memory exists and passes filters
                let exists = memory_exists(
                    &conn, neighbor_id, project_id,
                    temporal_filter, as_of,
                    agent_filter, agent_id,
                )?;
                if !exists {
                    continue;
                }

                let existing = activations.get(neighbor_id).map(|a| a.0).unwrap_or(0.0);
                if new_activation > existing {
                    activations.insert(neighbor_id.clone(), (new_activation, hop));
                    next_frontier.insert(neighbor_id.clone());
                }
            }

            // Get entity-relation neighbors (memories sharing entities)
            let entity_neighbors = get_entity_neighbors(&conn, node_id, project_id)?;
            for neighbor_id in &entity_neighbors {
                let entity_weight = 0.3; // Entity relations get lower weight
                let new_activation = node_activation * entity_weight * decay_factor;
                if new_activation < min_weight {
                    continue;
                }

                let exists = memory_exists(
                    &conn, neighbor_id, project_id,
                    temporal_filter, as_of,
                    agent_filter, agent_id,
                )?;
                if !exists {
                    continue;
                }

                let existing = activations.get(neighbor_id).map(|a| a.0).unwrap_or(0.0);
                if new_activation > existing {
                    activations.insert(neighbor_id.clone(), (new_activation, hop));
                    next_frontier.insert(neighbor_id.clone());
                }
            }
        }

        if next_frontier.is_empty() {
            break;
        }
        current_frontier = next_frontier;
    }

    // Collect results excluding seeds, sorted by activation
    let mut results: Vec<ActivatedMemory> = activations
        .into_iter()
        .filter(|(id, _)| !seed_set.contains(id))
        .map(|(id, (activation, _))| ActivatedMemory { id, score: activation })
        .collect();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(max_results);

    Ok(results)
}

// ============================================================================
// Shared Helpers
// ============================================================================

/// Fetch Hebbian co-retrieval neighbors for a memory.
pub fn get_hebbian_neighbors(
    conn: &rusqlite::Connection,
    memory_id: &str,
    project_id: &str,
    min_weight: f64,
    max_count: usize,
) -> Result<Vec<(String, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT \
           CASE WHEN memory_a = ?1 THEN memory_b ELSE memory_a END as neighbor_id, \
           weight \
         FROM co_retrieval_edges \
         WHERE (project_id = ?2 OR project_id = 'global') \
         AND (memory_a = ?1 OR memory_b = ?1) \
         AND weight >= ?3 \
         ORDER BY weight DESC \
         LIMIT ?4"
    )?;

    let rows = stmt
        .query_map(
            rusqlite::params![memory_id, project_id, min_weight, max_count as i64],
            |row| {
                let id: String = row.get(0)?;
                let weight: f64 = row.get(1)?;
                Ok((id, weight))
            },
        )?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

/// Fetch entity-relation neighbors (memories sharing entities via edges table).
fn get_entity_neighbors(
    conn: &rusqlite::Connection,
    memory_id: &str,
    project_id: &str,
) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT e2.from_id as neighbor_id \
         FROM edges e1 \
         JOIN edges e2 ON e2.to_id = e1.to_id AND e2.from_id != e1.from_id \
         WHERE e1.from_id = ?1 \
         AND e1.relation_type NOT LIKE 'contradiction_%' \
         AND e2.relation_type NOT LIKE 'contradiction_%' \
         AND e1.valid_to IS NULL AND e2.valid_to IS NULL \
         AND (e1.project_id = ?2 OR e1.project_id = 'global') \
         LIMIT 5"
    )?;

    let rows = stmt
        .query_map(rusqlite::params![memory_id, project_id], |row| {
            row.get::<_, String>(0)
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

/// Check if a memory exists and passes temporal/agent filters.
fn memory_exists(
    conn: &rusqlite::Connection,
    memory_id: &str,
    project_id: &str,
    temporal_filter: &str,
    as_of: Option<&str>,
    agent_filter: &str,
    agent_id: Option<&str>,
) -> Result<bool> {
    let sql = format!(
        "SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL \
         AND (project_id = ? OR project_id = 'global') \
         {temporal_filter} {agent_filter}"
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params.push(Box::new(memory_id.to_string()));
    params.push(Box::new(project_id.to_string()));
    if let Some(ts) = as_of {
        params.push(Box::new(ts.to_string()));
        params.push(Box::new(ts.to_string()));
    }
    if let Some(aid) = agent_id {
        params.push(Box::new(aid.to_string()));
    }

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let exists = conn.prepare(&sql)?.exists(param_refs.as_slice())?;
    Ok(exists)
}

/// Convert a rusqlite Row to MemoryRow.
///
/// Must handle all columns in the memories table. Missing optional columns
/// return None/default.
pub fn row_to_memory(row: &rusqlite::Row) -> rusqlite::Result<MemoryRow> {
    Ok(MemoryRow {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        content: row.get("content")?,
        memory_type: row.get("type").unwrap_or_default(),
        tags: row.get("tags").ok(),
        importance: row.get("importance").unwrap_or(Some(0.5)),
        confidence: row.get("confidence").unwrap_or(Some(0.5)),
        created_at: row.get("created_at").unwrap_or_default(),
        updated_at: row.get("updated_at").ok().flatten(),
        last_accessed: row.get("last_accessed").ok().flatten(),
        access_count: row.get("access_count").unwrap_or(0),
        strength: row.get("strength").unwrap_or(Some(1.0)),
        deleted_at: row.get("deleted_at").ok().flatten(),
        embedding: None, // Don't load embedding blobs into memory by default
        valid_from: row.get("valid_from").ok().flatten(),
        valid_to: row.get("valid_to").ok().flatten(),
        superseded_by: row.get("superseded_by").ok().flatten(),
        agent_id: row.get("agent_id").ok().flatten(),
        tier: row.get("tier").ok().flatten(),
        processing_depth: row.get("processing_depth").ok().flatten(),
        source_uri: row.get("source_uri").ok().flatten(),
        content_hash: row.get("content_hash").ok().flatten(),
        source_count: row.get("source_count").unwrap_or(0),
        contradiction_count: row.get("contradiction_count").unwrap_or(0),
        confirmation_count: row.get("confirmation_count").unwrap_or(0),
        search_hit_count: row.get("search_hit_count").unwrap_or(0),
        quality_score: row.get("quality_score").ok().flatten(),
    })
}

/// Sanitize a string for use in SQL LIKE patterns.
fn sanitize_like_pattern(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Build a positional-parameter SQL string with optional temporal/agent clauses.
fn rebuild_positional_sql(
    base: &str,
    as_of: Option<&str>,
    agent_id: Option<&str>,
    tail: &str,
    use_alias: bool,
) -> String {
    let prefix = if use_alias { "m." } else { "" };
    let mut sql = base.to_string();
    if as_of.is_some() {
        sql += &format!(
            " AND ({prefix}valid_from IS NULL OR {prefix}valid_from <= ?) \
             AND ({prefix}valid_to IS NULL OR {prefix}valid_to > ?)"
        );
    }
    if agent_id.is_some() {
        sql += &format!(
            " AND ({prefix}agent_id = ? OR {prefix}agent_id = 'system' OR {prefix}agent_id IS NULL)"
        );
    }
    sql += " ";
    sql += tail;
    sql
}

/// Internal concept node row for scoring.
struct ConceptNodeCandidate {
    id: String,
    name: Option<String>,
    description: Option<String>,
    centroid: Option<Vec<u8>>,
    _cluster_size: i64,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_like_pattern() {
        assert_eq!(sanitize_like_pattern("hello%world"), "hello\\%world");
        assert_eq!(sanitize_like_pattern("test_case"), "test\\_case");
        assert_eq!(sanitize_like_pattern("a\\b"), "a\\\\b");
    }

    #[test]
    fn test_rebuild_positional_sql() {
        let sql = rebuild_positional_sql(
            "SELECT * FROM t WHERE x = ?",
            Some("2024-01-01"),
            Some("agent-1"),
            "LIMIT ?",
            false,
        );
        assert!(sql.contains("valid_from IS NULL OR valid_from <= ?"));
        assert!(sql.contains("agent_id = ?"));
        assert!(sql.contains("LIMIT ?"));
    }

    #[test]
    fn test_keyword_search_empty_query() {
        let pool = crate::db::pool::create_memory_pool().unwrap();
        let results = keyword_search(&pool, "", "test", 10, 0.0, false, None, None, None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_temporal_search_empty_db() {
        let pool = crate::db::pool::create_memory_pool().unwrap();
        let results = temporal_search(
            &pool, "test", "test-project", 10, 0.0,
            &TemporalSearchOptions::default(),
        ).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_concept_search_empty_query() {
        let pool = crate::db::pool::create_memory_pool().unwrap();
        let results = concept_search(&pool, "", None, "test", 10, 0.0, None, None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_spreading_activation_empty_seeds() {
        let pool = crate::db::pool::create_memory_pool().unwrap();
        let results = spreading_activation(&pool, &[], "test", 20, None, None).unwrap();
        assert!(results.is_empty());
    }
}
