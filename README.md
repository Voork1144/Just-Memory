# Just-Memory

> A focused MCP server for persistent memory capabilities - semantic search, knowledge graphs, and session context for Claude Desktop.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-purple.svg)](https://modelcontextprotocol.io/)

## Why Just-Memory?

Claude forgets everything between sessions. Just-Memory solves this by providing:

- **Persistent Memory** - Store facts, preferences, decisions that survive across conversations
- **Semantic Search** - Find relevant memories using BM25 + vector hybrid search
- **Session Briefings** - Auto-generate context summaries at session start
- **Knowledge Graphs** - Link memories to files, commits, URLs, and entities

> **Note**: For filesystem, terminal, and search operations, use [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP). Just-Memory focuses solely on what Desktop Commander doesn't provide: persistent memory.

## Features

### 🧠 Persistent Memory
- Store facts, events, observations, preferences, notes, and decisions
- BM25 + vector hybrid search with highlighted snippets
- Soft delete with recovery
- Project-scoped memories
- Importance scoring and decay
- Database backup and restore

### 🔗 Knowledge Graph
- Create entities (people, projects, concepts)
- Link memories to files, git commits, URLs
- Organize related memories

### 📋 Session Context
- Generate briefings (~300 tokens) at session start
- Refresh context mid-session when it feels stale
- Export memories as JSON or Markdown

## Installation

### Prerequisites
- Node.js 18+
- Claude Desktop

### Setup

```bash
# Clone the repository
git clone https://github.com/Voork1144/Just-Memory.git
cd Just-Memory

# Install dependencies
npm install

# Build
npm run build
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "just-memory": {
      "command": "node",
      "args": ["C:/Users/YOUR_USERNAME/Just-Memory/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after configuration.

## Tools Reference (17 tools)

### Memory CRUD

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory with optional metadata |
| `memory_recall` | Retrieve a specific memory by ID |
| `memory_search` | Semantic search across stored memories |
| `memory_delete` | Soft delete a memory (recoverable) |
| `memory_recover` | Recover a soft-deleted memory |
| `memory_update` | Update memory content or metadata |
| `memory_list` | List recent memories with filters |

### Database Management

| Tool | Description |
|------|-------------|
| `memory_stats` | Get database statistics |
| `memory_backup` | Create timestamped database backup |
| `memory_restore` | Restore database from backup file |
| `memory_list_backups` | List available backup files |
| `memory_export` | Export memories as JSON or Markdown |

### Context & Knowledge Graph

| Tool | Description |
|------|-------------|
| `memory_briefing` | Generate session briefing (~300 tokens) |
| `memory_refresh_context` | Regenerate mid-session context |
| `memory_link` | Associate memory with file/commit/URL |
| `memory_entity_create` | Create knowledge graph entity |

### Utility

| Tool | Description |
|------|-------------|
| `get_config` | Get server configuration and status |

## Usage Examples

### Store and Search Memories

```
Store a preference:
> memory_store: "User prefers TypeScript over JavaScript" (type: preference, importance: 0.9)

Search memories:
> memory_search: "TypeScript preferences"

Get session briefing:
> memory_briefing: (returns ~300 token context summary)
```

### Link Memories to Context

```
Link to a file:
> memory_link: memoryId="abc123", filePath="/path/to/project/src/index.ts"

Link to a commit:
> memory_link: memoryId="abc123", commitHash="a1b2c3d"

Create an entity:
> memory_entity_create: name="Project Alpha", type="project", description="Main client project"
```

## Architecture

```
src/
├── index.ts          # MCP server entry point (17 tools)
├── memory/           # Persistent memory module
│   ├── crud.ts       # CRUD operations
│   ├── search.ts     # BM25 + vector search
│   ├── embeddings.ts # @xenova/transformers
│   ├── database.ts   # SQLite + sqlite-vec
│   └── schema.ts     # Database schema
└── utils/            # Shared utilities
    ├── config.ts
    ├── timeout.ts
    └── sqlite-config.ts
```

## Development

```bash
# Build in watch mode
npm run build:watch

# Run tests
npm test

# Quick tests (no rebuild)
npm run test:quick
```

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.9
- **MCP SDK**: @modelcontextprotocol/sdk 1.0
- **Database**: better-sqlite3 + sqlite-vec
- **Embeddings**: @xenova/transformers (all-MiniLM-L6-v2)
- **Validation**: Zod

## Complementary Tools

Just-Memory is designed to work alongside:

- **[Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP)** - Filesystem, terminal, and search operations
- **[GitHub MCP](https://github.com/modelcontextprotocol/servers)** - Repository operations

## License

MIT © Voork1144

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Mem0](https://mem0.ai/) for memory architecture patterns
- Research on 100+ MCP memory servers that informed this design
