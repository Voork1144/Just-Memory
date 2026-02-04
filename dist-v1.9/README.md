# Just-Memory v1.9 - Best of Both Worlds

**Date:** 2026-01-24
**Status:** READY FOR TESTING

---

## Overview

v1.9 merges the best features from v1.7 (entities) and v1.8 (semantic search):

| Feature | v1.7 | v1.8 | v1.9 |
|---------|------|------|------|
| Core memory (7) | ✅ | ✅ | ✅ |
| Edges (3) | ✅ | ✅ | ✅ |
| Graph traversal (1) | ✅ | ✅ | ✅ |
| Confidence (3) | ✅ | ✅ | ✅ |
| Scratchpad (5) | ✅ | ✅ | ✅ |
| Briefing (1) | ✅ | ✅ | ✅ |
| **Entities (6)** | ✅ | ❌ | ✅ |
| **Semantic search** | ❌ | ✅ | ✅ |
| **Embeddings** | ❌ | ✅ | ✅ |
| **Backup/Restore (2)** | ❌ | ✅ | ✅ |
| **Total tools** | **26** | **24** | **30** |

---

## Tool Inventory (30 tools)

### Core Memory (7)
- `memory_store` - Store with auto-contradiction + embedding
- `memory_recall` - Recall by ID (strengthens)
- `memory_update` - Update content/tags/importance/confidence
- `memory_search` - **Hybrid search (keyword + semantic)**
- `memory_list` - List recent memories
- `memory_delete` - Soft/hard delete
- `memory_stats` - Statistics including entities + embeddings

### Confidence (3)
- `memory_confirm` - Add confirming source
- `memory_contradict` - Record contradiction
- `memory_confident` - Get high-confidence memories

### Edges (3)
- `memory_edge_create` - Bi-temporal relationship
- `memory_edge_query` - Query with time travel
- `memory_edge_invalidate` - Set end date

### Graph (1)
- `memory_graph_traverse` - Spreading activation

### Scratchpad (5)
- `memory_scratch_set` - Set with optional TTL
- `memory_scratch_get` - Get value
- `memory_scratch_delete` - Delete key
- `memory_scratch_clear` - Clear all
- `memory_scratch_list` - List keys

### Briefing (1)
- `memory_briefing` - Generate session summary

### Entities (6) - from v1.7
- `memory_entity_create` - Create/update entity
- `memory_entity_get` - Get with relations
- `memory_entity_link` - Create relation
- `memory_entity_search` - Search by name/observation
- `memory_entity_observe` - Add observations
- `memory_entity_delete` - Delete with relations

### Embeddings (1) - from v1.8
- `memory_embed` - Generate embeddings for memories

### Backup/Restore (2) - from v1.8
- `memory_backup` - Create JSON backup
- `memory_restore` - Restore with merge/replace mode

---

## Search Modes

| Mode | Description | Best For |
|------|-------------|----------|
| `keyword` | SQL LIKE match | Exact terms |
| `semantic` | Cosine distance on 384-dim vectors | Meaning-based |
| `hybrid` | Weighted combination (default) | General use |

```javascript
// Examples
memory_search({ query: "authentication", mode: "keyword" })
memory_search({ query: "how to log in", mode: "semantic" })
memory_search({ query: "login system", mode: "hybrid", alpha: 0.5 })
```

---

## Technical Details

| Component | Value |
|-----------|-------|
| Embedding model | `Xenova/all-MiniLM-L6-v2` (quantized) |
| Embedding dimension | 384 |
| Vector store | sqlite-vec |
| Model cache | `~/.just-memory/models/` |
| Database | `~/.just-memory/memories.db` |
| Backups | `~/.just-memory/backups/` |

---

## Installation

1. **Update Claude Desktop config:**

```json
{
  "mcpServers": {
    "just-memory": {
      "command": "node",
      "args": ["C:\\Users\\ericc\\Desktop\\Project\\Just-Memory\\dist-v1.9\\just-memory-v1.9.js"]
    }
  }
}
```

2. **Restart Claude Desktop**

3. **Verify with `memory_stats`:**
```json
{
  "version": "1.9.0",
  "embeddingModel": "all-MiniLM-L6-v2",
  "entities": 0,
  "entityRelations": 0
}
```

---

## Migration Notes

- **From v1.7:** Gains semantic search, backup/restore. Entities preserved.
- **From v1.8:** Gains entities. Semantic search preserved.
- **Database:** Compatible with both v1.7 and v1.8 databases (auto-adds embedding column)

---

## File Info

| Metric | Value |
|--------|-------|
| Path | `dist-v1.9/just-memory-v1.9.js` |
| Lines | 1,341 |
| Size | 62 KB |
| Syntax | ✅ Valid (node --check passed) |

---

*Created: 2026-01-24*
