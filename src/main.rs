//! Just-Memory v8.0.0 — Persistent Memory MCP Server (Rust)
//!
//! A Model Context Protocol server providing persistent memory with hybrid retrieval,
//! ML-powered enrichment, concept formation via HDBSCAN clustering, and a neuroscience-inspired
//! consolidation system.

// Many modules are fully ported but not yet wired into all dispatch paths.
// Suppress dead-code warnings until dispatch coverage reaches 100%.
#![allow(dead_code)]

mod config;
mod db;
mod types;
mod models;
mod search;
mod consolidation;
mod tools;
mod infra;
mod dashboard;

use std::sync::Arc;

use anyhow::{Context, Result};
use rmcp::ServiceExt;
use tracing::info;
use tracing_subscriber::{EnvFilter, fmt};

use db::pool;
use infra::event_bus::EventBus;
use infra::server_context::ServerContext;
use models::manager::ModelManager;
use tools::handlers::ToolHandler;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing (stderr only — stdout is reserved for MCP JSON-RPC)
    fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    info!("Just-Memory v{} starting", env!("CARGO_PKG_VERSION"));

    // 1. Config is static constants — no runtime loading needed
    info!("Config constants loaded");

    // 2. Open database + run migrations
    let db_path = pool::resolve_db_path();
    let db_pool = pool::create_pool(&db_path)?;
    info!("Database ready: {}", db_path.display());

    // 3. Initialize model manager (lazy — no models loaded until first use)
    let model_manager = Arc::new(ModelManager::with_defaults());
    info!("Model manager initialized (lazy loading)");

    // 4. Derive project_id from cwd
    let project_id = derive_project_id();

    // 5. Build server context (DI container)
    let ctx = Arc::new(ServerContext::new(
        db_pool.clone(),
        model_manager.clone(),
        project_id.clone(),
    ));

    // 6. Start event bus + behaviors
    let event_bus = Arc::new(EventBus::new());
    let _behavior_handle = infra::behaviors::start_behaviors(ctx.clone(), event_bus.clone());
    info!("Event bus + behaviors started");

    // 7. Optionally start dashboard HTTP server
    if dashboard::server::is_enabled() {
        let dashboard_ctx = ctx.clone();
        tokio::spawn(async move {
            if let Err(e) = dashboard::server::start_dashboard(dashboard_ctx).await {
                tracing::error!("Dashboard server error: {e}");
            }
        });
        info!("Dashboard server starting on port {}", std::env::var("JUST_MEMORY_PORT").unwrap_or_else(|_| "3080".into()));
    }

    // 8. Build tool handler
    let tool_handler = ToolHandler::new(ctx.clone());
    info!("Tool handler ready ({} tools)", tools::definitions::visible_tool_definitions().len());

    // 9. Start consolidation scheduler
    let scheduler = Arc::new(consolidation::scheduler::ConsolidationScheduler::new(
        db_pool.clone(),
        Some(model_manager.clone()),
    ));
    let _consolidation_handle = scheduler.start_background(project_id.clone());
    info!("Consolidation scheduler started");

    // 10. Run MCP server on stdio transport
    let transport = rmcp::transport::io::stdio();
    info!("MCP server starting — waiting for JSON-RPC on stdin");

    let service = tool_handler
        .serve(transport)
        .await
        .context("Failed to start MCP server")?;

    info!("MCP server running");

    // Block until the transport closes (client disconnects or stdin EOF)
    let quit_reason = service
        .waiting()
        .await
        .context("MCP server task panicked")?;

    info!("Just-Memory shutting down (reason: {quit_reason:?})");
    Ok(())
}

/// Derive project_id from the current working directory.
fn derive_project_id() -> String {
    if let Ok(pid) = std::env::var("JUST_MEMORY_PROJECT_ID") {
        return pid;
    }
    std::env::current_dir()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()))
        .unwrap_or_else(|| "default".into())
}
