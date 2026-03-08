//! Prepared statement cache and common query helpers.
//!
//! Provides typed helper functions for frequent database operations.
//! rusqlite caches prepared statements internally when using
//! `conn.prepare_cached()`, so we don't need a manual cache — we just
//! expose ergonomic wrappers.

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};

// ============================================================================
// Generic Helpers
// ============================================================================

/// Check if a table exists in the database.
pub fn table_exists(conn: &Connection, table_name: &str) -> Result<bool> {
    let count: i64 = conn
        .prepare_cached(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        )?
        .query_row(params![table_name], |row| row.get(0))?;
    Ok(count > 0)
}

/// Get a count from a table with an optional WHERE clause.
pub fn count_rows(conn: &Connection, table: &str, where_clause: &str) -> Result<i64> {
    let sql = if where_clause.is_empty() {
        format!("SELECT COUNT(*) FROM {table}")
    } else {
        format!("SELECT COUNT(*) FROM {table} WHERE {where_clause}")
    };
    let count: i64 = conn.prepare(&sql)?.query_row([], |row| row.get(0))?;
    Ok(count)
}

/// Check if a column exists on a table.
pub fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let count: i64 = conn
        .prepare_cached(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name=?2",
        )?
        .query_row(params![table, column], |row| row.get(0))?;
    Ok(count > 0)
}

/// Try to add a column to a table. Returns Ok(true) if added, Ok(false) if it
/// already existed (duplicate column error is swallowed).
pub fn try_add_column(conn: &Connection, table: &str, column_def: &str) -> Result<bool> {
    let sql = format!("ALTER TABLE {table} ADD COLUMN {column_def}");
    match conn.execute_batch(&sql) {
        Ok(()) => Ok(true),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("duplicate column") || msg.contains("already exists") {
                Ok(false)
            } else {
                Err(e).with_context(|| format!("ALTER TABLE {table} ADD COLUMN {column_def}"))
            }
        }
    }
}

// ============================================================================
// Migration Tracking
// ============================================================================

/// Check if a numbered migration has been applied.
pub fn migration_has_run(conn: &Connection, version: i64) -> Result<bool> {
    let count: i64 = conn
        .prepare_cached(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
        )?
        .query_row(params![version], |row| row.get(0))?;
    Ok(count > 0)
}

/// Record that a migration has been applied.
pub fn mark_migration(conn: &Connection, version: i64, description: &str) -> Result<()> {
    conn.prepare_cached(
        "INSERT OR IGNORE INTO schema_migrations (version, description) VALUES (?1, ?2)",
    )?
    .execute(params![version, description])?;
    Ok(())
}

// ============================================================================
// Memory Lookups
// ============================================================================

/// Get a single text column by ID from the memories table.
pub fn get_memory_field(conn: &Connection, id: &str, column: &str) -> Result<Option<String>> {
    let sql = format!("SELECT {column} FROM memories WHERE id = ?1");
    let val: Option<String> = conn
        .prepare_cached(&sql)?
        .query_row(params![id], |row| row.get(0))
        .optional()?;
    Ok(val)
}

/// Check if a memory exists and is not soft-deleted.
pub fn memory_is_active(conn: &Connection, id: &str) -> Result<bool> {
    let count: i64 = conn
        .prepare_cached(
            "SELECT COUNT(*) FROM memories WHERE id = ?1 AND deleted_at IS NULL",
        )?
        .query_row(params![id], |row| row.get(0))?;
    Ok(count > 0)
}

// ============================================================================
// Scratchpad Helpers
// ============================================================================

/// Get a scratchpad value for a given (key, project_id).
pub fn scratchpad_get(
    conn: &Connection,
    key: &str,
    project_id: &str,
) -> Result<Option<String>> {
    let val: Option<String> = conn
        .prepare_cached(
            "SELECT value FROM scratchpad WHERE key = ?1 AND project_id = ?2 AND (expires_at IS NULL OR expires_at > datetime('now'))",
        )?
        .query_row(params![key, project_id], |row| row.get(0))
        .optional()?;
    Ok(val)
}

/// Upsert a scratchpad value.
pub fn scratchpad_set(
    conn: &Connection,
    key: &str,
    project_id: &str,
    value: &str,
    expires_at: Option<&str>,
) -> Result<()> {
    conn.prepare_cached(
        "INSERT INTO scratchpad (key, project_id, value, expires_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key, project_id) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
    )?
    .execute(params![key, project_id, value, expires_at])?;
    Ok(())
}

/// Delete a scratchpad entry.
pub fn scratchpad_delete(conn: &Connection, key: &str, project_id: &str) -> Result<bool> {
    let changed = conn
        .prepare_cached(
            "DELETE FROM scratchpad WHERE key = ?1 AND project_id = ?2",
        )?
        .execute(params![key, project_id])?;
    Ok(changed > 0)
}

// ============================================================================
// Cortex State Helpers
// ============================================================================

/// Get a cortex state value.
pub fn cortex_state_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    let val: Option<String> = conn
        .prepare_cached(
            "SELECT value FROM cortex_state WHERE key = ?1",
        )?
        .query_row(params![key], |row| row.get(0))
        .optional()?;
    Ok(val)
}

/// Set a cortex state value.
pub fn cortex_state_set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.prepare_cached(
        "INSERT INTO cortex_state (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )?
    .execute(params![key, value])?;
    Ok(())
}

// ============================================================================
// Tool Call Logging
// ============================================================================

/// Insert a tool call record.
pub fn log_tool_call(
    conn: &Connection,
    id: &str,
    tool_name: &str,
    arguments: &str,
    output: Option<&str>,
    success: bool,
    error: Option<&str>,
    duration_ms: Option<i64>,
    project_id: &str,
) -> Result<()> {
    conn.prepare_cached(
        "INSERT INTO tool_calls (id, tool_name, arguments, output, success, error, duration_ms, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?
    .execute(params![
        id,
        tool_name,
        arguments,
        output,
        success as i64,
        error,
        duration_ms,
        project_id,
    ])?;
    Ok(())
}

/// Prune old tool calls, keeping the most recent N.
pub fn prune_tool_calls(conn: &Connection, keep: i64) -> Result<i64> {
    let deleted = conn.execute(
        "DELETE FROM tool_calls WHERE id NOT IN (
            SELECT id FROM tool_calls ORDER BY timestamp DESC LIMIT ?1
        )",
        params![keep],
    )?;
    Ok(deleted as i64)
}
