# Changelog

## v8.0.0 (2026-03-07)

Full rewrite from TypeScript to Rust. Feature-complete port of Just-Memory v7.0.1.

### Changed
- **Language**: TypeScript (Node.js) -> Rust (single static binary)
- **MCP SDK**: `@modelcontextprotocol/sdk` -> `rmcp 1.1` (Rust MCP SDK)
- **ML Runtime**: `onnxruntime-node` / `@xenova/transformers` -> `ort 2.0.0-rc.12` (Rust ONNX bindings)
- **Database**: `better-sqlite3` -> `rusqlite 0.38` (bundled SQLite with FTS5)
- **Connection pool**: Custom pool -> `r2d2_sqlite 0.32`
- **HTTP server**: Express -> Axum 0.8
- **Code parsing**: `@anthropic/code-parser` -> `tree-sitter 0.25`
- **Edition**: Rust 2024 (requires rustc 1.88+)
- **Memory footprint**: ~3.4 GB peak (TypeScript with all models) -> lazy-load with 15 min idle eviction

### Added
- `memory_ingest` tool -- import Claude conversation transcripts from `~/.claude/projects/`
- Circuit breaker pattern for external service resilience (Ollama, Qdrant)
- Event bus (flume channels) for decoupled signaling
- Token bucket rate limiter
- Write lock for serialized memory mutations
- Content-hash deduplication on memory store
- Embedding generation on store (best-effort, non-fatal if model unavailable)
- Runtime escape-hatch toggle via `memory_status` config action

### Architecture (51 files, ~17k LOC)
- `config/` -- Static constants + runtime config with hot-reload (notify)
- `db/` -- SQLite pool, migrations, query helpers
- `types/` -- Database row types + API response types
- `models/` -- ONNX model management (lazy load, idle eviction)
- `search/` -- 6-path TEMPR hybrid retrieval engine
- `consolidation/` -- Background memory processing (decay, clustering, enrichment)
- `tools/` -- MCP tool definitions + domain dispatch handlers
- `infra/` -- Circuit breaker, event bus, audit, rate limiter, write lock
- `dashboard/` -- Optional Axum HTTP API

### MCP Tools (11 total)
**Visible (9):** memory_store, memory_search, memory_status, memory_update, memory_delete, memory_entity, memory_code, memory_answer, memory_ingest

**Hidden (2):** memory_reset, memory_export

### Tests
117 tests covering: database migrations, search paths, scoring, query intent detection, vector stores, consolidation, transcript ingestion
