# Just-Memory

> Persistent memory MCP server for Claude Desktop with cognitive features and semantic search

**Version:** 1.7.0  
**Tools:** 22  
**Database:** SQLite with WAL mode + sqlite-vec

## Features

- **Semantic Search** - Vector embeddings with all-MiniLM-L6-v2 (384 dimensions)
- **Hybrid Search** - Combine keyword + semantic with configurable alpha
- **Ebbinghaus Decay** - Memories fade over time, strengthen with recall
- **Confidence Scoring** - Track reliability with confirming/contradicting sources
- **Auto-Contradiction Detection** - Flags potential conflicts on store
- **Bi-Temporal Edges** - Time-travel queries on relationships
- **Spreading Activation** - Graph traversal with lateral inhibition
- **Working Memory** - Ephemeral scratchpad with TTL
- **Session Briefing** - Context recovery for new sessions

## Installation

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "just-memory": {
      "command": "node",
      "args": ["C:\\path\\to\\dist-v1.7\\just-memory-v1.7.js"]
    }
  }
}
```

## Tools (22)

### Core Memory (8)
| Tool | Description |
|------|-------------|
| `memory_store` | Store with auto-embedding and contradiction detection |
| `memory_recall` | Recall by ID (strengthens memory) |
| `memory_update` | Edit existing memory (regenerates embedding) |
| `memory_search` | Search: keyword, semantic, or hybrid mode |
| `memory_list` | List recent memories |
| `memory_delete` | Soft or permanent delete |
| `memory_stats` | Database statistics with embedding coverage |
| `memory_embed` | Generate embeddings for existing memories |

### Confidence Management (3)
| Tool | Description |
|------|-------------|
| `memory_confirm` | Add confirming source (+confidence) |
| `memory_contradict` | Record contradiction (-confidence) |
| `memory_confident` | Get high-confidence memories only |

### Knowledge Graph (4)
| Tool | Description |
|------|-------------|
| `edge_create` | Create temporal relationship |
| `edge_query` | Query relationships with time-travel |
| `edge_invalidate` | End a relationship |
| `graph_traverse` | Spreading activation traversal |

### Working Memory (5)
| Tool | Description |
|------|-------------|
| `scratch_set` | Set key-value with optional TTL |
| `scratch_get` | Get value by key |
| `scratch_delete` | Delete key |
| `scratch_clear` | Clear all scratchpad |
| `scratch_list` | List all keys |

### Session (1)
| Tool | Description |
|------|-------------|
| `memory_briefing` | Generate context recovery briefing |

## Semantic Search (v1.7)

### Search Modes
```json
// Keyword only (LIKE pattern)
{"query": "TypeScript", "mode": "keyword"}

// Semantic only (embedding similarity)
{"query": "programming language preference", "mode": "semantic"}

// Hybrid (recommended) - combines both
{"query": "TypeScript", "mode": "hybrid", "alpha": 0.5}
```

### Alpha Parameter
- `alpha=0` → Pure semantic (meaning-based)
- `alpha=0.5` → Balanced hybrid (default)
- `alpha=1` → Pure keyword (exact match)

### Embedding Management
```json
// Check coverage
memory_stats: {}
// Returns: {"embeddingCoverage": "85%", ...}

// Embed all memories without embeddings
memory_embed: {}

// Embed specific memories
memory_embed: {"ids": ["abc123", "def456"]}
```

## Security

- SQL injection protection (sanitizeLikePattern)
- Content length limits (100KB max)
- Tag validation and sanitization

## Database

Location: `~/.just-memory/memories.db`
Model cache: `~/.just-memory/models/`

```sql
-- Tables
memories (id, content, type, tags, importance, strength, confidence, embedding, ...)
edges (id, from_id, to_id, relation_type, valid_from, valid_to, ...)
scratchpad (key, value, expires_at, created_at)
```

## Version History

| Version | Date | Changes |
|---------|------|---------|c
| 1.7.0 | 2026-01-24 | Semantic search, sqlite-vec, memory_embed tool |
| 1.6.0 | 2026-01-24 | P0 fixes: SQL injection, content limits, memory_update |
| 1.5.0 | 2026-01-24 | Scratchpad, auto-contradiction, briefing |
| 1.2.0 | 2026-01-23 | Knowledge graph tools |
| 1.0.0 | 2026-01-23 | Initial release with Ebbinghaus decay |

## License

MIT
