# Just-Memory

> Persistent memory MCP server for Claude Desktop with cognitive features

**Version:** 1.6.0  
**Tools:** 20  
**Database:** SQLite with WAL mode

## Features

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
      "args": ["path/to/dist-v1.6/just-memory-v1.6.js"]
    }
  }
}
```

## Tools (20)

### Core Memory (7)
| Tool | Description |
|------|-------------|
| `memory_store` | Store with auto-contradiction detection |
| `memory_recall` | Recall by ID (strengthens memory) |
| `memory_update` | Edit existing memory content/tags/importance |
| `memory_search` | Search with confidence filtering |
| `memory_list` | List recent memories |
| `memory_delete` | Soft or permanent delete |
| `memory_stats` | Database statistics |

### Confidence Management (3)
| Tool | Description |
|------|-------------|
| `memory_confirm` | Add confirming source (+confidence) |
| `memory_contradict` | Record contradiction (-confidence) |
| `memory_confident` | Get high-confidence memories only |

### Knowledge Graph (4)
| Tool | Description |
|------|-------------|
| `memory_edge_create` | Create temporal relationship |
| `memory_edge_query` | Query relationships with time-travel |
| `memory_edge_invalidate` | End a relationship |
| `memory_graph_traverse` | Spreading activation traversal |

### Working Memory (5)
| Tool | Description |
|------|-------------|
| `memory_scratch_set` | Set key-value with optional TTL |
| `memory_scratch_get` | Get value by key |
| `memory_scratch_delete` | Delete key |
| `memory_scratch_clear` | Clear all scratchpad |
| `memory_scratch_list` | List all keys |

### Session (1)
| Tool | Description |
|------|-------------|
| `memory_briefing` | Generate context recovery briefing |

## Security (v1.6)

- SQL injection protection in search queries
- Content length limits (100KB max)
- Tag validation and sanitization

## Database

Location: `~/.just-memory/memories.db`

## Version History

| Version | Date | Changes |
|---------|------|----------|
| 1.6.0 | 2026-01-24 | P0 fixes: SQL injection, content limits, memory_update |
| 1.5.0 | 2026-01-24 | Scratchpad, auto-contradiction, briefing |
| 1.4.0 | 2026-01-23 | Confidence scoring, bi-temporal edges |
| 1.2.0 | 2026-01-23 | Knowledge graph tools |
| 1.0.0 | 2026-01-23 | Initial release with Ebbinghaus decay |

## License

MIT