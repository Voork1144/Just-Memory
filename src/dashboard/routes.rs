//! Dashboard REST API routes.
//!
//! Provides endpoints for the web dashboard to query memory state,
//! stats, health, and search results.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use serde_json::{json, Value};
use rusqlite::params;

use crate::infra::server_context::ServerContext;

type AppState = Arc<ServerContext>;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/stats", get(stats))
        .route("/api/memories", get(list_memories))
        .route("/api/search", get(search_memories))
}

async fn health(State(ctx): State<AppState>) -> Json<Value> {
    let conn = match ctx.pool.get() {
        Ok(c) => c,
        Err(e) => return Json(json!({ "status": "error", "message": e.to_string() })),
    };

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
        .unwrap_or(0);

    Json(json!({
        "status": "healthy",
        "version": env!("CARGO_PKG_VERSION"),
        "memory_count": count
    }))
}

#[derive(Deserialize)]
struct StatsQuery {
    project_id: Option<String>,
}

async fn stats(
    State(ctx): State<AppState>,
    Query(q): Query<StatsQuery>,
) -> Result<Json<Value>, StatusCode> {
    let project_id = q.project_id.as_deref().unwrap_or(&ctx.project_id);
    let conn = ctx.pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memories WHERE project_id = ?1 AND deleted_at IS NULL",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "project_id": project_id,
        "memory_count": count
    })))
}

#[derive(Deserialize)]
struct ListQuery {
    project_id: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
}

async fn list_memories(
    State(ctx): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, StatusCode> {
    let project_id = q.project_id.as_deref().unwrap_or(&ctx.project_id);
    let limit = q.limit.unwrap_or(50).min(200) as i64;
    let offset = q.offset.unwrap_or(0) as i64;
    let conn = ctx.pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, content, type, tags, importance, confidence, created_at
             FROM memories
             WHERE project_id = ?1 AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let rows = stmt
        .query_map(params![project_id, limit, offset], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "content": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "tags": row.get::<_, Option<String>>(3)?,
                "importance": row.get::<_, f64>(4)?,
                "confidence": row.get::<_, f64>(5)?,
                "created_at": row.get::<_, String>(6)?
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut memories = Vec::new();
    for row in rows {
        memories.push(row.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?);
    }

    Ok(Json(json!({
        "memories": memories,
        "total": memories.len(),
        "limit": limit,
        "offset": offset
    })))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    project_id: Option<String>,
    limit: Option<usize>,
}

async fn search_memories(
    State(ctx): State<AppState>,
    Query(sq): Query<SearchQuery>,
) -> Result<Json<Value>, StatusCode> {
    let project_id = sq.project_id.as_deref().unwrap_or(&ctx.project_id);
    let limit = sq.limit.unwrap_or(20).min(100) as i64;
    let conn = ctx.pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let like_query = format!("%{}%", sq.q);
    let mut stmt = conn
        .prepare(
            "SELECT id, content, type, importance, confidence, created_at
             FROM memories
             WHERE project_id = ?1 AND deleted_at IS NULL AND content LIKE ?2
             ORDER BY created_at DESC
             LIMIT ?3",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let rows = stmt
        .query_map(params![project_id, like_query, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "content": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "importance": row.get::<_, f64>(3)?,
                "confidence": row.get::<_, f64>(4)?,
                "created_at": row.get::<_, String>(5)?
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?);
    }

    Ok(Json(json!({
        "query": sq.q,
        "results": results,
        "total": results.len()
    })))
}
