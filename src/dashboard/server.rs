//! Axum HTTP server setup — port 3080, opt-in via JUST_MEMORY_DASHBOARD env.
//!
//! Starts the dashboard HTTP server if JUST_MEMORY_DASHBOARD=true.

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::Router;
use tower_http::cors::CorsLayer;
use tracing::info;

use crate::infra::server_context::ServerContext;
use super::routes;

/// Check whether the dashboard is enabled via environment variable.
pub fn is_enabled() -> bool {
    std::env::var("JUST_MEMORY_DASHBOARD")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

/// Start the dashboard HTTP server on port 3080 (or JUST_MEMORY_PORT).
pub async fn start_dashboard(ctx: Arc<ServerContext>) -> Result<()> {
    let port: u16 = std::env::var("JUST_MEMORY_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3080);

    let app = build_router(ctx);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Dashboard listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .context("Failed to bind dashboard port")?;
    axum::serve(listener, app)
        .await
        .context("Dashboard server error")?;

    Ok(())
}

fn build_router(ctx: Arc<ServerContext>) -> Router {
    Router::new()
        .merge(routes::api_routes())
        .layer(CorsLayer::permissive())
        .with_state(ctx)
}
