//! Search domain dispatch — search, list, recall, suggest, answer operations.

use anyhow::{bail, Context, Result};
use rusqlite::params;
use serde_json::{json, Value};
use tracing::{debug, warn};

use crate::infra::server_context::ServerContext;
use crate::search::engine::{SearchContext, SearchOptions, hybrid_search};

/// Handle `memory_search` tool call.
pub async fn handle_search(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let mode = args["mode"].as_str().unwrap_or("search");
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);
    let limit = args["limit"].as_u64().unwrap_or(10) as usize;
    let confidence_threshold = args["confidenceThreshold"].as_f64().unwrap_or(0.0);
    let include_deleted = args["includeDeleted"].as_bool().unwrap_or(false);
    let as_of = args["as_of"].as_str().map(String::from);
    let agent_id = args["agent_id"].as_str().map(String::from);

    match mode {
        "search" => {
            let query = args["query"]
                .as_str()
                .context("search mode requires 'query'")?;
            handle_search_mode(ctx, project_id, query, limit, confidence_threshold, include_deleted, as_of, agent_id).await
        }
        "list" => {
            handle_list_mode(ctx, project_id, limit, include_deleted).await
        }
        "recall" => {
            let id = args["id"]
                .as_str()
                .context("recall mode requires 'id'")?;
            handle_recall_mode(ctx, project_id, id).await
        }
        "suggest" => {
            let context_text = args["context"]
                .as_str()
                .or_else(|| args["query"].as_str())
                .context("suggest mode requires 'context' or 'query'")?;
            handle_search_mode(ctx, project_id, context_text, limit, confidence_threshold, include_deleted, as_of, agent_id).await
        }
        _ => bail!("Unknown search mode: {mode}"),
    }
}

async fn handle_search_mode(
    ctx: &ServerContext,
    project_id: &str,
    query: &str,
    limit: usize,
    confidence_threshold: f64,
    _include_deleted: bool,
    as_of: Option<String>,
    agent_id: Option<String>,
) -> Result<Value> {
    // Use the 6-path hybrid search engine
    let search_ctx = SearchContext {
        pool: &ctx.pool,
        model_manager: Some(&ctx.model_manager),
        vector_store: None, // sqlite-vec store created on demand inside paths
        session_context: Some(&ctx.session_context),
    };
    let opts = SearchOptions {
        project_id: project_id.to_string(),
        limit,
        confidence_threshold,
        use_fts5: true,
        as_of,
        agent_id,
    };

    match hybrid_search(&search_ctx, query, &opts) {
        Ok(summaries) => {
            // Convert MemorySummary vec to JSON
            let results: Vec<Value> = summaries.iter().map(|s| {
                let mut v = json!({
                    "id": s.id,
                    "content": s.content,
                    "content_truncated": s.content_truncated,
                    "type": s.memory_type,
                    "tags": s.tags,
                    "importance": s.importance,
                    "confidence": s.confidence,
                });
                if let Some(ref aid) = s.agent_id {
                    v["agent_id"] = json!(aid);
                }
                if let Some(ref vf) = s.valid_from {
                    v["valid_from"] = json!(vf);
                }
                if let Some(ref vt) = s.valid_to {
                    v["valid_to"] = json!(vt);
                }
                if let Some(cs) = s.combined_score {
                    v["combinedScore"] = json!(cs);
                }
                if let Some(rs) = s.rerank_score {
                    v["rerankScore"] = json!(rs);
                }
                v
            }).collect();

            debug!("Hybrid search returned {} results for '{query}'", results.len());

            Ok(json!({
                "memories": results,
                "total": results.len(),
                "query": query,
                "mode": "search",
                "engine": "hybrid"
            }))
        }
        Err(e) => {
            // Fallback to raw SQL if hybrid search fails (e.g., no models loaded)
            warn!("Hybrid search failed, falling back to SQL: {e}");
            handle_search_mode_fallback(ctx, project_id, query, limit, confidence_threshold).await
        }
    }
}

/// SQL-only fallback when hybrid search is unavailable.
async fn handle_search_mode_fallback(
    ctx: &ServerContext,
    project_id: &str,
    query: &str,
    limit: usize,
    confidence_threshold: f64,
) -> Result<Value> {
    let conn = ctx.pool.get().context("search fallback: pool")?;
    let has_conf_filter = confidence_threshold > 0.0;

    // Try FTS5 first
    let conf_clause = if has_conf_filter {
        " AND COALESCE(m.confidence, 0.5) >= ?4"
    } else {
        ""
    };
    let fts_sql = format!(
        "SELECT m.id, m.content, m.type, m.tags, m.importance, m.confidence, m.created_at, m.agent_id, m.valid_from, m.valid_to
         FROM memories m
         JOIN memories_fts f ON m.id = f.rowid
         WHERE f.memories_fts MATCH ?1
           AND m.project_id = ?2
           AND m.deleted_at IS NULL{conf_clause}
         ORDER BY rank
         LIMIT ?3"
    );

    let results = match conn.prepare(&fts_sql) {
        Ok(mut stmt) => {
            let mut results = Vec::new();
            if has_conf_filter {
                let rows = stmt.query_map(params![query, project_id, limit as i64, confidence_threshold], |row| {
                    memory_row_to_json(row)
                })?;
                for row in rows { results.push(row?); }
            } else {
                let rows = stmt.query_map(params![query, project_id, limit as i64], |row| {
                    memory_row_to_json(row)
                })?;
                for row in rows { results.push(row?); }
            }
            results
        }
        Err(_) => {
            // LIKE fallback
            let like_query = format!("%{query}%");
            let conf_clause_like = if has_conf_filter {
                " AND COALESCE(confidence, 0.5) >= ?4"
            } else {
                ""
            };
            let like_sql = format!(
                "SELECT id, content, type, tags, importance, confidence, created_at, agent_id, valid_from, valid_to
                 FROM memories
                 WHERE project_id = ?1
                   AND content LIKE ?2
                   AND deleted_at IS NULL{conf_clause_like}
                 ORDER BY created_at DESC
                 LIMIT ?3"
            );
            let mut stmt = conn.prepare(&like_sql)?;
            let mut results = Vec::new();
            if has_conf_filter {
                let rows = stmt.query_map(params![project_id, like_query, limit as i64, confidence_threshold], |row| {
                    memory_row_to_json(row)
                })?;
                for row in rows { results.push(row?); }
            } else {
                let rows = stmt.query_map(params![project_id, like_query, limit as i64], |row| {
                    memory_row_to_json(row)
                })?;
                for row in rows { results.push(row?); }
            }
            results
        }
    };

    debug!("Fallback search returned {} results for '{query}'", results.len());

    Ok(json!({
        "memories": results,
        "total": results.len(),
        "query": query,
        "mode": "search",
        "engine": "fallback"
    }))
}

async fn handle_list_mode(
    ctx: &ServerContext,
    project_id: &str,
    limit: usize,
    include_deleted: bool,
) -> Result<Value> {
    let conn = ctx.pool.get().context("list: pool")?;
    let delete_filter = if include_deleted { "" } else { "AND deleted_at IS NULL" };

    let sql = format!(
        "SELECT id, content, type, tags, importance, confidence, created_at, agent_id, valid_from, valid_to
         FROM memories
         WHERE project_id = ?1 {delete_filter}
         ORDER BY created_at DESC
         LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![project_id, limit as i64], |row| {
        memory_row_to_json(row)
    })?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }

    Ok(json!({
        "memories": results,
        "total": results.len(),
        "mode": "list"
    }))
}

async fn handle_recall_mode(
    ctx: &ServerContext,
    project_id: &str,
    id: &str,
) -> Result<Value> {
    let conn = ctx.pool.get().context("recall: pool")?;

    // Update access count and last_accessed
    conn.execute(
        "UPDATE memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?1 AND project_id = ?2",
        params![id, project_id],
    )?;

    let result = conn.query_row(
        "SELECT id, content, type, tags, importance, confidence, strength, access_count, created_at, last_accessed, agent_id
         FROM memories
         WHERE id = ?1 AND project_id = ?2",
        params![id, project_id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "content": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "tags": row.get::<_, Option<String>>(3)?,
                "importance": row.get::<_, f64>(4)?,
                "confidence": row.get::<_, f64>(5)?,
                "strength": row.get::<_, f64>(6)?,
                "access_count": row.get::<_, i64>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "last_accessed": row.get::<_, Option<String>>(9)?,
                "agent_id": row.get::<_, Option<String>>(10)?,
                "contradictions": []
            }))
        },
    ).context("recall: memory not found")?;

    Ok(result)
}

/// Handle `memory_answer` tool call.
pub async fn handle_answer(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let question = args["question"]
        .as_str()
        .context("memory_answer: missing 'question'")?;
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    // Search for relevant memories
    let search_args = json!({
        "mode": "search",
        "query": question,
        "project_id": project_id,
        "limit": 5,
        "confidenceThreshold": args.get("confidenceThreshold").cloned().unwrap_or(json!(0))
    });

    let search_result = handle_search(ctx, &search_args).await?;
    let memories = search_result["memories"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    if memories.is_empty() {
        return Ok(json!({
            "answer": null,
            "confidence": 0.0,
            "sources": [],
            "message": "No relevant memories found to answer this question."
        }));
    }

    // Build context from top results
    let sources: Vec<Value> = memories.iter().map(|m| {
        json!({
            "id": m["id"],
            "content": m["content"],
            "confidence": m["confidence"]
        })
    }).collect();

    // Simple extractive answer: return the top memory's content
    let top_content = memories[0]["content"].as_str().unwrap_or("");
    let top_confidence = memories[0]["confidence"].as_f64().unwrap_or(0.5);

    Ok(json!({
        "answer": top_content,
        "confidence": top_confidence,
        "sources": sources,
        "method": "extractive"
    }))
}

/// Convert a rusqlite Row to a JSON Value for search/list results.
fn memory_row_to_json(row: &rusqlite::Row<'_>) -> Result<Value, rusqlite::Error> {
    let content: String = row.get(1)?;
    let truncated = content.len() > 500;
    let display = if truncated { &content[..500] } else { &content };

    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "content": display,
        "content_truncated": truncated,
        "type": row.get::<_, String>(2)?,
        "tags": row.get::<_, Option<String>>(3)?,
        "importance": row.get::<_, f64>(4)?,
        "confidence": row.get::<_, f64>(5)?,
        "created_at": row.get::<_, String>(6)?,
        "agent_id": row.get::<_, Option<String>>(7)?,
        "valid_from": row.get::<_, Option<String>>(8)?,
        "valid_to": row.get::<_, Option<String>>(9)?
    }))
}
