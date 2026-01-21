# Just-Command

> A unified MCP server with persistent memory, filesystem operations, terminal control, and fast search for Claude Desktop.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-purple.svg)](https://modelcontextprotocol.io/)

## Features

### 🧠 Persistent Memory
- Store facts, events, observations, preferences, notes, and decisions
- BM25 + vector hybrid search with highlighted snippets
- Soft delete with recovery
- Project-scoped memories
- Importance scoring and decay
- Database backup and restore
- Knowledge Graph entities (v1 basic)
- File/commit/URL linking

### 📁 Filesystem Operations
- Read/write files with pagination and encoding support
- Surgical find/replace editing (`edit_block`)
- Directory listing with depth control
- File metadata and info

### 💻 Terminal Control
- Start processes with timeout enforcement (Claude Desktop safe: ≤5000ms)
- Interactive process I/O
- Session management
- Process listing and termination

### 🔍 Fast Search
- Ripgrep-powered content and file search
- Async search sessions with pagination
- Context lines and highlighting

## Installation

### Prerequisites
- Node.js 18+
- Claude Desktop

### Setup

```bash
# Clone the repository
git clone https://github.com/Voork1144/Just-Command.git
cd Just-Command

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
    "just-command": {
      "command": "node",
      "args": ["C:/Users/YOUR_USERNAME/Just-Command/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after configuration.

## Tools Reference

### Memory Tools (17)

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory with optional metadata |
| `memory_recall` | Retrieve a specific memory by ID |
| `memory_search` | Semantic search across stored memories |
| `memory_delete` | Soft delete a memory (recoverable) |
| `memory_recover` | Recover a soft-deleted memory |
| `memory_update` | Update memory content or metadata |
| `memory_list` | List recent memories with filters |
| `memory_stats` | Get database statistics |
| `memory_briefing` | Generate session briefing (~300 tokens) |
| `memory_export` | Export memories as JSON or Markdown |
| `memory_backup` | Create timestamped database backup |
| `memory_restore` | Restore database from backup file |
| `memory_list_backups` | List available backup files |
| `memory_link` | Associate memory with file/commit/URL |
| `memory_refresh_context` | Regenerate mid-session context |
| `memory_entity_create` | Create knowledge graph entity |

### Filesystem Tools (8)

| Tool | Description |
|------|-------------|
| `read_file` | Read file with pagination and encoding |
| `read_multiple_files` | Batch read multiple files |
| `write_file` | Write or append to files |
| `edit_block` | Surgical find/replace editing |
| `create_directory` | Create directories recursively |
| `list_directory` | List directory with depth control |
| `move_file` | Move or rename files |
| `get_file_info` | Get file metadata |

### Terminal Tools (5)

| Tool | Description |
|------|-------------|
| `start_process` | Start a process with timeout |
| `interact_with_process` | Send input to running process |
| `read_process_output` | Read process output with pagination |
| `list_sessions` | List active terminal sessions |
| `force_terminate` | Kill a process |

### Search Tools (3)

| Tool | Description |
|------|-------------|
| `start_search` | Start async ripgrep search |
| `get_search_results` | Get paginated search results |
| `stop_search` | Cancel running search |

### Utility Tools (1)

| Tool | Description |
|------|-------------|
| `get_config` | Get server configuration and status |

## Usage Examples

### Memory

```
Store a preference:
> memory_store: "User prefers TypeScript over JavaScript" (type: preference, importance: 0.9)

Search memories:
> memory_search: "TypeScript preferences"

Get session briefing:
> memory_briefing: (returns ~300 token context summary)
```

### Filesystem

```
Read a file:
> read_file: path="/path/to/file.ts", offset=0, length=100

Edit a file:
> edit_block: path="/path/to/file.ts", oldText="foo", newText="bar"
```

### Terminal

```
Run a command:
> start_process: command="npm", args=["test"], timeout=5000

Interactive session:
> start_process: command="python", args=["-i"]
> interact_with_process: pid=1234, input="print('hello')"
```

## Architecture

```
src/
├── index.ts          # MCP server entry point
├── memory/           # Persistent memory module
│   ├── crud.ts       # CRUD operations
│   ├── search.ts     # BM25 + vector search
│   ├── embeddings.ts # @xenova/transformers
│   └── schema.ts     # SQLite schema
├── filesystem/       # File operations
│   ├── read.ts
│   ├── write.ts
│   └── security.ts
├── terminal/         # Process management
│   ├── pty.ts
│   └── sessions.ts
├── search/           # Ripgrep integration
│   └── ripgrep.ts
└── utils/            # Shared utilities
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
- **Search**: @vscode/ripgrep
- **Terminal**: node-pty

## License

MIT © Voork1144

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) for inspiration
- [Mem0](https://mem0.ai/) for memory architecture patterns
