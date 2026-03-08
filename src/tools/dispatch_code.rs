//! Code intelligence dispatch — codify, search, graph, diff, summary.

use anyhow::{bail, Context, Result};
use rusqlite::params;
use serde_json::{json, Value};

use crate::infra::server_context::ServerContext;

/// Handle `memory_code` tool call.
pub async fn handle_code(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let action = args["action"]
        .as_str()
        .context("memory_code: missing 'action'")?;
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    match action {
        "codify" => code_codify(ctx, args, project_id).await,
        "search" => code_search(ctx, args, project_id).await,
        "graph" => code_graph(ctx, args, project_id).await,
        "diff" => code_diff(ctx, args, project_id).await,
        "summary" => code_summary(ctx, project_id).await,
        _ => bail!("Unknown code action: {action}"),
    }
}

async fn code_codify(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let path = args["path"]
        .as_str()
        .context("codify: missing 'path'")?;
    let recursive = args["recursive"].as_bool().unwrap_or(true);
    let force = args["force"].as_bool().unwrap_or(false);

    // For now, store file metadata as code entities
    // Full tree-sitter parsing will be implemented in a later iteration
    let path_obj = std::path::Path::new(path);
    if !path_obj.exists() {
        bail!("Path does not exist: {path}");
    }

    let conn = ctx.pool.get().context("code: pool")?;
    let mut codified = 0;

    if path_obj.is_file() {
        codified += codify_file(&conn, path, project_id, force)?;
    } else if path_obj.is_dir() && recursive {
        for entry in walkdir(path)? {
            codified += codify_file(&conn, &entry, project_id, force)?;
        }
    }

    Ok(json!({
        "codified": codified,
        "path": path,
        "recursive": recursive
    }))
}

fn codify_file(conn: &rusqlite::Connection, path: &str, project_id: &str, force: bool) -> Result<usize> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {path}"))?;

    let content_hash = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(content.as_bytes());
        format!("{:x}", h.finalize())
    };

    // Check if already codified with same hash
    if !force {
        let existing: Option<String> = conn
            .query_row(
                "SELECT hash FROM code_entities WHERE file_path = ?1 AND project_id = ?2 AND entity_type = 'file'",
                params![path, project_id],
                |row| row.get(0),
            )
            .ok();
        if existing.as_deref() == Some(&content_hash) {
            return Ok(0);
        }
    }

    // Detect language from extension
    let lang = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown");

    let line_count = content.lines().count() as i64;

    // Upsert file entity (matches migration 22 schema: start_line, end_line, hash, qualified_name)
    conn.execute(
        "INSERT OR REPLACE INTO code_entities (name, entity_type, file_path, qualified_name, language, start_line, end_line, hash, project_id)
         VALUES (?1, 'file', ?2, ?3, ?4, 1, ?5, ?6, ?7)",
        params![path, path, path, lang, line_count, content_hash, project_id],
    )?;

    Ok(1)
}

/// Simple recursive directory walk (no external dependency needed).
fn walkdir(dir: &str) -> Result<Vec<String>> {
    let mut files = Vec::new();
    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("Failed to read directory {dir}"))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();

        // Skip hidden dirs and common non-code dirs
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
                continue;
            }
        }

        if path.is_dir() {
            files.extend(walkdir(&path_str)?);
        } else if path.is_file() {
            files.push(path_str);
        }
    }
    Ok(files)
}

async fn code_search(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let query = args["query"]
        .as_str()
        .context("code search: missing 'query'")?;
    let entity_type = args["entity_type"].as_str();
    let language = args["language"].as_str();
    let limit = args["limit"].as_u64().unwrap_or(20) as i64;
    let conn = ctx.pool.get().context("code: pool")?;

    let like_query = format!("%{query}%");

    // Build dynamic WHERE with optional entity_type/language filters
    let mut conditions = vec![
        "project_id = ?1".to_string(),
        "name LIKE ?2".to_string(),
    ];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(project_id.to_string()),
        Box::new(like_query),
        Box::new(limit),
    ];

    if let Some(et) = entity_type {
        conditions.push(format!("entity_type = ?{}", param_values.len() + 1));
        // Insert before the limit param
        param_values.insert(param_values.len() - 1, Box::new(et.to_string()));
    }
    if let Some(lang) = language {
        conditions.push(format!("language = ?{}", param_values.len() + 1));
        param_values.insert(param_values.len() - 1, Box::new(lang.to_string()));
    }

    let limit_param = param_values.len();
    let where_clause = conditions.join(" AND ");
    let sql = format!(
        "SELECT id, name, entity_type, file_path, language, start_line, end_line
         FROM code_entities
         WHERE {where_clause}
         LIMIT ?{limit_param}"
    );

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|v| v.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(json!({
            "id": row.get::<_, i64>(0)?,
            "name": row.get::<_, String>(1)?,
            "entity_type": row.get::<_, String>(2)?,
            "file_path": row.get::<_, String>(3)?,
            "language": row.get::<_, String>(4)?,
            "start_line": row.get::<_, i64>(5)?,
            "end_line": row.get::<_, i64>(6)?
        }))
    })?;

    let mut entities = Vec::new();
    for row in rows {
        entities.push(row?);
    }

    Ok(json!({ "entities": entities, "total": entities.len() }))
}

async fn code_graph(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let entity_name = args["entity_name"]
        .as_str()
        .context("code graph: missing 'entity_name'")?;
    let depth = args["depth"].as_u64().unwrap_or(1).min(5);
    let direction = args["direction"].as_str().unwrap_or("both");
    let conn = ctx.pool.get().context("code: pool")?;

    // Find entity (code_entities uses INTEGER PRIMARY KEY AUTOINCREMENT)
    let entity_id: i64 = conn
        .query_row(
            "SELECT id FROM code_entities WHERE name = ?1 AND project_id = ?2",
            params![entity_name, project_id],
            |row| row.get(0),
        )
        .context("code entity not found")?;

    // Get relationships (code_relations uses from_entity_id / to_entity_id)
    let sql = match direction {
        "outgoing" => "SELECT id, to_entity_id, relation_type FROM code_relations WHERE from_entity_id = ?1 LIMIT 50",
        "incoming" => "SELECT id, from_entity_id, relation_type FROM code_relations WHERE to_entity_id = ?1 LIMIT 50",
        _ => "SELECT id, CASE WHEN from_entity_id = ?1 THEN to_entity_id ELSE from_entity_id END, relation_type FROM code_relations WHERE from_entity_id = ?1 OR to_entity_id = ?1 LIMIT 50",
    };

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![entity_id], |row| {
        Ok(json!({
            "id": row.get::<_, i64>(0)?,
            "related_id": row.get::<_, i64>(1)?,
            "relation_type": row.get::<_, String>(2)?
        }))
    })?;

    let mut relations = Vec::new();
    for row in rows {
        relations.push(row?);
    }

    Ok(json!({
        "entity_name": entity_name,
        "entity_id": entity_id,
        "relations": relations,
        "depth": depth,
        "direction": direction
    }))
}

async fn code_diff(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let file_path = args["file_path"]
        .as_str()
        .context("code diff: missing 'file_path'")?;
    let conn = ctx.pool.get().context("code: pool")?;

    // Get stored hash (column name is 'hash' per migration 22)
    let stored_hash: Option<String> = conn
        .query_row(
            "SELECT hash FROM code_entities WHERE file_path = ?1 AND project_id = ?2 AND entity_type = 'file'",
            params![file_path, project_id],
            |row| row.get(0),
        )
        .ok();

    // Get current file hash
    let current_hash = if std::path::Path::new(file_path).exists() {
        let content = std::fs::read_to_string(file_path)?;
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(content.as_bytes());
        Some(format!("{:x}", h.finalize()))
    } else {
        None
    };

    let changed = stored_hash != current_hash;

    Ok(json!({
        "file_path": file_path,
        "changed": changed,
        "stored_hash": stored_hash,
        "current_hash": current_hash
    }))
}

async fn code_summary(ctx: &ServerContext, project_id: &str) -> Result<Value> {
    let conn = ctx.pool.get().context("code: pool")?;

    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM code_entities WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;

    let mut stmt = conn.prepare(
        "SELECT entity_type, COUNT(*) FROM code_entities WHERE project_id = ?1 GROUP BY entity_type",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    let mut by_type = json!({});
    for row in rows {
        let (t, c) = row?;
        by_type[t] = json!(c);
    }

    let mut lang_stmt = conn.prepare(
        "SELECT language, COUNT(*) FROM code_entities WHERE project_id = ?1 AND language IS NOT NULL GROUP BY language",
    )?;
    let lang_rows = lang_stmt.query_map(params![project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    let mut by_language = json!({});
    for row in lang_rows {
        let (l, c) = row?;
        by_language[l] = json!(c);
    }

    Ok(json!({
        "total_entities": total,
        "by_type": by_type,
        "by_language": by_language
    }))
}
