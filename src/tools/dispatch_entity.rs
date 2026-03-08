//! Entity domain dispatch — CRUD, link, edge operations.

use anyhow::{bail, Context, Result};
use rusqlite::params;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::infra::server_context::ServerContext;

/// Handle `memory_entity` tool call.
pub async fn handle_entity(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let action = args["action"]
        .as_str()
        .context("memory_entity: missing 'action'")?;
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    match action {
        "create" => entity_create(ctx, args, project_id).await,
        "get" => entity_get(ctx, args, project_id).await,
        "search" => entity_search(ctx, args, project_id).await,
        "observe" => entity_observe(ctx, args, project_id).await,
        "delete" => entity_delete(ctx, args, project_id).await,
        "link" => entity_link(ctx, args, project_id).await,
        "edge_create" => edge_create(ctx, args, project_id).await,
        "edge_query" => edge_query(ctx, args, project_id).await,
        "edge_invalidate" => edge_invalidate(ctx, args).await,
        _ => bail!("Unknown entity action: {action}"),
    }
}

async fn entity_create(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let name = args["name"]
        .as_str()
        .context("entity create: missing 'name'")?;
    let entity_type = args["entity_type"].as_str().unwrap_or("concept");

    let conn = ctx.pool.get().context("entity: pool")?;

    // Check if entity already exists
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM entities WHERE name = ?1 AND entity_type = ?2 AND project_id = ?3",
            params![name, entity_type, project_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        return Ok(json!({ "id": id, "name": name, "entity_type": entity_type, "created": false }));
    }

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO entities (id, name, entity_type, project_id) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, entity_type, project_id],
    )?;

    // Add initial observations if provided
    if let Some(observations) = args["observations"].as_array() {
        for obs in observations {
            if let Some(text) = obs.as_str() {
                conn.execute(
                    "INSERT INTO entity_observations (id, entity_id, content) VALUES (?1, ?2, ?3)",
                    params![Uuid::new_v4().to_string(), id, text],
                )?;
            }
        }
    }

    Ok(json!({ "id": id, "name": name, "entity_type": entity_type, "created": true }))
}

async fn entity_get(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let name = args["name"]
        .as_str()
        .context("entity get: missing 'name'")?;
    let conn = ctx.pool.get().context("entity: pool")?;

    let result = conn.query_row(
        "SELECT id, name, entity_type FROM entities WHERE name = ?1 AND project_id = ?2",
        params![name, project_id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "entity_type": row.get::<_, String>(2)?
            }))
        },
    ).context("entity not found")?;

    // Fetch observations
    let entity_id = result["id"].as_str().context("entity get: missing id in result")?;
    let mut stmt = conn.prepare(
        "SELECT content FROM entity_observations WHERE entity_id = ?1 ORDER BY created_at DESC",
    )?;
    let observations: Vec<String> = stmt
        .query_map(params![entity_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(json!({
        "id": result["id"],
        "name": result["name"],
        "entity_type": result["entity_type"],
        "observations": observations
    }))
}

async fn entity_search(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let query = args["query"]
        .as_str()
        .context("entity search: missing 'query'")?;
    let limit = args["limit"].as_u64().unwrap_or(20) as i64;
    let conn = ctx.pool.get().context("entity: pool")?;

    let like_query = format!("%{query}%");
    let mut stmt = conn.prepare(
        "SELECT id, name, entity_type FROM entities WHERE project_id = ?1 AND name LIKE ?2 LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![project_id, like_query, limit], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "entity_type": row.get::<_, String>(2)?
        }))
    })?;

    let mut entities = Vec::new();
    for row in rows {
        entities.push(row?);
    }

    Ok(json!({ "entities": entities, "total": entities.len() }))
}

async fn entity_observe(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let name = args["name"]
        .as_str()
        .context("entity observe: missing 'name'")?;
    let observations = args["observations"]
        .as_array()
        .context("entity observe: missing 'observations'")?;
    let conn = ctx.pool.get().context("entity: pool")?;

    // Get or create entity
    let entity_id: String = match conn.query_row(
        "SELECT id FROM entities WHERE name = ?1 AND project_id = ?2",
        params![name, project_id],
        |row| row.get(0),
    ) {
        Ok(id) => id,
        Err(_) => {
            let id = Uuid::new_v4().to_string();
            let entity_type = args["entity_type"].as_str().unwrap_or("concept");
            conn.execute(
                "INSERT INTO entities (id, name, entity_type, project_id) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, entity_type, project_id],
            ).context("entity observe: failed to create entity")?;
            id
        }
    };

    let mut added = 0;
    for obs in observations {
        if let Some(text) = obs.as_str() {
            conn.execute(
                "INSERT INTO entity_observations (id, entity_id, content) VALUES (?1, ?2, ?3)",
                params![Uuid::new_v4().to_string(), entity_id, text],
            )?;
            added += 1;
        }
    }

    Ok(json!({ "entity_id": entity_id, "name": name, "observations_added": added }))
}

async fn entity_delete(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let name = args["name"]
        .as_str()
        .context("entity delete: missing 'name'")?;
    let conn = ctx.pool.get().context("entity: pool")?;

    let deleted = conn.execute(
        "DELETE FROM entities WHERE name = ?1 AND project_id = ?2",
        params![name, project_id],
    )?;

    Ok(json!({ "name": name, "deleted": deleted > 0 }))
}

async fn entity_link(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let from = args["from"]
        .as_str()
        .context("entity link: missing 'from'")?;
    let to = args["to"]
        .as_str()
        .context("entity link: missing 'to'")?;
    let relation_type = args["relation_type"]
        .as_str()
        .unwrap_or("related_to");
    let confidence = args["confidence"].as_f64().unwrap_or(1.0);
    let conn = ctx.pool.get().context("entity: pool")?;

    // Get entity IDs
    let from_id: String = conn
        .query_row(
            "SELECT id FROM entities WHERE name = ?1 AND project_id = ?2",
            params![from, project_id],
            |row| row.get(0),
        )
        .context("'from' entity not found")?;
    let to_id: String = conn
        .query_row(
            "SELECT id FROM entities WHERE name = ?1 AND project_id = ?2",
            params![to, project_id],
            |row| row.get(0),
        )
        .context("'to' entity not found")?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO entity_relations (id, from_entity_id, to_entity_id, relation_type, confidence, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, from_id, to_id, relation_type, confidence, project_id],
    )?;

    Ok(json!({ "id": id, "from": from, "to": to, "relation_type": relation_type, "confidence": confidence }))
}

async fn edge_create(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let from_id = args["from_id"]
        .as_str()
        .context("edge_create: missing 'from_id'")?;
    let to_id = args["to_id"]
        .as_str()
        .context("edge_create: missing 'to_id'")?;
    let relation_type = args["relation_type"]
        .as_str()
        .unwrap_or("related_to");
    let confidence = args["confidence"].as_f64().unwrap_or(1.0);
    let conn = ctx.pool.get().context("entity: pool")?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO hebbian_edges (id, source_id, target_id, weight, co_occurrence_count, project_id)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![id, from_id, to_id, confidence, project_id],
    )?;

    Ok(json!({ "id": id, "from_id": from_id, "to_id": to_id, "relation_type": relation_type }))
}

async fn edge_query(ctx: &ServerContext, args: &Value, project_id: &str) -> Result<Value> {
    let memory_id = args["memory_id"]
        .as_str()
        .context("edge_query: missing 'memory_id'")?;
    let direction = args["direction"].as_str().unwrap_or("both");
    let limit = args["limit"].as_u64().unwrap_or(20) as i64;
    let conn = ctx.pool.get().context("entity: pool")?;

    let sql = match direction {
        "outgoing" => "SELECT id, target_id as other_id, weight FROM hebbian_edges WHERE source_id = ?1 AND project_id = ?2 ORDER BY weight DESC LIMIT ?3",
        "incoming" => "SELECT id, source_id as other_id, weight FROM hebbian_edges WHERE target_id = ?1 AND project_id = ?2 ORDER BY weight DESC LIMIT ?3",
        _ => "SELECT id, CASE WHEN source_id = ?1 THEN target_id ELSE source_id END as other_id, weight FROM hebbian_edges WHERE (source_id = ?1 OR target_id = ?1) AND project_id = ?2 ORDER BY weight DESC LIMIT ?3",
    };

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![memory_id, project_id, limit], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "other_id": row.get::<_, String>(1)?,
            "weight": row.get::<_, f64>(2)?
        }))
    })?;

    let mut edges = Vec::new();
    for row in rows {
        edges.push(row?);
    }

    Ok(json!({ "edges": edges, "total": edges.len() }))
}

async fn edge_invalidate(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let edge_id = args["edge_id"]
        .as_str()
        .context("edge_invalidate: missing 'edge_id'")?;
    let conn = ctx.pool.get().context("entity: pool")?;

    let deleted = conn.execute(
        "DELETE FROM hebbian_edges WHERE id = ?1",
        params![edge_id],
    )?;

    Ok(json!({ "edge_id": edge_id, "invalidated": deleted > 0 }))
}
