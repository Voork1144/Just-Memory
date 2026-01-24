# Just-Memory

> Persistent memory MCP server for Claude Desktop with Ebbinghaus decay, semantic search, and knowledge graphs.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-purple.svg)](https://modelcontextprotocol.io/)

## Why Just-Memory?

Claude forgets everything between sessions. Just-Memory solves this with:

- **Persistent Memory** - Store facts, preferences, decisions across conversations
- **Ebbinghaus Decay** - Memories fade naturally unless recalled (strengthening)
- **Semantic Search** - Find memories by meaning, not just keywords
- **Knowledge Graph** - Link related memories together

## Version History

| Version | Features |
|---------|----------|
| v1.0 | Core memory with Ebbinghaus decay |
| v1.1 | + Semantic search (all-MiniLM-L6-v2 embeddings) |
| v1.2 | + Knowledge graph relations |

## Installation

```bash
git clone https://github.com/Voork1144/Just-Memory.git
cd Just-Memory
npm install
npm run build
```

### Claude Desktop Configuration

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "just-memory": {
      "command": "node",
      "args": ["C:/Users/YOUR_USERNAME/Just-Memory/dist/just-memory-v1.2.js"]
    }
  }
}
```

## Tools Reference (11 tools)

### Memory Operations (7 tools)

| Tool | Description |
|------|-------------|
| `memory_store` | Store memory with type, tags, importance |
| `memory_recall` | Recall by ID (strengthens retention) |
| `memory_search` | Hybrid/keyword/semantic search |
| `memory_list` | List recent memories above threshold |
| `memory_delete` | Soft or permanent delete |
| `memory_stats` | Database statistics |
| `memory_reindex` | Backfill missing embeddings |

### Knowledge Graph (4 tools)

| Tool | Description |
|------|-------------|
| `memory_relate` | Create relation between memories |
| `memory_relations` | Query relations for a memory |
| `memory_unrelate` | Remove relation |
| `memory_graph` | Traverse connected memories |

## Memory Types

- `fact` - Verified information
- `event` - Something that happened
- `observation` - Something noticed
- `preference` - User preference
- `note` - General note
- `decision` - Decision made

## Relation Types

- `relates_to` - General relation
- `causes` / `caused_by` - Causal
- `supports` / `contradicts` - Agreement
- `part_of` / `contains` - Hierarchy
- `precedes` / `follows` - Temporal
- `similar_to` - Similarity
- `depends_on` - Dependency

## Search Modes

```javascript
// Keyword only
memory_search({ query: "project", mode: "keyword" })

// Semantic only (embedding similarity)
memory_search({ query: "AI development", mode: "semantic" })

// Hybrid (40% keyword + 60% semantic) - default
memory_search({ query: "memory systems", mode: "hybrid" })
```

## Architecture

```
~/.just-memory/memories.db (SQLite + WAL)
├── memories table
│   ├── id, content, type, tags
│   ├── importance, strength, access_count
│   ├── created_at, last_accessed, deleted_at
│   └── embedding (384-dim float32)
└── relations table
    ├── from_id, to_id
    ├── relation_type, weight
    └── created_at
```

## License

MIT
