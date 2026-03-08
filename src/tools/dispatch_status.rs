//! Status dispatch — briefing, task, stats, health, reflect, insights, timeline, optimize, config.

use anyhow::{bail, Context, Result};
use rusqlite::params;
use serde_json::{json, Value};

use crate::infra::server_context::ServerContext;

/// Handle `memory_status` tool call.
pub async fn handle_status(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let action = args["action"].as_str().unwrap_or("briefing");
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    match action {
        "briefing" => handle_briefing(ctx, args, project_id).await,
        "task" => handle_task(ctx, args, project_id).await,
        "stats" => handle_stats(ctx, project_id).await,
        "project" => handle_project(ctx, args, project_id).await,
        "health" => handle_health(ctx, project_id).await,
        "reflect" => handle_reflect(ctx, project_id).await,
        "insights" => handle_insights(ctx, project_id).await,
        "timeline" => handle_timeline(ctx, project_id).await,
        "optimize" => handle_optimize(ctx, project_id).await,
        "config" => handle_config(ctx, args).await,
        _ => bail!("Unknown status action: {action}"),
    }
}

async fn handle_briefing(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let max_tokens = args["maxTokens"].as_u64().unwrap_or(500);
    let conn = ctx.pool.get().context("briefing: pool")?;

    let memory_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE project_id = ?1 AND deleted_at IS NULL",
        params![project_id],
        |row| row.get(0),
    )?;

    let recent_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE project_id = ?1 AND deleted_at IS NULL AND created_at > datetime('now', '-24 hours')",
        params![project_id],
        |row| row.get(0),
    )?;

    // Scale recent memory count and content truncation by max_tokens budget.
    // ~4 chars per token. Reserve ~40% for structure/metadata, 60% for content.
    let content_budget = (max_tokens as usize * 4 * 60) / 100;
    let max_recent = (content_budget / 120).clamp(1, 10) as i64; // ~120 chars per entry
    let content_limit = (content_budget / max_recent as usize).clamp(50, 500);

    // Get recent memories for context
    let mut stmt = conn.prepare(
        "SELECT id, content, type, importance FROM memories
         WHERE project_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT ?2",
    )?;
    let recent: Vec<Value> = stmt
        .query_map(params![project_id, max_recent], |row| {
            let content: String = row.get(1)?;
            let truncated = content.len() > content_limit;
            let display = if truncated { &content[..content_limit] } else { &content };
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "content": display,
                "type": row.get::<_, String>(2)?,
                "importance": row.get::<_, f64>(3)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Get in-progress task
    let task: Option<Value> = conn
        .query_row(
            "SELECT description, current_step, total_steps FROM tasks WHERE project_id = ?1 AND status = 'in_progress' LIMIT 1",
            params![project_id],
            |row| {
                Ok(json!({
                    "description": row.get::<_, String>(0)?,
                    "current_step": row.get::<_, Option<i64>>(1)?,
                    "total_steps": row.get::<_, Option<i64>>(2)?
                }))
            },
        )
        .ok();

    Ok(json!({
        "project_id": project_id,
        "memory_count": memory_count,
        "recent_24h": recent_count,
        "recent_memories": recent,
        "in_progress_task": task,
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn handle_task(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let task_action = args["task_action"]
        .as_str()
        .context("task: missing 'task_action'")?;

    let conn = ctx.pool.get().context("task: pool")?;

    match task_action {
        "set" => {
            let description = args["description"]
                .as_str()
                .context("task set: missing 'description'")?;
            let total_steps = args["total_steps"].as_i64();

            // Clear any existing in-progress task
            conn.execute(
                "UPDATE tasks SET status = 'cancelled' WHERE project_id = ?1 AND status = 'in_progress'",
                params![project_id],
            )?;

            conn.execute(
                "INSERT INTO tasks (id, project_id, description, total_steps, status)
                 VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, 'in_progress')",
                params![project_id, description, total_steps],
            )?;

            Ok(json!({ "task_action": "set", "description": description, "status": "in_progress" }))
        }
        "update" => {
            let step = args["step"].as_i64().context("task update: missing 'step'")?;
            let step_desc = args["step_description"].as_str();

            conn.execute(
                "UPDATE tasks SET current_step = ?1, step_description = ?2
                 WHERE project_id = ?3 AND status = 'in_progress'",
                params![step, step_desc, project_id],
            )?;

            Ok(json!({ "task_action": "update", "step": step, "step_description": step_desc }))
        }
        "clear" => {
            conn.execute(
                "UPDATE tasks SET status = 'completed' WHERE project_id = ?1 AND status = 'in_progress'",
                params![project_id],
            )?;
            Ok(json!({ "task_action": "clear", "status": "completed" }))
        }
        "get" => {
            let task: Option<Value> = conn
                .query_row(
                    "SELECT description, current_step, total_steps, step_description, status
                     FROM tasks WHERE project_id = ?1 AND status = 'in_progress' LIMIT 1",
                    params![project_id],
                    |row| {
                        Ok(json!({
                            "description": row.get::<_, String>(0)?,
                            "current_step": row.get::<_, Option<i64>>(1)?,
                            "total_steps": row.get::<_, Option<i64>>(2)?,
                            "step_description": row.get::<_, Option<String>>(3)?,
                            "status": row.get::<_, String>(4)?
                        }))
                    },
                )
                .ok();
            Ok(json!({ "task_action": "get", "task": task }))
        }
        _ => bail!("Unknown task_action: {task_action}"),
    }
}

async fn handle_stats(ctx: &ServerContext, project_id: &str) -> Result<Value> {
    let conn = ctx.pool.get().context("stats: pool")?;

    let memory_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE project_id = ?1 AND deleted_at IS NULL",
        params![project_id],
        |row| row.get(0),
    )?;

    let deleted_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE project_id = ?1 AND deleted_at IS NOT NULL",
        params![project_id],
        |row| row.get(0),
    )?;

    // Type distribution
    let mut stmt = conn.prepare(
        "SELECT type, COUNT(*) FROM memories WHERE project_id = ?1 AND deleted_at IS NULL GROUP BY type",
    )?;
    let type_rows = stmt.query_map(params![project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut by_type = json!({});
    for row in type_rows {
        let (t, c) = row?;
        by_type[t] = json!(c);
    }

    // Tool call stats
    let tool_calls: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tool_calls WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok(json!({
        "project_id": project_id,
        "memory_count": memory_count,
        "deleted_count": deleted_count,
        "by_type": by_type,
        "tool_calls": tool_calls
    }))
}

async fn handle_project(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let project_action = args["project_action"].as_str().unwrap_or("list");

    match project_action {
        "list" => {
            let conn = ctx.pool.get().context("project list: pool")?;
            let mut stmt = conn.prepare(
                "SELECT project_id, COUNT(*) as memory_count
                 FROM memories
                 WHERE deleted_at IS NULL
                 GROUP BY project_id
                 ORDER BY memory_count DESC"
            )?;
            let projects: Vec<Value> = stmt
                .query_map([], |row| {
                    Ok(json!({
                        "project_id": row.get::<_, String>(0)?,
                        "memory_count": row.get::<_, i64>(1)?
                    }))
                })?
                .filter_map(|r| r.ok())
                .collect();

            Ok(json!({
                "project_action": "list",
                "current_project": project_id,
                "projects": projects
            }))
        }
        "set" => {
            let path = args["path"].as_str();
            Ok(json!({
                "project_action": "set",
                "project_id": project_id,
                "path": path
            }))
        }
        _ => bail!("Unknown project_action: {project_action}"),
    }
}

async fn handle_health(ctx: &ServerContext, project_id: &str) -> Result<Value> {
    let conn = ctx.pool.get().context("health: pool")?;

    let memory_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;

    // Check database integrity
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;

    // WAL mode check
    let journal_mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;

    // DB size
    let page_count: i64 = conn.query_row("PRAGMA page_count", [], |row| row.get(0))?;
    let page_size: i64 = conn.query_row("PRAGMA page_size", [], |row| row.get(0))?;
    let db_size_mb = (page_count * page_size) as f64 / (1024.0 * 1024.0);

    Ok(json!({
        "status": if integrity == "ok" { "healthy" } else { "degraded" },
        "memory_count": memory_count,
        "integrity": integrity,
        "journal_mode": journal_mode,
        "db_size_mb": format!("{db_size_mb:.2}"),
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn handle_reflect(ctx: &ServerContext, project_id: &str) -> Result<Value> {
    let conn = ctx.pool.get().context("reflect: pool")?;

    // Basic reflection stats
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE project_id = ?1 AND deleted_at IS NULL",
        params![project_id],
        |row| row.get(0),
    )?;

    let avg_importance: f64 = conn.query_row(
        "SELECT COALESCE(AVG(importance), 0) FROM memories WHERE project_id = ?1 AND deleted_at IS NULL",
        params![project_id],
        |row| row.get(0),
    )?;

    let avg_confidence: f64 = conn.query_row(
        "SELECT COALESCE(AVG(confidence), 0.5) FROM memories WHERE project_id = ?1 AND deleted_at IS NULL",
        params![project_id],
        |row| row.get(0),
    )?;

    Ok(json!({
        "total_memories": total,
        "avg_importance": format!("{avg_importance:.3}"),
        "avg_confidence": format!("{avg_confidence:.3}")
    }))
}

async fn handle_insights(ctx: &ServerContext, project_id: &str) -> Result<Value> {
    let conn = ctx.pool.get().context("insights: pool")?;

    // High-value memories
    let mut stmt = conn.prepare(
        "SELECT id, content, importance FROM memories
         WHERE project_id = ?1 AND deleted_at IS NULL
         ORDER BY importance DESC LIMIT 5",
    )?;
    let high_value: Vec<Value> = stmt
        .query_map(params![project_id], |row| {
            let content: String = row.get(1)?;
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "content": if content.len() > 100 { &content[..100] } else { &content },
                "importance": row.get::<_, f64>(2)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(json!({
        "high_value_memories": high_value,
        "project_id": project_id
    }))
}

async fn handle_timeline(ctx: &ServerContext, project_id: &str) -> Result<Value> {
    let conn = ctx.pool.get().context("timeline: pool")?;

    let mut stmt = conn.prepare(
        "SELECT DATE(created_at) as day, COUNT(*) as count
         FROM memories
         WHERE project_id = ?1 AND deleted_at IS NULL
         GROUP BY day ORDER BY day DESC LIMIT 30",
    )?;
    let days: Vec<Value> = stmt
        .query_map(params![project_id], |row| {
            Ok(json!({
                "date": row.get::<_, String>(0)?,
                "count": row.get::<_, i64>(1)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(json!({ "timeline": days, "project_id": project_id }))
}

async fn handle_optimize(ctx: &ServerContext, project_id: &str) -> Result<Value> {
    let conn = ctx.pool.get().context("optimize: pool")?;

    // Run ANALYZE for query planner
    conn.execute_batch("ANALYZE")?;

    // WAL checkpoint
    let (busy, log, checkpointed): (i64, i64, i64) = conn.query_row(
        "PRAGMA wal_checkpoint(PASSIVE)", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    )?;

    Ok(json!({
        "analyzed": true,
        "wal_checkpoint": {
            "busy": busy,
            "log_frames": log,
            "checkpointed_frames": checkpointed
        },
        "project_id": project_id
    }))
}

async fn handle_config(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let mut updated = false;

    if let Some(escape_hatches) = args["escape_hatches"].as_bool() {
        ctx.set_escape_hatches(escape_hatches);
        updated = true;
    }

    Ok(json!({
        "config_updated": updated,
        "escape_hatches": ctx.escape_hatches()
    }))
}
