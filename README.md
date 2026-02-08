# Just-Memory v4.3.3

> A persistent memory MCP server for Claude Desktop and Claude Code — semantic search, knowledge graphs, confidence scoring, contradiction detection, and session context across conversations.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-purple.svg)](https://modelcontextprotocol.io/)
![CI](https://github.com/Voork1144/Just-Memory/actions/workflows/ci.yml/badge.svg)

## What It Does

Claude forgets everything between sessions. Just-Memory provides 23 tools that give Claude persistent memory:

- **Semantic search** — e5-large-v2 embeddings (1024-dim) with HNSW indexing via sqlite-vec
- **Knowledge graph** — Named entities with observations, typed relations, and temporal edges
- **Confidence scoring** — Confirmation/contradiction tracking with DeBERTa-v3 NLI (lazy-loaded)
- **Session context** — Crash recovery, task tracking, and auto-briefings at session start
- **Chat ingestion** — Import conversation history from Claude Code and Claude Desktop
- **Background consolidation** — Automatic decay, strengthening, and cleanup during idle time

## Installation

### Prerequisites

- Node.js 18+
- Claude Desktop or Claude Code

### Setup

```bash
git clone https://github.com/Voork1144/Just-Memory.git
cd Just-Memory
npm install
npm run build
```

### Claude Desktop Configuration

Add to your Claude Desktop config file:

| Platform | Config Path |
|----------|-------------|
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "just-memory": {
      "command": "node",
      "args": ["/path/to/Just-Memory/dist-v2.1/just-memory-v2.1.js"]
    }
  }
}
```

Replace `/path/to/Just-Memory` with the actual path where you cloned the repository. Restart Claude Desktop after configuration.

## Tools (23)

### Core Memory (7 tools)

| Tool | Description |
|------|-------------|
| `memory_store` | Store memory with auto-contradiction detection |
| `memory_recall` | Retrieve by ID (strengthens memory) |
| `memory_update` | Update content, type, tags, importance, or confidence |
| `memory_search` | Hybrid keyword + semantic search |
| `memory_list` | List recent memories with filters |
| `memory_delete` | Soft or permanent delete |
| `memory_find_contradictions` | Check content for conflicts before storing |

### Unified Tools (action parameter selects operation)

| Tool | Actions | Purpose |
|------|---------|---------|
| `memory_confidence` | confirm, contradict | Manage memory confidence levels |
| `memory_entity` | create, get, link, search, observe, delete | Knowledge graph entities |
| `memory_edge` | create, query, invalidate | Temporal relationships between memories |
| `memory_scratch` | set, get, delete, list, clear | Working memory / scratchpad |
| `memory_task` | set, update, clear, get | Track current task for context recovery |
| `memory_scheduled` | create, list, check, complete, cancel | Future task scheduling |
| `memory_contradictions` | scan, pending, resolve | Contradiction resolution |
| `memory_backup` | create, restore, list | Backup and restore |
| `memory_project` | list, set | Project context management |
| `memory_chat` | discover, ingest, search, stats | Chat history ingestion |

### Other Tools

| Tool | Purpose |
|------|---------|
| `memory_stats` | Memory statistics and counts |
| `memory_briefing` | Session briefing — call at session start |
| `memory_suggest` | Context-based memory suggestions |
| `memory_tool_history` | View recent tool calls |
| `memory_health` | System health check |
| `memory_rebuild_embeddings` | Backfill or rebuild embedding vectors |

## Memory Types

`fact`, `event`, `observation`, `preference`, `note`, `decision`, `procedure`

## Environment Variables

All optional. Configure via your shell or in the Claude Desktop config `env` block.

| Variable | Default | Description |
|----------|---------|-------------|
| `JUST_MEMORY_EMBEDDING` | `large` | Embedding model size: `large` (1024-dim e5-large-v2) or `small` (384-dim e5-small-v2) |
| `JUST_MEMORY_SUMMARIZER` | `Xenova/distilbart-cnn-12-6` | Summarization model for chat ingestion |
| `JUST_MEMORY_QDRANT` | `true` | Enable Qdrant vector DB for 1M+ memory scale. Set `false` to use sqlite-vec only |
| `JUST_MEMORY_QDRANT_PORT` | `6333` | Qdrant gRPC port |
| `JUST_MEMORY_QDRANT_BINARY` | `~/.just-memory/qdrant/bin/qdrant` | Path to Qdrant binary |
| `JUST_MEMORY_MAX_WRITERS` | `1` | Max concurrent SQLite writers (WAL mode) |
| `JUST_MEMORY_PROJECT` | *(auto-detected)* | Default project ID. Also reads `CLAUDE_PROJECT` |

Example with environment variables:

```json
{
  "mcpServers": {
    "just-memory": {
      "command": "node",
      "args": ["/path/to/Just-Memory/dist-v2.1/just-memory-v2.1.js"],
      "env": {
        "JUST_MEMORY_EMBEDDING": "small",
        "JUST_MEMORY_QDRANT": "false"
      }
    }
  }
}
```

## Architecture

23 TypeScript source modules with dependency injection via a `ToolDispatch` interface:

- **Orchestrator** (`just-memory-v2.1.ts`) — MCP server lifecycle, DB setup, consolidation timer
- **Business logic** — `memory.ts`, `search.ts`, `entities.ts`, `contradiction.ts`, `consolidation.ts`, `chat-ingestion.ts`, `session.ts`
- **Infrastructure** — `write-lock.ts` (async FIFO mutex), `vector-store.ts` (Qdrant/sqlite-vec abstraction), `models.ts` (lazy ML loading), `schema.ts` (migrations)
- **Extracted modules** — `tool-handlers.ts`, `tool-definitions.ts`, `scheduled-tasks.ts`, `backup.ts`, `contradiction-resolution.ts`, `tool-logging.ts`, `stats.ts`
- **Shared** — `config.ts` (constants/thresholds), `validation.ts` (input sanitization)

Storage: SQLite with WAL mode at `~/.just-memory/memories.db`. Backups in `~/.just-memory/backups/`.

## Build from Source

```bash
# Build
npm run build

# Test (411 tests)
npm test

# Dev mode (hot reload)
npm run dev

# Quick test (config + validation only)
npm run test:quick
```

## Quick Start

Once configured, Claude can use memory tools in conversation:

1. **Store a memory** — Claude calls `memory_store` with content, type, and tags
2. **Search later** — `memory_search` finds relevant memories via hybrid keyword + semantic search
3. **Session briefing** — `memory_briefing` at session start recovers context from previous sessions
4. **Track tasks** — `memory_task` tracks multi-step work for crash recovery

All tools are available automatically through the MCP protocol. See the [Tools](#tools-23) section for the full list.

## Troubleshooting

**"Database is locked"** — Another process is holding the SQLite write lock. Restart Claude Desktop or kill any orphaned `node` processes running `just-memory`.

**Qdrant fails to start** — The binary is auto-downloaded on first use. If behind a proxy, set `JUST_MEMORY_QDRANT=false` to use sqlite-vec instead.

**Slow first startup** — The embedding model (~500MB for e5-large-v2) downloads on first use. Subsequent starts use the cached model. Use `JUST_MEMORY_EMBEDDING=small` for a faster ~100MB model.

**Build fails with "node-gyp" errors** — `better-sqlite3` requires a C++ compiler. Install build tools: `apt install build-essential` (Debian/Ubuntu), `xcode-select --install` (macOS), or install Visual Studio Build Tools (Windows).

## Updating

```bash
cd Just-Memory
git pull
npm install
npm run build
```

Then restart Claude Desktop or Claude Code to pick up the changes.

## License

MIT
