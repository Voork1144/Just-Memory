//! Memory domain dispatch — store, update, delete, reset, export operations.
//!
//! Each handler extracts args from JSON, calls the business-logic layer, and
//! returns a JSON Value to serialize into the MCP response.

use anyhow::{bail, Context, Result};
use rusqlite::params;
use serde_json::{json, Value};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::infra::server_context::ServerContext;
use crate::consolidation::enrichment;
use crate::models::manager::ModelId;
use crate::models::embedding;

/// Handle `memory_store` tool call.
pub async fn handle_store(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let content = args["content"]
        .as_str()
        .context("memory_store: missing 'content'")?;

    if content.len() > 100_000 {
        bail!("Content exceeds 100KB limit");
    }

    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);
    let check_only = args["check_only"].as_bool().unwrap_or(false);

    // Auto-classify type if not provided
    let memory_type = args["type"]
        .as_str()
        .unwrap_or_else(|| enrichment::classify_memory_type(content));

    // Auto-generate tags if not provided
    let tags: Vec<String> = if let Some(arr) = args["tags"].as_array() {
        arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
    } else {
        enrichment::extract_tags(content, 5)
    };

    // Auto-score importance if not provided
    let importance = args["importance"]
        .as_f64()
        .unwrap_or_else(|| enrichment::compute_importance(content, memory_type));

    let confidence = args["confidence"].as_f64().unwrap_or(0.5);
    let agent_id = args["agent_id"].as_str();
    let valid_from = args["valid_from"].as_str();
    let valid_to = args["valid_to"].as_str();

    // Content hash for dedup
    let content_hash = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    };

    // Check for duplicates
    let conn = ctx.pool.get().context("store: pool")?;
    if let Some(dup_id) = enrichment::check_duplicate(&ctx.pool, project_id, content, &content_hash)? {
        if check_only {
            return Ok(json!({
                "deduplicated": true,
                "duplicateOf": dup_id,
                "message": "Duplicate detected (check_only mode)"
            }));
        }
        return Ok(json!({
            "deduplicated": true,
            "duplicateOf": dup_id,
            "message": "Content already stored"
        }));
    }

    if check_only {
        return Ok(json!({
            "deduplicated": false,
            "contradictions": [],
            "message": "No duplicates found (check_only mode)"
        }));
    }

    let id = Uuid::new_v4().to_string();
    let tags_json = serde_json::to_string(&tags)?;

    conn.execute(
        "INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, strength, agent_id, valid_from, valid_to, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1.0, ?8, ?9, ?10, ?11)",
        params![id, project_id, content, memory_type, tags_json, importance, confidence, agent_id, valid_from, valid_to, content_hash],
    )
    .context("store: insert")?;

    // Generate embedding inline (best-effort, non-fatal)
    let mut has_embedding = false;
    match ctx.model_manager.get_or_load(ModelId::ArcticEmbedS) {
        Ok(model) => {
            match embedding::embed_text(&model, content) {
                Ok(vec) => {
                    let bytes: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
                    let model_name = ModelId::ArcticEmbedS.display_name();
                    if let Err(e) = conn.execute(
                        "UPDATE memories SET embedding = ?1, embedding_model = ?2 WHERE id = ?3",
                        params![bytes, model_name, id],
                    ) {
                        warn!("store: failed to save embedding for {id}: {e}");
                    } else {
                        has_embedding = true;
                        debug!("Generated embedding for {id} ({} dims)", vec.len());
                    }
                }
                Err(e) => {
                    warn!("store: embedding generation failed for {id}: {e}");
                }
            }
        }
        Err(e) => {
            debug!("store: model not available, skipping embedding: {e}");
        }
    }

    debug!("Stored memory {id} type={memory_type}");

    let truncated = content.len() > 500;
    let display_content = if truncated {
        &content[..500]
    } else {
        content
    };

    Ok(json!({
        "id": id,
        "project_id": project_id,
        "content": display_content,
        "content_truncated": truncated,
        "type": memory_type,
        "tags": tags,
        "importance": importance,
        "confidence": confidence,
        "strength": 1.0,
        "agent_id": agent_id,
        "has_embedding": has_embedding,
        "contradictions": [],
        "autoEnriched": {
            "autoClassified": args["type"].is_null(),
            "autoTagged": args["tags"].is_null(),
            "autoScored": args["importance"].is_null()
        }
    }))
}

/// Handle `memory_update` tool call.
pub async fn handle_update(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let id = args["id"]
        .as_str()
        .context("memory_update: missing 'id'")?;
    let action = args["action"].as_str().unwrap_or("update");
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    let conn = ctx.pool.get().context("update: pool")?;

    match action {
        "update" => {
            // Build dynamic SET clause
            let mut sets = Vec::new();
            let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

            if let Some(content) = args["content"].as_str() {
                sets.push("content = ?");
                values.push(Box::new(content.to_string()));
            }
            if let Some(t) = args["type"].as_str() {
                sets.push("type = ?");
                values.push(Box::new(t.to_string()));
            }
            if let Some(imp) = args["importance"].as_f64() {
                sets.push("importance = ?");
                values.push(Box::new(imp));
            }
            if let Some(conf) = args["confidence"].as_f64() {
                sets.push("confidence = ?");
                values.push(Box::new(conf));
            }
            if let Some(agent) = args["agent_id"].as_str() {
                sets.push("agent_id = ?");
                values.push(Box::new(agent.to_string()));
            }
            if let Some(tags_arr) = args["tags"].as_array() {
                let tags: Vec<String> = tags_arr.iter().filter_map(|v| v.as_str().map(String::from)).collect();
                sets.push("tags = ?");
                values.push(Box::new(serde_json::to_string(&tags)?));
            }

            if sets.is_empty() {
                bail!("memory_update: no fields to update");
            }

            sets.push("updated_at = datetime('now')");
            let set_clause = sets.join(", ");
            values.push(Box::new(id.to_string()));
            values.push(Box::new(project_id.to_string()));

            let sql = format!(
                "UPDATE memories SET {} WHERE id = ? AND project_id = ?",
                set_clause
            );
            let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
            let updated = conn.execute(&sql, params.as_slice())?;

            // Fetch updated row for response
            let content: String = conn.query_row(
                "SELECT content FROM memories WHERE id = ?1",
                params![id],
                |row| row.get(0),
            ).context("update: memory not found after update")?;

            let truncated = content.len() > 500;
            Ok(json!({
                "id": id,
                "project_id": project_id,
                "content": if truncated { &content[..500] } else { &content },
                "content_truncated": truncated,
                "updated": updated > 0,
                "newContradictions": []
            }))
        }

        "confidence" => {
            let confidence_action = args["confidence_action"]
                .as_str()
                .context("confidence action requires 'confidence_action'")?;
            let delta: f64 = match confidence_action {
                "confirm" => 0.1,
                "contradict" => -0.1,
                _ => bail!("Invalid confidence_action: {confidence_action}"),
            };
            conn.execute(
                "UPDATE memories SET confidence = MIN(1.0, MAX(0.0, confidence + ?1)),
                                     confirmation_count = confirmation_count + ?2
                 WHERE id = ?3 AND project_id = ?4",
                params![delta, if delta > 0.0 { 1i64 } else { 0i64 }, id, project_id],
            )?;
            Ok(json!({ "id": id, "action": confidence_action, "delta": delta }))
        }

        "delete" => {
            handle_delete(ctx, args).await
        }

        _ => bail!("Unknown update action: {action}"),
    }
}

/// Handle `memory_delete` tool call.
pub async fn handle_delete(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let id = args["id"]
        .as_str()
        .context("memory_delete: missing 'id'")?;
    let permanent = args["permanent"].as_bool().unwrap_or(false);
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    let conn = ctx.pool.get().context("delete: pool")?;

    if permanent {
        conn.execute(
            "DELETE FROM memories WHERE id = ?1 AND project_id = ?2",
            params![id, project_id],
        )?;
        Ok(json!({ "id": id, "deleted": true, "permanent": true }))
    } else {
        conn.execute(
            "UPDATE memories SET deleted_at = datetime('now') WHERE id = ?1 AND project_id = ?2",
            params![id, project_id],
        )?;
        Ok(json!({ "id": id, "deleted": true, "permanent": false }))
    }
}

/// Handle `memory_reset` escape-hatch tool.
pub async fn handle_reset(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let confirm = args["confirm"].as_bool().unwrap_or(false);
    if !confirm {
        bail!("memory_reset requires confirm=true");
    }
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    let conn = ctx.pool.get().context("reset: pool")?;
    let deleted = conn.execute(
        "DELETE FROM memories WHERE project_id = ?1",
        params![project_id],
    )?;
    Ok(json!({ "reset": true, "deleted_count": deleted, "project_id": project_id }))
}

/// Handle `memory_export` escape-hatch tool.
pub async fn handle_export(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    let conn = ctx.pool.get().context("export: pool")?;
    let mut stmt = conn.prepare(
        "SELECT id, content, type, tags, importance, confidence, created_at FROM memories WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "content": row.get::<_, String>(1)?,
            "type": row.get::<_, String>(2)?,
            "tags": row.get::<_, Option<String>>(3)?,
            "importance": row.get::<_, f64>(4)?,
            "confidence": row.get::<_, f64>(5)?,
            "created_at": row.get::<_, String>(6)?
        }))
    })?;

    let mut memories = Vec::new();
    for row in rows {
        memories.push(row?);
    }

    Ok(json!({
        "project_id": project_id,
        "count": memories.len(),
        "memories": memories
    }))
}
