# Just-Memory v1.7

> A focused MCP server for persistent memory capabilities - semantic search, knowledge graphs, confidence scoring, and session context for Claude Desktop.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-purple.svg)](https://modelcontextprotocol.io/)

## Why Just-Memory?

Claude forgets everything between sessions. Just-Memory solves this by providing:

- **Persistent Memory** - Store facts, preferences, decisions that survive across conversations
- **Confidence Scoring** - Track reliability with confirmation/contradiction support
- **Knowledge Graph Entities** - Create named entities with observations and relations
- **Bi-Temporal Queries** - Track when facts were valid, not just when stored
- **Working Memory** - Session-scoped scratchpad with TTL support
- **Session Briefings** - Auto-generate context summaries at session start

## Features

### 🧠 Core Memory (7 tools)
- Store facts, events, observations, preferences, notes, and decisions
- Auto-contradiction detection on store
- SQL injection protection
- Content validation (100KB max)
- Ebbinghaus decay curves for memory strength

### 🎯 Confidence Scoring (3 tools)
- Track confirming sources (increases confidence)
- Record contradictions (decreases confidence)
- Filter by confidence threshold
- Automatic confidence adjustment over time

### ⏰ Bi-Temporal Edges (3 tools)
- Create temporal relationships between memories
- Query relationships as of specific dates
- Invalidate edges with end dates

### 🔍 Graph Traversal (1 tool)
- Spreading activation algorithm
- Configurable decay, hops, and thresholds

### 📋 Working Memory / Scratchpad (5 tools)
- Session-scoped key-value storage
- Optional TTL (time-to-live)
- Automatic expiry cleanup

### 🏷️ Knowledge Graph Entities (6 tools) - NEW in v1.7
- Create named entities (people, projects, concepts)
- Add observations to entities
- Create relations between entities (active voice)
- Search entities by name or observations
- Full relation traversal

### 📊 Session Context (1 tool)
- Generate briefings with recent context, key facts, and entities

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

# Build v1.7
npx tsc -p tsconfig.v1.7.json
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "just-memory": {
      "command": "node",
      "args": ["C:/Users/YOUR_USERNAME/Desktop/Project/Just-Memory/dist-v1.7/just-memory-v1.7.js"]
    }
  }
}
```

Restart Claude Desktop after configuration.

## Tools Reference (26 tools)

### Core Memory (7 tools)

| Tool | Description |
|------|-------------|
| `memory_store` | Store memory with auto-contradiction detection (max 100KB) |
| `memory_recall` | Retrieve by ID (strengthens memory) |
| `memory_update` | Update content, type, tags, importance, or confidence |
| `memory_search` | Search with confidence filtering (SQL-injection safe) |
| `memory_list` | List recent memories with filters |
| `memory_delete` | Soft or permanent delete |
| `memory_stats` | Get statistics including entity counts |

### Confidence Management (3 tools)

| Tool | Description |
|------|-------------|
| `memory_confirm` | Add confirming source (increases confidence) |
| `memory_contradict` | Record contradiction (decreases confidence) |
| `memory_confident` | Get high-confidence memories above threshold |

### Bi-Temporal Edges (3 tools)

| Tool | Description |
|------|-------------|
| `memory_edge_create` | Create temporal relationship between memories |
| `memory_edge_query` | Query relationships with direction/type/date filters |
| `memory_edge_invalidate` | Invalidate edge (set end date) |

### Graph Traversal (1 tool)

| Tool | Description |
|------|-------------|
| `memory_graph_traverse` | Spreading activation traversal from seed memories |

### Working Memory / Scratchpad (5 tools)

| Tool | Description |
|------|-------------|
| `memory_scratch_set` | Set value with optional TTL (seconds) |
| `memory_scratch_get` | Get value (auto-expires if TTL passed) |
| `memory_scratch_delete` | Delete specific key |
| `memory_scratch_clear` | Clear all scratchpad |
| `memory_scratch_list` | List all keys with expiry info |

### Session Context (1 tool)

| Tool | Description |
|------|-------------|
| `memory_briefing` | Generate session briefing with memories and entities |

### Knowledge Graph Entities (6 tools) - NEW in v1.7

| Tool | Description |
|------|-------------|
| `memory_entity_create` | Create/update entity with observations (merges if exists) |
| `memory_entity_get` | Get entity by name with all relations |
| `memory_entity_link` | Create relation between entities (active voice) |
| `memory_entity_search` | Search entities by name or observation content |
| `memory_entity_observe` | Add observations to existing entity |
| `memory_entity_delete` | Delete entity and all its relations |

## Usage Examples

### Store and Search Memories

```javascript
// Store a preference
memory_store({ 
  content: "User prefers TypeScript over JavaScript", 
  type: "preference", 
  importance: 0.9,
  confidence: 0.8
})

// Search memories
memory_search({ query: "TypeScript", confidenceThreshold: 0.5 })

// Get session briefing
memory_briefing({ maxTokens: 500 })
```

### Confidence Management

```javascript
// Confirm a memory (increases confidence)
memory_confirm({ id: "abc123", sourceId: "def456" })

// Record contradiction (decreases confidence)
memory_contradict({ id: "abc123" })

// Get only high-confidence memories
memory_confident({ confidenceThreshold: 0.7, limit: 10 })
```

### Knowledge Graph Entities (NEW in v1.7)

```javascript
// Create entities
memory_entity_create({ 
  name: "Eric", 
  entityType: "person", 
  observations: ["LLM Engineer", "EvoSteward creator"] 
})

memory_entity_create({ 
  name: "EvoSteward", 
  entityType: "project", 
  observations: ["Commons-first meta-agent", "Uses Redis"] 
})

// Create relations (active voice)
memory_entity_link({ from: "Eric", to: "EvoSteward", relationType: "created" })

// Get entity with all relations
memory_entity_get({ name: "Eric" })
// Returns: { name, entityType, observations, relations: { outgoing, incoming } }

// Search entities
memory_entity_search({ query: "LLM", entityType: "person" })

// Add more observations
memory_entity_observe({ name: "Eric", observations: ["Lives in Montreal"] })
```

### Working Memory

```javascript
// Store temporary value with 1-hour TTL
memory_scratch_set({ key: "current_task", value: "Debugging v1.7", ttlSeconds: 3600 })

// Retrieve value
memory_scratch_get({ key: "current_task" })

// List all scratchpad keys
memory_scratch_list({})
```

## Database Schema

```sql
-- Core memories with confidence tracking
memories (id, content, type, tags, importance, strength, 
          access_count, confidence, source_count, contradiction_count,
          created_at, last_accessed, deleted_at)

-- Bi-temporal edges between memories
edges (id, from_id, to_id, relation_type, 
       valid_from, valid_to, confidence, metadata, created_at)

-- Working memory / scratchpad
scratchpad (key, value, expires_at, created_at)

-- Knowledge graph entities (NEW in v1.7)
entities (id, name UNIQUE, entity_type, observations JSON, 
          created_at, updated_at)

-- Entity relations (NEW in v1.7)
entity_relations (id, from_entity, to_entity, relation_type, created_at)
```

## Version History

| Version | Date | Tools | Key Features |
|---------|------|-------|--------------|
| v1.0 | Jan 2026 | 6 | Core CRUD, Ebbinghaus decay |
| v1.5 | Jan 2026 | 19 | Confidence, bi-temporal, scratchpad |
| v1.6 | Jan 24 | 20 | SQL injection fix, memory_update |
| **v1.7** | **Jan 24** | **26** | **Knowledge Graph Entity Layer** |

## EvoSteward Integration

Just-Memory v1.7 provides the entity-based knowledge graph that EvoSteward's cognitive engine requires:

| EvoSteward Need | Just-Memory Tool |
|-----------------|------------------|
| Create entities | `memory_entity_create` |
| Entity relations | `memory_entity_link` |
| Query entities | `memory_entity_get`, `memory_entity_search` |
| Add observations | `memory_entity_observe` |

**Shared Database**: `~/.just-memory/memories.db` (WAL mode for concurrent access)

## License

MIT © Voork1144

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- Research on 100+ MCP memory servers that informed this design
