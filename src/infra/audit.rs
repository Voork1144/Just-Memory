//! Audit log — structured tool-call recording.
//!
//! Every MCP tool invocation is logged with args, outcome, duration, and project.

use anyhow::{Context, Result};
use rusqlite::params;
use tracing::debug;

use crate::db::pool::DbPool;

/// Record a single tool call in the audit log.
pub fn record_tool_call(
    pool: &DbPool,
    tool: &str,
    args_json: &str,
    output_preview: Option<&str>,
    success: bool,
    error: Option<&str>,
    duration_ms: i64,
    project_id: &str,
) -> Result<()> {
    let conn = pool.get().context("audit: pool connection")?;
    conn.execute(
        "INSERT INTO tool_calls (id, tool, args, output_preview, success, error, duration_ms, project_id)
         VALUES (lower(hex(randomblob(16))), ?1, json(?2), ?3, ?4, ?5, ?6, ?7)",
        params![tool, args_json, output_preview, success, error, duration_ms, project_id],
    )
    .context("audit: insert tool_call")?;
    debug!("Audit: {tool} success={success} {duration_ms}ms");
    Ok(())
}

/// Prune old audit entries beyond `keep_days`.
pub fn prune_audit_log(pool: &DbPool, keep_days: i64) -> Result<usize> {
    let conn = pool.get().context("audit: pool connection")?;
    let deleted = conn.execute(
        "DELETE FROM tool_calls WHERE created_at < datetime('now', ?1)",
        params![format!("-{keep_days} days")],
    )
    .context("audit: prune")?;
    debug!("Audit: pruned {deleted} entries older than {keep_days} days");
    Ok(deleted)
}

/// Get recent tool calls for a project (most recent first).
pub fn get_recent_tool_calls(
    pool: &DbPool,
    project_id: &str,
    limit: usize,
) -> Result<Vec<ToolCallRecord>> {
    let conn = pool.get().context("audit: pool connection")?;
    let mut stmt = conn.prepare_cached(
        "SELECT id, tool, args, output_preview, success, error, duration_ms, project_id, created_at
         FROM tool_calls
         WHERE project_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![project_id, limit as i64], |row| {
            Ok(ToolCallRecord {
                id: row.get(0)?,
                tool: row.get(1)?,
                args: row.get(2)?,
                output_preview: row.get(3)?,
                success: row.get(4)?,
                error: row.get(5)?,
                duration_ms: row.get(6)?,
                project_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .context("audit: query")?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(records)
}

/// Raw tool call record from the database.
#[derive(Debug, Clone)]
pub struct ToolCallRecord {
    pub id: String,
    pub tool: String,
    pub args: String,
    pub output_preview: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub duration_ms: i64,
    pub project_id: String,
    pub created_at: String,
}
