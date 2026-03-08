# Just-Memory v8.0.0

Persistent memory MCP server with hybrid retrieval, ML enrichment, and concept formation.

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives LLMs persistent memory across sessions. Written in Rust for single-binary deployment, low memory footprint, and zero-dependency installs.

## Why

LLMs lose everything when context resets. Crashes, compaction, session boundaries -- all destroy accumulated knowledge. Just-Memory exists to solve **recovery**: crash recovery, reset recovery, context compaction recovery. Every reasoning step, decision, error, and fix is preserved and retrievable.

## Features

### Core Memory Operations
- **Store** -- persist memories with type classification (fact, decision, procedure, preference, note, event, observation)
- **Search** -- 6-path hybrid retrieval (keyword, semantic, temporal, graph, concept, spreading activation)
- **Update/Delete** -- modify or soft-delete with full audit trail
- **Answer** -- extractive QA over the memory corpus
- **Recall** -- retrieve by ID with full metadata

### Hybrid Retrieval (TEMPR)
Six parallel search paths fused via Reciprocal Rank Fusion (RRF):

| Path | Method | Signal |
|------|--------|--------|
| Keyword | FTS5 full-text search | Exact term matches |
| Semantic | Vector cosine similarity | Meaning similarity |
| Temporal | Time-range filters + recency decay | When it happened |
| Graph | Hebbian edge traversal | Co-retrieval patterns |
| Concept | HDBSCAN cluster membership | Conceptual grouping |
| Spreading | Network activation propagation | Associative links |

Query intent detection adjusts path weights automatically (factual queries boost keyword/semantic; temporal queries boost temporal path).

### ML Enrichment
- **Embedding** -- Snowflake Arctic-S (384-dim), E5-Small/Large, Nomic Embed Text
- **Contradiction detection** -- DeBERTa-v3 NLI (entailment/neutral/contradiction)
- **Reranking** -- MiniLM cross-encoder for precision reranking
- **Extractive QA** -- DistilBERT-Squad for answer extraction
- **Summarization** -- Ollama fallback (Qwen2.5:1.5b) when ONNX unavailable

All models lazy-load on first use and evict after 15 minutes idle.

### Consolidation System
Background processing inspired by memory consolidation in neuroscience:

| Phase | Interval | Operations |
|-------|----------|------------|
| Light | 5 min | Decay, scratchpad cleanup, audit log pruning |
| Medium | 30 min | Strengthening on access, similarity detection |
| Deep | 4 hours | HDBSCAN clustering, concept formation, enrichment |

- ACT-R power-law forgetting with tier-specific parameters
- Auto-classification of memory type on store
- TF-IDF keyword extraction for auto-tagging
- Concept drift tracking with snapshot history

### Entity & Relationship Graph
- Named entity CRUD with typed observations
- Directed relationship edges with confidence scores
- Entity type hierarchy (person, project, tool, concept, file)
- Graph queries with depth traversal

### Code Intelligence
- Parse source files via tree-sitter into a code knowledge graph
- Search functions, structs, traits by name or type
- Query call graphs and import relationships
- Diff tracking for code changes

### Transcript Ingestion
- Scan `~/.claude/projects/` for Claude conversation transcripts
- Parse JSONL format, filter noise, extract decisions/facts/errors
- Derive project_id from folder structure
- Content-hash deduplication to prevent duplicate imports

### Infrastructure
- **Dashboard** -- Optional HTTP API on port 3080 (health, stats, search, memories)
- **Circuit breaker** -- Resilience pattern for external services (vector stores, Ollama)
- **Event bus** -- Pub/sub for decoupled signaling
- **Audit logging** -- Every tool call logged with args, success, duration
- **Rate limiting** -- Token bucket for concurrent tool calls
- **Write lock** -- Serialized memory mutations

## MCP Tools

### Visible (9)

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory with contradiction detection |
| `memory_search` | Hybrid search (search/list/recall/suggest modes) |
| `memory_status` | Session briefing, task tracking, stats, health |
| `memory_update` | Update, delete, or adjust confidence |
| `memory_delete` | Soft-delete (or permanent hard delete) |
| `memory_entity` | Entity and relationship management |
| `memory_code` | Code intelligence (codify, search, graph, diff) |
| `memory_answer` | QA over stored memories |
| `memory_ingest` | Import Claude conversation transcripts |

### Hidden Escape Hatches (2)

| Tool | Description |
|------|-------------|
| `memory_reset` | Erase all memories for a project |
| `memory_export` | Export memories to JSON/JSONL |

Escape hatches are hidden from `tools/list` by default. Enable via `memory_status` config action.

## Architecture

```
src/
  main.rs              Entry point, server wiring
  config/              Static constants + runtime config with hot-reload
  db/                  SQLite pool (r2d2), migrations, query helpers
  types/               Database row types + API response types
    core.rs            MemoryRow, EdgeRow, EntityRow, etc.
    api.rs             MemorySummary, BriefingResult, SearchResult, etc.
  models/              ML model management
    manager.rs         Lazy loading + idle eviction (15 min)
    embedding.rs       Arctic-S, E5, Nomic embedding models
    nlp.rs             NLI, cross-encoder, QA models
    ollama.rs          Ollama SLM client (summarization fallback)
  search/              6-path TEMPR hybrid retrieval
    engine.rs          Orchestrator (paths -> RRF -> composite -> rerank -> MMR)
    paths.rs           Keyword, semantic, temporal, graph, concept, spreading
    scoring.rs         RRF fusion, composite scoring, recency decay, MMR
    query.rs           Intent detection, temporal operators, query expansion
    reranker.rs        Cross-encoder reranking wrapper
    vector_stores.rs   SqliteVec + Qdrant backends (trait-based)
  consolidation/       Background memory processing
    scheduler.rs       Light/Medium/Deep phase management
    decay.rs           ACT-R forgetting + strengthening
    enrichment.rs      Type classification, TF-IDF tagging, importance
    clustering.rs      HDBSCAN concept formation
    concepts.rs        Concept drift tracking, lifecycle
  tools/               MCP tool layer
    definitions.rs     JSON schemas for all 11 tools
    handlers.rs        Router dispatch
    mcp_handler.rs     rmcp ServerHandler implementation
    dispatch_*.rs      Domain-specific handlers (memory, search, entity, code, status, ingest)
  infra/               Cross-cutting infrastructure
    server_context.rs  Dependency injection container
    event_bus.rs       Pub/sub event routing
    circuit_breaker.rs Resilience pattern
    rate_limiter.rs    Token bucket
    write_lock.rs      Write serialization
    audit.rs           Tool call audit log
    behaviors.rs       Reactive event handlers
  dashboard/           Optional HTTP API
    server.rs          Axum on port 3080
    routes.rs          /api/health, /api/stats, /api/memories, /api/search
```

## Requirements

- Rust 1.88+ (edition 2024)
- SQLite 3.35+ (bundled via rusqlite)
- ONNX Runtime (bundled via ort, downloads binaries automatically)
- Optional: Ollama for summarization fallback
- Optional: Qdrant for external vector search

## Build

```bash
cargo build --release
```

The release binary is statically linked with SQLite and ONNX Runtime. Single file, no runtime dependencies.

Release profile: `opt-level = 3`, thin LTO, single codegen unit, stripped symbols.

## Usage

### As MCP Server (Claude Desktop / Claude Code)

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "just-memory": {
      "command": "/path/to/just-memory",
      "env": {
        "JUST_MEMORY_PROJECT_ID": "my-project"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JUST_MEMORY_PROJECT_ID` | cwd directory name | Project scope for memories |
| `JUST_MEMORY_DB_PATH` | `~/.just-memory/memory.db` | Database file location |
| `JUST_MEMORY_DASHBOARD` | `false` | Enable HTTP dashboard |
| `JUST_MEMORY_PORT` | `3080` | Dashboard port |
| `JUST_MEMORY_OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `JUST_MEMORY_SLM_MODEL` | `qwen2.5:1.5b` | Ollama model for summarization |
| `RUST_LOG` | `info` | Tracing log level |

### Dashboard

Enable with `JUST_MEMORY_DASHBOARD=true`:

```
GET /api/health       Server health + memory count
GET /api/stats        Memory statistics by project
GET /api/memories     List memories (paginated)
GET /api/search       Search memories
```

## Database

SQLite with production pragmas:
- WAL mode for concurrent reads
- FULL synchronous for durability
- 64 MB page cache
- 256 MB memory-mapped I/O
- 5-second busy timeout

Schema includes: memories (with FTS5), edges, entities, entity_observations, entity_types, scratchpad, tool_calls, tasks, concepts, concept_snapshots, hebbian_links.

## Stack

| Dependency | Version | Purpose |
|------------|---------|---------|
| rmcp | 1.1 | MCP protocol (ServerHandler, stdio transport) |
| tokio | 1 | Async runtime |
| rusqlite | 0.38 | SQLite (bundled, FTS5) |
| r2d2 / r2d2_sqlite | 0.8 / 0.32 | Connection pooling |
| ort | 2.0.0-rc.12 | ONNX Runtime (ML inference) |
| tokenizers | 0.22 | HuggingFace tokenizers |
| ndarray | 0.16 | N-dimensional arrays (embeddings) |
| axum | 0.8 | HTTP server (dashboard) |
| serde / serde_json | 1 | Serialization |
| chrono | 0.4 | Date/time |
| tree-sitter | 0.25 | Code parsing |
| flume | 0.11 | MPMC channels (event bus) |
| parking_lot | 0.12 | Synchronization primitives |

## License

MIT
