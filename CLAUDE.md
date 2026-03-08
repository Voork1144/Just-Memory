# Just-Memory v8.0.0 (Rust)

## Build & Test

```bash
# Check (fast, no codegen)
cargo check

# Build
cargo build
cargo build --release

# Test (all 117 tests)
cargo test

# Run specific test
cargo test test_name

# Clippy
cargo clippy --all-targets
```

## Project Structure

```
src/
  main.rs              Entry point + server wiring
  config/              Static constants + runtime config (hot-reload via notify)
  db/                  SQLite pool (r2d2), migrations, query helpers
  types/
    core.rs            Database row types (MemoryRow, EdgeRow, EntityRow)
    api.rs             API response types (MemorySummary, BriefingResult)
  models/
    manager.rs         Lazy-load + idle eviction (15 min)
    embedding.rs       Arctic-S, E5, Nomic embedding
    nlp.rs             NLI, cross-encoder, QA
    ollama.rs          Ollama SLM client
  search/
    engine.rs          6-path TEMPR orchestrator
    paths.rs           Keyword, semantic, temporal, graph, concept, spreading
    scoring.rs         RRF, composite scoring, recency decay, MMR
    query.rs           Intent detection, temporal operators
    reranker.rs        Cross-encoder wrapper
    vector_stores.rs   SqliteVec + Qdrant backends
  consolidation/
    scheduler.rs       Light/Medium/Deep phases
    decay.rs           ACT-R forgetting
    enrichment.rs      Type classification, TF-IDF tagging
    clustering.rs      HDBSCAN concept formation
    concepts.rs        Drift tracking
  tools/
    definitions.rs     JSON schemas (11 tools)
    handlers.rs        Router dispatch
    mcp_handler.rs     rmcp ServerHandler impl
    dispatch_*.rs      Domain handlers
  infra/               Circuit breaker, event bus, audit, rate limiter, write lock
  dashboard/           Optional Axum HTTP API (port 3080)
```

## Key Patterns

- **Error handling**: `anyhow::Result` for fallible functions. Catch blocks use `err instanceof Error ? err.message : String(err)` pattern ported as `.context("description")?`. Never bare `.unwrap()` -- use `.expect("reason")`.
- **Types**: `MemoryRow` fields must exactly match `row_to_memory()` in paths.rs. Any schema change requires updating both.
- **Edition 2024**: No `ref` keyword in implicitly-borrowing patterns. Use `if let Some(x) = &val`.
- **MCP content**: `Content::new(RawContent::text("..."), None)` for rmcp responses.
- **Dynamic SQL**: `Vec<Box<dyn rusqlite::types::ToSql>>` for parameter building. Never string-interpolate user input.
- **Model access**: `PreparedQuery.intent` is `IntentResult`, not `QueryIntent`. Access the enum via `.intent.intent`.

## Critical Rules

- **NEVER make paid API calls** without user's explicit written consent
- All SQLite queries must use parameterized bindings (no string interpolation)
- Models lazy-load only -- never load at startup
- Tracing goes to stderr (stdout reserved for MCP JSON-RPC)
- Escape-hatch tools (reset/export) gated by runtime flag on ServerContext

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JUST_MEMORY_PROJECT_ID` | cwd name | Project scope |
| `JUST_MEMORY_DB_PATH` | `~/.just-memory/memory.db` | Database location |
| `JUST_MEMORY_DASHBOARD` | `false` | Enable HTTP dashboard |
| `JUST_MEMORY_PORT` | `3080` | Dashboard port |
| `JUST_MEMORY_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `RUST_LOG` | `info` | Log level |

## Test Architecture

Tests use `cargo test` (built-in test framework, not external runner). Each test creates an isolated in-memory SQLite pool with a unique URI to avoid shared-cache conflicts in parallel execution.
