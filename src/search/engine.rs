//! Search engine orchestrator — coordinates 6 search paths, RRF fusion, MMR.
//!
//! Ports TypeScript `search.ts` hybridSearch() and rerankedSearch().
//! Pipeline: prepare_query → 6 paths → merge → RRF → composite → rerank → MMR.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use tracing::{debug, warn};

use crate::config::definitions::{
    HebbianConfig, QualityScoreConfig, SearchConfig,
};
use crate::db::pool::DbPool;
use crate::models::manager::ModelManager;
use crate::search::paths::{
    self, TemporalSearchOptions,
};
use crate::search::query::{
    self, PreparedQuery,
};
use crate::search::reranker::{self, RerankCandidate};
use crate::search::scoring::{
    self, compute_composite_score, recency_score, MmrCandidate, ScoringSignals, SessionContextVector,
};
use crate::search::vector_stores::VectorStore;
use crate::types::api::MemorySummary;
use crate::types::core::MemoryRow;

// ============================================================================
// Combined Entry — per-path scores for a single memory
// ============================================================================

#[derive(Debug, Clone)]
struct CombinedEntry {
    row: MemoryRow,
    keyword_score: f64,
    semantic_score: f64,
    temporal_score: f64,
    graph_score: f64,
    concept_score: f64,
    spreading_score: f64,
}

impl CombinedEntry {
    fn new(row: MemoryRow) -> Self {
        Self {
            row,
            keyword_score: 0.0,
            semantic_score: 0.0,
            temporal_score: 0.0,
            graph_score: 0.0,
            concept_score: 0.0,
            spreading_score: 0.0,
        }
    }
}

// ============================================================================
// Search Options
// ============================================================================

/// Options for hybrid search.
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    pub project_id: String,
    pub limit: usize,
    pub confidence_threshold: f64,
    pub use_fts5: bool,
    pub as_of: Option<String>,
    pub agent_id: Option<String>,
}

/// Options for reranked search (extends SearchOptions).
#[derive(Debug, Clone, Default)]
pub struct RerankedSearchOptions {
    pub base: SearchOptions,
    pub rerank: Option<bool>,
    pub rerank_top_k: Option<usize>,
    pub mmr: Option<bool>,
    pub mmr_lambda: Option<f64>,
}

// ============================================================================
// Search Context — shared state across a search call
// ============================================================================

/// Everything the engine needs to execute a search.
pub struct SearchContext<'a> {
    pub pool: &'a DbPool,
    pub model_manager: Option<&'a ModelManager>,
    pub vector_store: Option<&'a dyn VectorStore>,
    pub session_context: Option<&'a SessionContextVector>,
}

// ============================================================================
// Hybrid Search
// ============================================================================

/// Main hybrid search: 6-path TEMPR retrieval → RRF fusion → composite scoring.
///
/// Ports TypeScript `hybridSearch()` from search.ts.
pub fn hybrid_search(
    ctx: &SearchContext,
    query: &str,
    opts: &SearchOptions,
) -> Result<Vec<MemorySummary>> {
    let limit = if opts.limit > 0 { opts.limit } else { 10 };

    // Phase 1: Prepare query context
    let prepared = query::prepare_search_query(query, opts.as_of.as_deref());

    // Phase 2: Generate query embedding (needed for semantic, graph, concept paths)
    let query_embedding = generate_query_embedding(ctx, &prepared.effective_query);

    // Phase 3: Execute 6 search paths
    let combined = execute_search_paths(ctx, &prepared, &query_embedding, opts, limit)?;

    // Phase 4: Rank, score, format
    let results = rank_and_enrich(ctx, combined, &prepared, opts, limit)?;

    Ok(results)
}

// ============================================================================
// Reranked Search
// ============================================================================

/// Enhanced search with cross-encoder reranking and MMR diversity.
///
/// Pipeline: hybridSearch(limit * 2) → cross-encoder rerank → MMR → top limit.
/// Ports TypeScript `rerankedSearch()` from search.ts.
pub fn reranked_search(
    ctx: &SearchContext,
    query: &str,
    opts: &RerankedSearchOptions,
) -> Result<Vec<MemorySummary>> {
    let should_rerank = opts.rerank.unwrap_or(SearchConfig::RERANK_ENABLED);
    let should_mmr = opts.mmr.unwrap_or_else(SearchConfig::mmr_enabled);
    let mmr_lambda = opts.mmr_lambda.unwrap_or(SearchConfig::MMR_LAMBDA);
    let limit = if opts.base.limit > 0 { opts.base.limit } else { 10 };

    // Fetch more candidates for reranking headroom
    let fetch_limit = if should_rerank {
        let multiplier = SearchConfig::rerank_top_k_multiplier();
        let candidate_count = opts.rerank_top_k.unwrap_or(limit * multiplier);
        candidate_count.max(limit + 5)
    } else {
        limit
    };

    let mut search_opts = opts.base.clone();
    search_opts.limit = fetch_limit;
    let mut results = hybrid_search(ctx, query, &search_opts)?;

    if results.is_empty() {
        return Ok(results);
    }

    // Step 1: Cross-encoder reranking
    if should_rerank && results.len() > 1 {
        if let Some(mm) = ctx.model_manager {
            match rerank_results(mm, query, &mut results) {
                Ok(()) => {}
                Err(e) => {
                    warn!("Cross-encoder reranking failed: {e}");
                }
            }
        }
    }

    // Step 2: MMR diversity
    if should_mmr && results.len() > 1 {
        match apply_mmr_diversity(ctx, &results, mmr_lambda, limit) {
            Ok(selected) => return Ok(selected),
            Err(e) => {
                warn!("MMR diversity failed: {e}");
            }
        }
    }

    results.truncate(limit);
    Ok(results)
}

// ============================================================================
// Private: Execute Search Paths
// ============================================================================

fn execute_search_paths(
    ctx: &SearchContext,
    prepared: &PreparedQuery,
    query_embedding: &Option<Vec<f32>>,
    opts: &SearchOptions,
    limit: usize,
) -> Result<HashMap<String, CombinedEntry>> {
    let mut combined: HashMap<String, CombinedEntry> = HashMap::new();

    // Path 1: Keyword search
    match paths::keyword_search(
        ctx.pool, &prepared.keyword_query, &opts.project_id, limit,
        opts.confidence_threshold, opts.use_fts5,
        prepared.effective_as_of.as_deref(),
        None, // sparse_tokens — SPLADE not available in Rust yet
        opts.agent_id.as_deref(),
    ) {
        Ok(kw_results) => {
            for r in kw_results {
                merge_entry(&mut combined, r.row, |e| {
                    e.keyword_score = e.keyword_score.max(r.keyword_score);
                });
            }
        }
        Err(e) => warn!("Keyword search path failed: {e}"),
    }

    // Path 2: Semantic search
    if let Some(emb) = &query_embedding {
        match paths::semantic_search(
            ctx.pool, emb, &opts.project_id, limit,
            opts.confidence_threshold, ctx.vector_store,
            prepared.effective_as_of.as_deref(), opts.agent_id.as_deref(),
        ) {
            Ok(sem_results) => {
                for r in sem_results {
                    merge_entry(&mut combined, r.row, |e| {
                        e.semantic_score = e.semantic_score.max(r.similarity);
                    });
                }
            }
            Err(e) => warn!("Semantic search path failed: {e}"),
        }
    }

    // Path 3: Temporal search
    match paths::temporal_search(
        ctx.pool, &prepared.effective_query, &opts.project_id, limit,
        opts.confidence_threshold,
        &TemporalSearchOptions {
            before: prepared.temporal_before.clone(),
            after: prepared.temporal_after.clone(),
            as_of: prepared.effective_as_of.clone(),
            agent_id: opts.agent_id.clone(),
        },
    ) {
        Ok(temp_results) => {
            for r in temp_results {
                merge_entry(&mut combined, r.row, |e| {
                    e.temporal_score = e.temporal_score.max(r.temporal_score);
                });
            }
        }
        Err(e) => warn!("Temporal search path failed: {e}"),
    }

    // Path 4: Graph search
    match paths::graph_search(
        ctx.pool, &prepared.effective_query,
        query_embedding.as_deref(),
        &opts.project_id, limit,
        opts.confidence_threshold, ctx.vector_store,
        prepared.effective_as_of.as_deref(), opts.agent_id.as_deref(),
    ) {
        Ok(graph_results) => {
            for r in graph_results {
                merge_entry(&mut combined, r.row, |e| {
                    e.graph_score = e.graph_score.max(r.graph_score);
                });
            }
        }
        Err(e) => warn!("Graph search path failed: {e}"),
    }

    // Path 5: Concept search
    match paths::concept_search(
        ctx.pool, &prepared.effective_query,
        query_embedding.as_deref(),
        &opts.project_id, limit,
        opts.confidence_threshold,
        prepared.effective_as_of.as_deref(), opts.agent_id.as_deref(),
    ) {
        Ok(concept_results) => {
            for r in concept_results {
                merge_entry(&mut combined, r.row, |e| {
                    e.concept_score = e.concept_score.max(r.concept_score);
                });
            }
        }
        Err(e) => warn!("Concept search path failed: {e}"),
    }

    // Path 6: Spreading activation
    // Uses seed IDs from keyword+semantic results
    let seed_ids: Vec<String> = {
        let mut seeds = Vec::new();
        let mut added = HashSet::new();
        for (id, entry) in combined.iter() {
            if entry.keyword_score > 0.0 || entry.semantic_score > 0.0 {
                if added.insert(id.clone()) {
                    seeds.push(id.clone());
                }
                if seeds.len() >= 6 {
                    break;
                }
            }
        }
        seeds
    };

    if !seed_ids.is_empty() {
        match paths::spreading_activation(
            ctx.pool, &seed_ids, &opts.project_id, limit,
            prepared.effective_as_of.as_deref(), opts.agent_id.as_deref(),
        ) {
            Ok(activated) => {
                for am in activated {
                    if combined.contains_key(&am.id) {
                        if let Some(entry) = combined.get_mut(&am.id) {
                            entry.spreading_score = entry.spreading_score.max(am.score);
                        }
                    } else {
                        // Fetch full row for activated memory
                        match fetch_memory_row(ctx.pool, &am.id) {
                            Ok(Some(row)) => {
                                merge_entry(&mut combined, row, |e| {
                                    e.spreading_score = am.score;
                                });
                            }
                            Ok(None) => {}
                            Err(e) => {
                                warn!("Spreading activation row fetch failed: {e}");
                            }
                        }
                    }
                }
            }
            Err(e) => warn!("Spreading activation path failed: {e}"),
        }
    }

    Ok(combined)
}

// ============================================================================
// Private: Rank and Enrich
// ============================================================================

fn rank_and_enrich(
    ctx: &SearchContext,
    combined: HashMap<String, CombinedEntry>,
    prepared: &PreparedQuery,
    opts: &SearchOptions,
    limit: usize,
) -> Result<Vec<MemorySummary>> {
    if combined.is_empty() {
        return Ok(Vec::new());
    }

    let now_fallback = chrono::Utc::now().to_rfc3339();
    let now = prepared
        .effective_as_of
        .as_deref()
        .unwrap_or(&now_fallback);

    // Filter expired entries
    let entries: Vec<CombinedEntry> = combined
        .into_values()
        .filter(|e| {
            if let Some(ref vt) = e.row.valid_to {
                if vt.as_str() < now {
                    return false;
                }
            }
            true
        })
        .collect();

    if entries.is_empty() {
        return Ok(Vec::new());
    }

    // Mark superseded entries for later penalty
    let superseded_ids: HashSet<String> = entries
        .iter()
        .filter(|e| e.row.superseded_by.is_some())
        .map(|e| e.row.id.clone())
        .collect();

    // Hebbian boost: spreading activation from co-retrieval edges
    let hebbian_boost_map = compute_hebbian_boost(ctx.pool, &entries, &opts.project_id);

    // RRF weights for this intent
    let weights = SearchConfig::rrf_weights(prepared.intent.intent.as_str());
    let rrf_k = HebbianConfig::RRF_K as f64;
    let n = entries.len();
    let missing_rank = n + 1;

    // Assign per-path ranks
    let kw_ranks = assign_ranks_for_path(&entries, |e| e.keyword_score, missing_rank);
    let sem_ranks = assign_ranks_for_path(&entries, |e| e.semantic_score, missing_rank);
    let temp_ranks = assign_ranks_for_path(&entries, |e| e.temporal_score, missing_rank);
    let graph_ranks = assign_ranks_for_path(&entries, |e| e.graph_score, missing_rank);
    let concept_ranks = assign_ranks_for_path(&entries, |e| e.concept_score, missing_rank);
    let spreading_ranks = assign_ranks_for_path(&entries, |e| e.spreading_score, missing_rank);

    // Compute final scores
    let mut scored: Vec<(CombinedEntry, f64)> = entries
        .into_iter()
        .map(|e| {
            let id = &e.row.id;
            let kw_rank = kw_ranks.get(id.as_str()).copied().unwrap_or(missing_rank);
            let sem_rank = sem_ranks.get(id.as_str()).copied().unwrap_or(missing_rank);
            let temp_rank = temp_ranks.get(id.as_str()).copied().unwrap_or(missing_rank);
            let g_rank = graph_ranks.get(id.as_str()).copied().unwrap_or(missing_rank);
            let c_rank = concept_ranks.get(id.as_str()).copied().unwrap_or(missing_rank);
            let s_rank = spreading_ranks.get(id.as_str()).copied().unwrap_or(missing_rank);

            // Weighted RRF across 6 paths
            let rrf = (weights[0] / (rrf_k + kw_rank as f64))
                + (weights[1] / (rrf_k + sem_rank as f64))
                + (weights[2] / (rrf_k + temp_rank as f64))
                + (weights[3] / (rrf_k + g_rank as f64))
                + (weights[4] / (rrf_k + c_rank as f64))
                + (weights[5] / (rrf_k + s_rank as f64));

            // Composite scoring with all signals
            let hebbian_boost = hebbian_boost_map.get(id.as_str()).copied().unwrap_or(0.0);
            let signals = ScoringSignals {
                rrf_score: rrf,
                rerank_score: None,
                recency_score: recency_score(
                    &e.row.created_at,
                    SearchConfig::TEMPORAL_DECAY_HALF_LIFE_DAYS,
                ),
                importance_score: e.row.importance.unwrap_or(0.5),
                confidence_score: e.row.confidence.unwrap_or(0.5),
                hebbian_boost,
                retention_score: 1.0, // Simplified: full retention in search results
                processing_depth_score: e.row.processing_depth,
                credibility_score: None,
            };

            let mut combined_score = compute_composite_score(
                &signals,
                prepared.intent.intent,
                ctx.session_context
                    .map(|s| s.get_empty_search_count())
                    .unwrap_or(0),
            );

            // Superseded penalty
            if superseded_ids.contains(id) {
                combined_score *= 0.5;
            }

            // Quality-weighted blend
            let quality_score = compute_quality_score(&e.row);
            combined_score = combined_score * (1.0 - QualityScoreConfig::SEARCH_BLEND)
                + quality_score * QualityScoreConfig::SEARCH_BLEND;

            (e, combined_score)
        })
        .collect();

    // Sort by combined score descending
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);

    // Record co-retrieval for Hebbian learning
    record_co_retrieval(ctx.pool, &scored, &opts.project_id);

    // Increment search_hit_count
    increment_search_hits(ctx.pool, &scored);

    // Format results
    let results: Vec<MemorySummary> = scored
        .into_iter()
        .map(|(e, score)| format_result(ctx.pool, e, score))
        .collect();

    Ok(results)
}

// ============================================================================
// Private: Reranking
// ============================================================================

fn rerank_results(
    model_manager: &ModelManager,
    query: &str,
    results: &mut Vec<MemorySummary>,
) -> Result<()> {
    let candidates: Vec<RerankCandidate> = results
        .iter()
        .enumerate()
        .map(|(i, r)| RerankCandidate {
            id: r.id.clone(),
            content: r.content.clone(),
            original_score: r.combined_score.unwrap_or(0.0),
            original_rank: i,
        })
        .collect();

    let reranked = reranker::rerank(model_manager, query, &candidates)?;

    if !reranked.is_empty() {
        // Build score map from reranked results
        let rerank_map: HashMap<String, (f64, f64)> = reranked
            .into_iter()
            .map(|r| (r.id.clone(), (r.rerank_score, r.blended_score)))
            .collect();

        // Update results with rerank scores
        for r in results.iter_mut() {
            if let Some((rerank_score, blended)) = rerank_map.get(&r.id) {
                r.rerank_score = Some(*rerank_score);
                r.combined_score = Some(*blended);
            }
        }

        // Re-sort by combined score
        results.sort_by(|a, b| {
            let sa = a.combined_score.unwrap_or(0.0);
            let sb = b.combined_score.unwrap_or(0.0);
            sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    Ok(())
}

// ============================================================================
// Private: MMR Diversity
// ============================================================================

fn apply_mmr_diversity(
    ctx: &SearchContext,
    results: &[MemorySummary],
    lambda: f64,
    limit: usize,
) -> Result<Vec<MemorySummary>> {
    // Fetch embeddings for MMR candidates
    let conn = ctx.pool.get()?;
    let ids: Vec<&str> = results.iter().map(|r| r.id.as_str()).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

    let sql = format!(
        "SELECT id, embedding FROM memories WHERE id IN ({placeholders}) AND embedding IS NOT NULL"
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for id in &ids {
        params.push(Box::new(id.to_string()));
    }
    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let emb_rows: Vec<(String, Vec<u8>)> = stmt
        .query_map(param_refs.as_slice(), |row| {
            let id: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let emb_map: HashMap<String, Vec<f32>> = emb_rows
        .into_iter()
        .filter_map(|(id, blob)| {
            if blob.len() % 4 != 0 {
                return None;
            }
            let floats: Vec<f32> = blob
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            Some((id, floats))
        })
        .collect();

    // Build MMR candidates
    let candidates: Vec<MmrCandidate> = results
        .iter()
        .map(|r| MmrCandidate {
            id: r.id.clone(),
            content: r.content.clone(),
            score: r.combined_score.unwrap_or(0.0),
            embedding: emb_map.get(&r.id).cloned(),
        })
        .collect();

    let selected_indices = scoring::apply_mmr(&candidates, lambda, limit);

    // Rebuild results in MMR order (indices map into candidates/results)
    let id_to_result: HashMap<&str, &MemorySummary> =
        results.iter().map(|r| (r.id.as_str(), r)).collect();
    let selected: Vec<MemorySummary> = selected_indices
        .iter()
        .filter_map(|&idx| candidates.get(idx))
        .filter_map(|c| id_to_result.get(c.id.as_str()).map(|r| (*r).clone()))
        .collect();

    Ok(selected)
}

// ============================================================================
// Private Helpers
// ============================================================================

/// Generate embedding for query (if model manager available).
fn generate_query_embedding(ctx: &SearchContext, query: &str) -> Option<Vec<f32>> {
    let mm = ctx.model_manager?;
    let model = mm
        .get_or_load(crate::models::manager::ModelId::ArcticEmbedS)
        .ok()?;
    crate::models::embedding::embed_text(&model, query).ok()
}

/// Merge a MemoryRow into the combined map, creating if absent.
fn merge_entry<F>(
    combined: &mut HashMap<String, CombinedEntry>,
    row: MemoryRow,
    update: F,
) where
    F: FnOnce(&mut CombinedEntry),
{
    let entry = combined
        .entry(row.id.clone())
        .or_insert_with(|| CombinedEntry::new(row));
    update(entry);
}

/// Fetch a single MemoryRow by ID.
fn fetch_memory_row(pool: &DbPool, id: &str) -> Result<Option<MemoryRow>> {
    let conn = pool.get()?;
    let result = conn
        .prepare("SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL")?
        .query_row([id], |row| paths::row_to_memory(row))
        .ok();
    Ok(result)
}

/// Assign ranks for a single path's scores.
fn assign_ranks_for_path<F>(
    entries: &[CombinedEntry],
    score_fn: F,
    missing_rank: usize,
) -> HashMap<String, usize>
where
    F: Fn(&CombinedEntry) -> f64,
{
    let mut indexed: Vec<(&str, f64)> = entries
        .iter()
        .map(|e| (e.row.id.as_str(), score_fn(e)))
        .collect();
    indexed.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut ranks = HashMap::new();
    for (i, (id, score)) in indexed.iter().enumerate() {
        ranks.insert((*id).to_string(), if *score > 0.0 { i + 1 } else { missing_rank });
    }
    ranks
}

/// Compute Hebbian boost for entries from co-retrieval edges.
fn compute_hebbian_boost(
    pool: &DbPool,
    entries: &[CombinedEntry],
    project_id: &str,
) -> HashMap<String, f64> {
    let mut boost_map = HashMap::new();

    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return boost_map,
    };

    let entry_ids: HashSet<&str> = entries.iter().map(|e| e.row.id.as_str()).collect();

    for entry in entries {
        let neighbors = match paths::get_hebbian_neighbors(
            &conn, &entry.row.id, project_id, 0.05,
            HebbianConfig::MAX_NEIGHBORS,
        ) {
            Ok(n) => n,
            Err(_) => continue,
        };

        let activation_boost: f64 = neighbors
            .iter()
            .filter(|(nid, _)| entry_ids.contains(nid.as_str()))
            .map(|(_, w)| w)
            .sum();

        boost_map.insert(
            entry.row.id.clone(),
            (activation_boost * 0.2).min(0.5),
        );
    }

    boost_map
}

/// Simple quality score for a MemoryRow.
fn compute_quality_score(row: &MemoryRow) -> f64 {
    row.quality_score.unwrap_or_else(|| {
        // Fallback: compute from available signals
        let has_tags = row.tags.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
        let has_type = !row.memory_type.is_empty();
        let content_len = row.content.len();
        let length_score = if content_len > 20 { 0.5 } else { 0.2 };
        let tag_score = if has_tags { 0.3 } else { 0.0 };
        let type_score = if has_type { 0.2 } else { 0.0 };
        length_score + tag_score + type_score
    })
}

/// Record co-retrieval for Hebbian learning.
fn record_co_retrieval(pool: &DbPool, results: &[(CombinedEntry, f64)], project_id: &str) {
    let top_k = HebbianConfig::TOP_K_RECORD;
    let top_ids: Vec<&str> = results
        .iter()
        .take(top_k)
        .map(|(e, _)| e.row.id.as_str())
        .collect();

    if top_ids.len() < 2 {
        return;
    }

    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return,
    };

    // Record co-retrieval pairs
    for i in 0..top_ids.len() {
        for j in (i + 1)..top_ids.len() {
            let (a, b) = if top_ids[i] < top_ids[j] {
                (top_ids[i], top_ids[j])
            } else {
                (top_ids[j], top_ids[i])
            };

            let lr = HebbianConfig::LEARNING_RATE;
            if let Err(e) = conn.execute(
                "INSERT INTO co_retrieval_edges (memory_a, memory_b, weight, project_id, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, datetime('now')) \
                 ON CONFLICT(memory_a, memory_b, project_id) DO UPDATE SET \
                 weight = MIN(weight + ?3, 1.0), \
                 co_retrieval_count = co_retrieval_count + 1, \
                 updated_at = datetime('now')",
                rusqlite::params![a, b, lr, project_id],
            ) {
                debug!("Co-retrieval recording failed: {e}");
            }
        }
    }
}

/// Increment search_hit_count for returned results.
fn increment_search_hits(pool: &DbPool, results: &[(CombinedEntry, f64)]) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return,
    };

    for (e, _) in results {
        let _ = conn.execute(
            "UPDATE memories SET search_hit_count = search_hit_count + 1 WHERE id = ?",
            [&e.row.id],
        );
    }
}

/// Format a CombinedEntry into a MemorySummary.
fn format_result(
    pool: &DbPool,
    entry: CombinedEntry,
    score: f64,
) -> MemorySummary {
    let tags: Vec<String> = entry
        .row
        .tags
        .as_deref()
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_default();

    // Attach concept memberships
    let concepts = get_concepts_for_result(pool, &entry.row.id);

    MemorySummary {
        id: entry.row.id,
        project_id: entry.row.project_id,
        content: entry.row.content,
        content_truncated: false,
        memory_type: entry.row.memory_type,
        tags,
        importance: entry.row.importance.unwrap_or(0.5),
        confidence: entry.row.confidence.unwrap_or(0.5),
        agent_id: entry.row.agent_id,
        deleted: None,
        combined_score: Some(score),
        rerank_score: None,
        valid_from: entry.row.valid_from,
        valid_to: entry.row.valid_to,
        superseded_by: entry.row.superseded_by,
        concepts,
    }
}

/// Get concept memberships for a result.
fn get_concepts_for_result(
    pool: &DbPool,
    memory_id: &str,
) -> Option<Vec<crate::types::api::ConceptMembership>> {
    let conn = pool.get().ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT cn.name, cm.probability \
             FROM concept_memberships cm \
             LEFT JOIN concept_nodes cn ON cn.id = cm.concept_id \
             WHERE cm.memory_id = ?",
        )
        .ok()?;

    let memberships: Vec<crate::types::api::ConceptMembership> = stmt
        .query_map([memory_id], |row| {
            Ok(crate::types::api::ConceptMembership {
                name: row.get(0)?,
                probability: row.get(1)?,
            })
        })
        .ok()?
        .filter_map(|r| r.ok())
        .collect();

    if memberships.is_empty() {
        None
    } else {
        Some(memberships)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_combined_entry_new() {
        let row = MemoryRow {
            id: "test-1".into(),
            project_id: "test".into(),
            content: "hello".into(),
            memory_type: "fact".into(),
            tags: None,
            importance: Some(0.5),
            confidence: Some(0.8),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: None,
            last_accessed: None,
            access_count: 0,
            strength: Some(1.0),
            deleted_at: None,
            embedding: None,
            valid_from: None,
            valid_to: None,
            superseded_by: None,
            agent_id: None,
            tier: None,
            processing_depth: None,
            source_uri: None,
            content_hash: None,
            source_count: 1,
            contradiction_count: 0,
            confirmation_count: 0,
            search_hit_count: 0,
            quality_score: None,
        };
        let entry = CombinedEntry::new(row);
        assert_eq!(entry.keyword_score, 0.0);
        assert_eq!(entry.semantic_score, 0.0);
    }

    #[test]
    fn test_assign_ranks_for_path() {
        let entries = vec![
            make_entry("a", 0.9),
            make_entry("b", 0.5),
            make_entry("c", 0.0),
        ];
        let ranks = assign_ranks_for_path(&entries, |e| e.keyword_score, 4);
        assert_eq!(ranks.get("a"), Some(&1));
        assert_eq!(ranks.get("b"), Some(&2));
        assert_eq!(ranks.get("c"), Some(&4)); // missing_rank
    }

    fn make_entry(id: &str, kw_score: f64) -> CombinedEntry {
        let mut e = CombinedEntry::new(MemoryRow {
            id: id.into(),
            project_id: "test".into(),
            content: "test".into(),
            memory_type: String::new(),
            tags: None,
            importance: Some(0.5),
            confidence: Some(0.5),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: None,
            last_accessed: None,
            access_count: 0,
            strength: Some(1.0),
            deleted_at: None,
            embedding: None,
            valid_from: None,
            valid_to: None,
            superseded_by: None,
            agent_id: None,
            tier: None,
            processing_depth: None,
            source_uri: None,
            content_hash: None,
            source_count: 1,
            contradiction_count: 0,
            confirmation_count: 0,
            search_hit_count: 0,
            quality_score: None,
        });
        e.keyword_score = kw_score;
        e
    }

    #[test]
    fn test_compute_quality_score_defaults() {
        let row = MemoryRow {
            id: "x".into(),
            project_id: "p".into(),
            content: "short".into(),
            memory_type: String::new(),
            tags: None,
            importance: None,
            confidence: None,
            created_at: String::new(),
            updated_at: None,
            last_accessed: None,
            access_count: 0,
            strength: None,
            deleted_at: None,
            embedding: None,
            valid_from: None,
            valid_to: None,
            superseded_by: None,
            agent_id: None,
            tier: None,
            processing_depth: None,
            source_uri: None,
            content_hash: None,
            source_count: 1,
            contradiction_count: 0,
            confirmation_count: 0,
            search_hit_count: 0,
            quality_score: None,
        };
        let score = compute_quality_score(&row);
        assert!(score >= 0.0 && score <= 1.0);
    }
}
