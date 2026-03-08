//! rmcp `ServerHandler` implementation for Just-Memory.
//!
//! Bridges our `ToolHandler` to the rmcp MCP protocol so that the server can
//! be served over stdio (or any other rmcp transport).

use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResult, Content, Implementation, InitializeResult,
    ListToolsResult, PaginatedRequestParams, RawContent, ServerCapabilities, ServerInfo, Tool,
};
use rmcp::handler::server::ServerHandler;
use rmcp::service::RequestContext;
use rmcp::service::RoleServer;
use rmcp::ErrorData as McpError;
use serde_json::Value;

use super::handlers::ToolHandler;

/// Convert our internal `ToolDef` JSON schema (a `serde_json::Value`) into
/// the `Arc<JsonObject>` that rmcp's `Tool` struct expects.
fn value_to_json_object(v: &Value) -> Arc<serde_json::Map<String, Value>> {
    match v {
        Value::Object(map) => Arc::new(map.clone()),
        _ => Arc::new(serde_json::Map::new()),
    }
}

impl ServerHandler for ToolHandler {
    fn get_info(&self) -> ServerInfo {
        let server_info = Implementation::new("just-memory", env!("CARGO_PKG_VERSION"))
            .with_title("Just-Memory")
            .with_description("Persistent memory MCP server with hybrid retrieval, ML enrichment, and concept formation");

        let capabilities = ServerCapabilities::builder()
            .enable_tools()
            .build();

        InitializeResult::new(capabilities)
            .with_server_info(server_info)
            .with_instructions("Persistent memory server. Use memory_status for briefing, memory_store to save, memory_search to find.")
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        let tool_infos = self.list_tools();
        let tools: Vec<Tool> = tool_infos
            .into_iter()
            .map(|t| Tool::new(t.name, t.description, value_to_json_object(&t.input_schema)))
            .collect();
        std::future::ready(Ok(ListToolsResult::with_all_items(tools)))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        async move {
            let name = request.name.as_ref();
            let args = match request.arguments {
                Some(map) => Value::Object(map),
                None => Value::Object(serde_json::Map::new()),
            };

            match self.call_tool(name, &args).await {
                Ok(result) => {
                    let text = serde_json::to_string_pretty(&result)
                        .unwrap_or_else(|e| format!("{{\"error\": \"serialization failed: {e}\"}}"));
                    let content = Content::new(RawContent::text(text), None);
                    Ok(CallToolResult::success(vec![content]))
                }
                Err(e) => {
                    let content = Content::new(
                        RawContent::text(format!("Error: {e}")),
                        None,
                    );
                    Ok(CallToolResult::error(vec![content]))
                }
            }
        }
    }
}
