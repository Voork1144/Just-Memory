# Just-Memory MCP Server - Development Handoff

> **Date:** January 23, 2026
> **Version:** 0.5.0
> **Status:** Production Ready - Phase 2 Planning

---

## Quick Context

**Just-Memory** is a memory-first MCP server providing persistent memory for Claude Desktop/Claude.ai.

**Key Decision:** Background/proactive features (decay, consolidation, health monitoring) moved to EvoSteward. Just-Memory handles reactive memory operations only.

---

## Current State

### ✅ Working (17 Tools)

| Tool | Purpose |
|------|---------|
| `memory_store` | Store memory with metadata, tags, importance |
| `memory_recall` | Retrieve by ID |
| `memory_search` | Hybrid BM25 + vector search |
| `memory_delete` | Soft delete (recoverable) |
| `memory_recover` | Restore deleted memory |
| `memory_update` | Update content/metadata |
| `memory_list` | List with filters (type, project, limit) |
| `memory_stats` | Database statistics |
| `memory_briefing` | Session context (~300 tokens) |
| `memory_export` | JSON/Markdown export |
| `memory_backup` | Create database backup |
| `memory_restore` | Restore from backup |
| `memory_list_backups` | List available backups |
| `memory_link` | Associate with file/commit/URL |
| `memory_refresh_context` | Regenerate context |
| `memory_entity_create` | Create knowledge graph entity |
| `get_config` | Server configuration |

### 🔴 Known Issue

**Source/Build Mismatch:** `src/index.ts` still has old 26-tool code, but `dist/index.js` is correct 17-tool version. Source needs sync with build.

```bash
# To verify current state
node C:/Users/ericc/Just-Memory/dist/index.js
# Should output: "[just-memory] Starting MCP server (17 tools - Memory only)..."
```

---

## File Locations

| Resource | Path |
|----------|------|
| **Project** | `C:/Users/ericc/Just-Memory/` |
| **Source** | `src/index.ts`, `src/memory/` |
| **Build** | `dist/` |
| **Database** | `~/.claude-memory/memory.db` |
| **Research** | `C:/Users/ericc/memory-mcp-research/` |
| **GitHub** | https://github.com/Voork1144/Just-Memory |
| **Worklog** | `~/.claude-worklog/WORKLOG_JustCommand.md` |

### Key Documentation

| File | Content |
|------|---------|
| `docs/MASTER_PLAN_V3.md` | Roadmap, architecture, priorities |
| `docs/INNOVATIVE_FEATURES.md` | 8 unique features from research |
| `docs/EVOSTEWARD_HANDOFF.md` | Features moved to EvoSteward |

---

## Phase 2 Features (Next Steps)

These features stay in Just-Memory (reactive, on-demand):

### Tier 1: Knowledge Graph Enhancement

| Feature | Description | Complexity |
|---------|-------------|------------|
| `entity_update` | Update existing entities | Low |
| `entity_delete` | Delete entities | Low |
| `entity_search` | Find entities by name/type | Medium |
| `relation_create` | Create relations between entities | Medium |
| `relation_delete` | Remove relations | Low |
| `observation_add` | Add observations to entities | Low |
| `observation_delete` | Remove observations | Low |
| `graph_query` | Traverse knowledge graph | High |

### Tier 2: Cognitive Features

| Feature | Description | Complexity |
|---------|-------------|------------|
| Contradiction detection | On-demand check for conflicts | High |
| Confidence scoring | Metadata field, query filtering | Medium |
| Working memory | Ephemeral session scratchpad | Medium |
| Bi-temporal queries | Event time vs ingestion time | Medium |

### Tier 3: Advanced (Future)

| Feature | Description |
|---------|-------------|
| Emotional context | Sentiment tagging on store |
| Memory validation | Quality checks on demand |
| Counterfactual reasoning | "What if" queries |

---

## Technical Notes

### Database Schema

```sql
-- Core tables (already exist)
memories (id, content, type, tags, importance, ...)
memory_embeddings (memory_id, embedding)

-- Knowledge graph (partial)
entities (id, name, type, observations, ...)

-- Needed for Phase 2
relations (id, from_entity, to_entity, type, ...)
observations (id, entity_id, content, ...)
```

### Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "@xenova/transformers": "^2.17.2",
  "better-sqlite3": "^12.6.2",
  "sqlite-vec": "^0.1.7-alpha.2",
  "sqlite-vec-windows-x64": "installed",
  "zod": "^3.23.8"
}
```

### Build Commands

```bash
cd C:/Users/ericc/Just-Memory
npm run build      # Compile TypeScript
npm run test       # Run tests
npm start          # Start server
```

---

## Critical Rules

1. **Timeout:** Desktop Commander `timeout_ms=5000` max
2. **Memory-first:** Don't duplicate Desktop Commander features
3. **Reactive only:** Background features → EvoSteward
4. **Test:** `npm run test:quick` after code changes

---

## Architecture Reminder

```
┌─────────────────────────────────────────┐
│            Just-Memory (MCP)            │
│  • Memory CRUD                          │
│  • Knowledge graph (entities/relations) │
│  • Confidence scoring (metadata)        │
│  • Bi-temporal queries                  │
│  • Working memory (ephemeral)           │
│  • Contradiction detection (on-demand)  │
└─────────────────────────────────────────┘
           ↕ Shared SQLite DB
┌─────────────────────────────────────────┐
│         EvoSteward (Daemon)             │
│  • Memory decay (Ebbinghaus)            │
│  • Proactive retrieval                  │
│  • Offline consolidation                │
│  • Health monitoring                    │
│  • Reality feedback loop                │
└─────────────────────────────────────────┘
```

---

## Immediate Tasks

1. **Sync source with build** - Update `src/index.ts` to match 17-tool version
2. **Fix memory_search bug** - Error: "no such column: Memory" (seen in this session)
3. **Knowledge Graph Phase** - Implement remaining entity/relation tools
4. **Test all 17 tools** - Verify each works in Claude Desktop

---

## Memory IDs

| Memory | ID |
|--------|-----|
| Architecture split decision | `897c26f8c2b6ef266eee029104cf6090` |
| Rename decision | `7d2c110d1f109a2500d1c3d25ae129a8` |

---

## References

- Research: 86+ MCP memory servers analyzed
- Papers: 50+ academic sources (2024-2025)
- Worklog: Session 16 (Jan 23, 2026)
