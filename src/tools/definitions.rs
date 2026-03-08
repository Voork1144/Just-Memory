//! Tool definitions — JSON schemas for all MCP tools.
//!
//! Defines the 9 visible + 2 hidden escape-hatch tools that Just-Memory exposes
//! via MCP `tools/list`. Each tool has a name, description, and input schema.

use serde_json::{json, Value};

/// A tool definition for MCP `tools/list`.
#[derive(Debug, Clone)]
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
    pub hidden: bool,
}

/// Return all tool definitions (visible + hidden).
pub fn all_tool_definitions() -> Vec<ToolDef> {
    vec![
        memory_store_def(),
        memory_search_def(),
        memory_status_def(),
        memory_update_def(),
        memory_delete_def(),
        memory_entity_def(),
        memory_code_def(),
        memory_answer_def(),
        memory_ingest_def(),
        memory_reset_def(),
        memory_export_def(),
    ]
}

/// Return only visible tool definitions.
pub fn visible_tool_definitions() -> Vec<ToolDef> {
    all_tool_definitions()
        .into_iter()
        .filter(|t| !t.hidden)
        .collect()
}

fn memory_store_def() -> ToolDef {
    ToolDef {
        name: "memory_store",
        description: "Store a new memory with automatic contradiction detection.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "content": { "type": "string" },
                "type": { "type": "string", "enum": ["fact", "event", "observation", "preference", "note", "decision", "procedure"] },
                "tags": { "type": "array", "items": { "type": "string" } },
                "importance": { "type": "number", "minimum": 0, "maximum": 1 },
                "confidence": { "type": "number", "minimum": 0, "maximum": 1, "default": 0.5 },
                "agent_id": { "type": "string" },
                "project_id": { "type": "string" },
                "valid_from": { "type": "string" },
                "valid_to": { "type": "string" },
                "check_only": { "type": "boolean", "default": false }
            },
            "required": ["content"]
        }),
        hidden: false,
    }
}

fn memory_search_def() -> ToolDef {
    ToolDef {
        name: "memory_search",
        description: "Search, list, recall, or get suggestions.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "mode": { "type": "string", "enum": ["search", "list", "recall", "suggest"], "default": "search" },
                "query": { "type": "string" },
                "id": { "type": "string" },
                "context": { "type": "string" },
                "limit": { "type": "number", "default": 10 },
                "project_id": { "type": "string" },
                "confidenceThreshold": { "type": "number", "default": 0 },
                "includeDeleted": { "type": "boolean", "default": false },
                "extract_answer": { "type": "boolean", "default": false },
                "as_of": { "type": "string" },
                "agent_id": { "type": "string" }
            }
        }),
        hidden: false,
    }
}

fn memory_status_def() -> ToolDef {
    ToolDef {
        name: "memory_status",
        description: "Session briefing, task tracking, stats, health, reflect, insights, timeline, optimize.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "action": { "type": "string", "enum": ["briefing", "task", "stats", "project", "health", "reflect", "insights", "timeline", "optimize", "config"], "default": "briefing" },
                "project_id": { "type": "string" },
                "maxTokens": { "type": "number", "default": 500 },
                "task_action": { "type": "string", "enum": ["set", "update", "clear", "get"] },
                "description": { "type": "string" },
                "total_steps": { "type": "number" },
                "step": { "type": "number" },
                "step_description": { "type": "string" },
                "project_action": { "type": "string", "enum": ["list", "set"] },
                "path": { "type": "string" },
                "escape_hatches": { "type": "boolean" }
            }
        }),
        hidden: false,
    }
}

fn memory_update_def() -> ToolDef {
    ToolDef {
        name: "memory_update",
        description: "Update, delete, or adjust confidence of a memory.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "action": { "type": "string", "enum": ["update", "delete", "confidence"], "default": "update" },
                "content": { "type": "string" },
                "tags": { "type": "array", "items": { "type": "string" } },
                "importance": { "type": "number" },
                "confidence": { "type": "number" },
                "type": { "type": "string" },
                "agent_id": { "type": "string" },
                "project_id": { "type": "string" },
                "confidence_action": { "type": "string", "enum": ["confirm", "contradict"] },
                "related_id": { "type": "string" },
                "permanent": { "type": "boolean", "default": false }
            },
            "required": ["id"]
        }),
        hidden: false,
    }
}

fn memory_delete_def() -> ToolDef {
    ToolDef {
        name: "memory_delete",
        description: "Soft-delete a memory. Use permanent=true for hard delete.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "permanent": { "type": "boolean", "default": false },
                "project_id": { "type": "string" }
            },
            "required": ["id"]
        }),
        hidden: false,
    }
}

fn memory_entity_def() -> ToolDef {
    ToolDef {
        name: "memory_entity",
        description: "Entity and relationship management.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "action": { "type": "string", "enum": ["create", "get", "search", "observe", "delete", "link", "types", "edge_create", "edge_query", "edge_invalidate"] },
                "name": { "type": "string" },
                "entity_type": { "type": "string", "default": "concept" },
                "observations": { "type": "array", "items": { "type": "string" } },
                "query": { "type": "string" },
                "from": { "type": "string" },
                "to": { "type": "string" },
                "relation_type": { "type": "string" },
                "confidence": { "type": "number", "default": 1 },
                "from_id": { "type": "string" },
                "to_id": { "type": "string" },
                "memory_id": { "type": "string" },
                "edge_id": { "type": "string" },
                "direction": { "type": "string", "enum": ["outgoing", "incoming", "both"], "default": "both" },
                "metadata": { "type": "object" },
                "limit": { "type": "number", "default": 20 },
                "project_id": { "type": "string" }
            },
            "required": ["action"]
        }),
        hidden: false,
    }
}

fn memory_code_def() -> ToolDef {
    ToolDef {
        name: "memory_code",
        description: "Code intelligence: parse, search, graph, diff, summary.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "action": { "type": "string", "enum": ["codify", "search", "graph", "diff", "summary"] },
                "path": { "type": "string" },
                "query": { "type": "string" },
                "entity_name": { "type": "string" },
                "entity_type": { "type": "string" },
                "depth": { "type": "number", "default": 1 },
                "direction": { "type": "string", "enum": ["incoming", "outgoing", "both"], "default": "both" },
                "relation_type": { "type": "string" },
                "language": { "type": "string" },
                "file_path": { "type": "string" },
                "recursive": { "type": "boolean", "default": true },
                "force": { "type": "boolean", "default": false },
                "limit": { "type": "number", "default": 20 },
                "project_id": { "type": "string" }
            },
            "required": ["action"]
        }),
        hidden: false,
    }
}

fn memory_answer_def() -> ToolDef {
    ToolDef {
        name: "memory_answer",
        description: "Generate an answer to a question using stored memories.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "question": { "type": "string" },
                "project_id": { "type": "string" },
                "confidenceThreshold": { "type": "number", "default": 0 },
                "as_of": { "type": "string" }
            },
            "required": ["question"]
        }),
        hidden: false,
    }
}

fn memory_ingest_def() -> ToolDef {
    ToolDef {
        name: "memory_ingest",
        description: "Ingest Claude conversation transcripts from ~/.claude/projects/ into Just-Memory. Scans JSONL files, filters noise, deduplicates, and stores meaningful content.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["scan", "ingest", "status"],
                    "default": "scan",
                    "description": "scan: list available transcripts. ingest: parse and store. status: show ingestion stats."
                },
                "project_id": { "type": "string", "description": "Target project for ingested memories" },
                "filter_project": { "type": "string", "description": "Only ingest transcripts from this derived project" },
                "max_files": { "type": "number", "default": 100, "description": "Maximum transcript files to process per call" },
                "dry_run": { "type": "boolean", "default": false, "description": "Preview what would be ingested without storing" },
                "transcript_dir": { "type": "string", "description": "Override default ~/.claude/projects/ path" }
            }
        }),
        hidden: false,
    }
}

fn memory_reset_def() -> ToolDef {
    ToolDef {
        name: "memory_reset",
        description: "Reset all memories for a project. Hidden escape hatch.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "confirm": { "type": "boolean" }
            },
            "required": ["confirm"]
        }),
        hidden: true,
    }
}

fn memory_export_def() -> ToolDef {
    ToolDef {
        name: "memory_export",
        description: "Export all memories for a project. Hidden escape hatch.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "format": { "type": "string", "enum": ["json", "jsonl"], "default": "json" }
            }
        }),
        hidden: true,
    }
}
