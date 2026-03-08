//! Tool handler router — dispatches CallToolRequest to domain handlers.
//!
//! Provides a `ToolHandler` struct that routes incoming tool calls to the
//! correct domain dispatcher based on tool name, with audit logging.

use std::sync::Arc;

use anyhow::Result;
use serde_json::Value;
use tracing::{debug, error, warn};

use crate::infra::audit;
use crate::infra::server_context::ServerContext;
use super::definitions;
use super::dispatch_memory;
use super::dispatch_search;
use super::dispatch_entity;
use super::dispatch_code;
use super::dispatch_status;
use super::dispatch_ingest;

/// MCP server handler that routes tool calls.
#[derive(Clone)]
pub struct ToolHandler {
    pub ctx: Arc<ServerContext>,
}

/// A lightweight tool info struct for listing.
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

impl ToolHandler {
    pub fn new(ctx: Arc<ServerContext>) -> Self {
        Self { ctx }
    }

    /// List all available tools.
    pub fn list_tools(&self) -> Vec<ToolInfo> {
        let defs = if self.ctx.escape_hatches() {
            definitions::all_tool_definitions()
        } else {
            definitions::visible_tool_definitions()
        };
        defs.into_iter()
            .map(|d| ToolInfo {
                name: d.name.to_string(),
                description: d.description.to_string(),
                input_schema: d.input_schema,
            })
            .collect()
    }

    /// Dispatch a tool call to the appropriate handler.
    pub async fn call_tool(
        &self,
        name: &str,
        args: &Value,
    ) -> Result<Value> {
        let start = std::time::Instant::now();

        let result = match name {
            "memory_store" => dispatch_memory::handle_store(&self.ctx, args).await,
            "memory_update" => dispatch_memory::handle_update(&self.ctx, args).await,
            "memory_delete" => dispatch_memory::handle_delete(&self.ctx, args).await,

            "memory_search" => dispatch_search::handle_search(&self.ctx, args).await,
            "memory_answer" => dispatch_search::handle_answer(&self.ctx, args).await,

            "memory_entity" => dispatch_entity::handle_entity(&self.ctx, args).await,

            "memory_code" => dispatch_code::handle_code(&self.ctx, args).await,

            "memory_status" => dispatch_status::handle_status(&self.ctx, args).await,

            "memory_ingest" => dispatch_ingest::handle_ingest(&self.ctx, args).await,

            "memory_reset" if self.ctx.escape_hatches() => {
                dispatch_memory::handle_reset(&self.ctx, args).await
            }
            "memory_export" if self.ctx.escape_hatches() => {
                dispatch_memory::handle_export(&self.ctx, args).await
            }

            _ => {
                warn!("Unknown tool: {name}");
                Err(anyhow::anyhow!("Unknown tool: {name}"))
            }
        };

        let duration_ms = start.elapsed().as_millis() as i64;

        // Audit log (best-effort)
        let (success, error_msg) = match &result {
            Ok(_) => (true, None),
            Err(e) => (false, Some(e.to_string())),
        };
        let args_str = serde_json::to_string(args).unwrap_or_default();
        if let Err(e) = audit::record_tool_call(
            &self.ctx.pool,
            name,
            &args_str,
            None,
            success,
            error_msg.as_deref(),
            duration_ms,
            &self.ctx.project_id,
        ) {
            debug!("Audit log write failed: {e}");
        }

        match result {
            Ok(v) => Ok(v),
            Err(e) => {
                error!("Tool {name} failed: {e}");
                Err(e)
            }
        }
    }
}
