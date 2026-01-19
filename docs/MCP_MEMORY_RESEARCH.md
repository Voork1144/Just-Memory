# MCP Memory Servers: Comprehensive Research

> Deep research on all available MCP memory solutions across GitHub, NPM, marketplaces, and registries

## Executive Summary

I found **50+ MCP memory server implementations** across various platforms. This document categorizes them by architecture, compares features, and provides recommendations for building a superior memory system.

---

## Table of Contents

1. [Official Implementations](#1-official-implementations)
2. [Knowledge Graph Architectures](#2-knowledge-graph-architectures)
3. [Vector Database Solutions](#3-vector-database-solutions)
4. [Hybrid Approaches](#4-hybrid-approaches)
5. [Specialized Systems](#5-specialized-systems)
6. [Commercial Solutions](#6-commercial-solutions)
7. [Architecture Comparison](#7-architecture-comparison)
8. [Performance Benchmarks](#8-performance-benchmarks)
9. [Recommendations](#9-recommendations)

---

## 1. Official Implementations

### Anthropic's Knowledge Graph Memory Server

**Repository:** [modelcontextprotocol/servers/memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)
**NPM:** [@modelcontextprotocol/server-memory](https://www.npmjs.com/package/@modelcontextprotocol/server-memory)

| Aspect | Details |
|--------|---------|
| **Storage** | Local JSON file |
| **Architecture** | Simple knowledge graph |
| **Entities** | Nodes with observations |
| **Relations** | Named edges between entities |
| **Search** | Basic text matching |

**Tools:**
- `create_entities` - Create new entities
- `create_relations` - Link entities
- `add_observations` - Add facts to entities
- `search_nodes` - Find entities
- `open_nodes` - Get entity details
- `delete_entities` / `delete_observations` / `delete_relations`

**Pros:** Simple, official, well-documented
**Cons:** No semantic search, no temporal awareness, basic storage

---

## 2. Knowledge Graph Architectures

### 2.1 Memento MCP (Neo4j)

**Repository:** [gannonh/memento-mcp](https://github.com/gannonh/memento-mcp)

A scalable, high-performance knowledge graph memory system with semantic retrieval, contextual recall, and temporal awareness.

| Aspect | Details |
|--------|---------|
| **Backend** | Neo4j (graph + vector unified) |
| **Features** | Semantic search, temporal awareness, scalable |
| **Unique** | Native graph operations with integrated vector search |

**Tools:**
- `create_memory` - Store with relationships
- `search_memories` - Semantic + graph search
- `get_related` - Graph traversal
- `update_memory` - Modify existing

---

### 2.2 MCP Neo4j Memory Server

**Repository:** [sylweriusz/mcp-neo4j-memory-server](https://github.com/sylweriusz/mcp-neo4j-memory-server)
**NPM:** [@sylweriusz/mcp-neo4j-memory-server](https://www.npmjs.com/package/@sylweriusz/mcp-neo4j-memory-server)

| Aspect | Details |
|--------|---------|
| **Backend** | Neo4j |
| **Features** | Batch operations, intelligent relationships |
| **Architecture** | Unified memory infrastructure |

---

### 2.3 MemoryMesh

**Repository:** [CheMiguel23/MemoryMesh](https://github.com/CheMiguel23/MemoryMesh)

A knowledge graph server with structured memory persistence for AI models.

| Aspect | Details |
|--------|---------|
| **Backend** | Local graph storage |
| **MCP SDK** | v1.25.2 (latest spec) |
| **Compatibility** | Claude Desktop, ChatGPT, Cursor, Gemini, VS Code |

---

### 2.4 Graphiti / Zep

**Repository:** [getzep/graphiti](https://github.com/getzep/graphiti)
**Docs:** [Zep Knowledge Graph MCP](https://help.getzep.com/graphiti/getting-started/mcp-server)

**THE MOST ADVANCED** - Temporally-aware knowledge graphs for AI agents.

| Aspect | Details |
|--------|---------|
| **Backend** | Neo4j, FalkorDB, Amazon Neptune, or Kuzu |
| **Architecture** | Bi-temporal data model |
| **Retrieval** | Hybrid (semantic + BM25 + graph traversal) |
| **Latency** | P95 < 300ms |

**Key Features:**
- **Real-time incremental updates** - No batch recomputation needed
- **Bi-temporal tracking** - Event time + ingestion time
- **Conflict resolution** - Intelligently updates/invalidates outdated info
- **Built-in entity types** - Preference, Requirement, Procedure, Location, Event, Organization, Document

**Tools:**
- `add_episode` - Store interactions with temporal metadata
- `search_facts` - Find relationships and facts
- `search_nodes` - Search entity summaries
- `get_episodes` - Retrieve recent context

**Performance:**
> Zep achieves P95 latency of 300ms by avoiding LLM calls during retrieval

---

### 2.5 Memory Graph

**Repository:** [memory-graph/memory-graph](https://github.com/memory-graph/memory-graph)

Graph DB-based memory for coding agents with intelligent relationship tracking.

---

## 3. Vector Database Solutions

### 3.1 Qdrant MCP Server (Official)

**Repository:** [qdrant/mcp-server-qdrant](https://github.com/qdrant/mcp-server-qdrant)

| Aspect | Details |
|--------|---------|
| **Backend** | Qdrant vector database |
| **Embeddings** | sentence-transformers/all-MiniLM-L6-v2 |
| **Model Support** | FastEmbed models |

---

### 3.2 ChromaDB MCP Servers

#### Official Chroma MCP
**Repository:** [chroma-core/chroma-mcp](https://github.com/chroma-core/chroma-mcp)
**PyPI:** [chroma-mcp-server](https://pypi.org/project/chroma-mcp-server/)

| Aspect | Details |
|--------|---------|
| **Backend** | ChromaDB |
| **Modes** | Ephemeral, Persistent, Chroma Cloud |
| **Embeddings** | OpenAI, Cohere, Jina, VoyageAI, Sentence Transformers |

#### HumainLabs ChromaDB-MCP
**Repository:** [HumainLabs/chromaDB-mcp](https://github.com/HumainLabs/chromaDB-mcp)

Features semantic understanding with natural language queries based on meaning.

---

### 3.3 PostgreSQL + pgvector

**Repository:** [sdimitrov/mcp-memory](https://github.com/sdimitrov/mcp-memory)

| Aspect | Details |
|--------|---------|
| **Backend** | PostgreSQL + pgvector |
| **Embeddings** | BERT (384 dimensions) |
| **Features** | Automatic embedding generation, semantic search |

---

### 3.4 MCP Memory LibSQL

**Repository:** [ZanzyTHEbar/mcp-memory-libsql-go](https://github.com/ZanzyTHEbar/mcp-memory-libsql-go)

High-performance memory powered by libSQL with vector search.

---

### 3.5 Local Memory MCP

**Repository:** [cunicopia-dev/local-memory-mcp](https://github.com/cunicopia-dev/local-memory-mcp)

| Aspect | Details |
|--------|---------|
| **Backend** | SQLite + FAISS |
| **Embeddings** | Ollama (local) |
| **Features** | Smart chunking, completely local |

---

## 4. Hybrid Approaches

### 4.1 MCP Memory Service

**Repository:** [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)

> "Stop re-explaining your project to AI every session"

| Aspect | Details |
|--------|---------|
| **Backend** | ChromaDB + Sentence Transformers |
| **Retrieval Speed** | ~5ms |
| **Features** | Auto backup, tag-based retrieval, semantic search |
| **Compatibility** | 13+ AI applications |

**Unique Features:**
- Dream-inspired consolidation (decay scoring, association discovery)
- 24/7 automatic maintenance scheduling
- 90% token reduction via Code Execution API

---

### 4.2 Cursor10x / DevContext

**Repository:** [aurda012/cursor10x-mcp](https://github.com/aurda012/cursor10x-mcp)

Multi-dimensional memory system with code awareness.

| Aspect | Details |
|--------|---------|
| **Backend** | Turso (SQLite edge) |
| **Architecture** | STM + LTM + Episodic + Semantic |
| **Features** | Code structure detection, auto-embeddings, cross-references |

**Memory Dimensions:**
- Short-Term Memory (STM) - Current conversation
- Long-Term Memory (LTM) - Persistent facts
- Episodic Memory - Past interactions
- Semantic Memory - Concepts and relationships
- Code Memory - Functions, classes, relationships

**Evolution:** Now called **DevContext** with deeper codebase understanding.

---

### 4.3 Basic Memory

**Repository:** [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory)

| Aspect | Details |
|--------|---------|
| **Storage** | Markdown files (you control!) |
| **Index** | SQLite (secondary) |
| **Features** | Obsidian compatible, semantic graph |

**Philosophy:**
- **Local-first** - All knowledge in files you own
- **Bi-directional** - Both you and LLM read/write
- **Standard format** - Plain Markdown
- **No lock-in** - Works with any editor

**Tools:**
- `write_note` - Create/update knowledge
- `read_note` - Retrieve content
- `search` - Semantic search
- `build_context` - Auto-gather relevant notes

---

### 4.4 Claude Memory (WhenMoon)

**NPM:** [@whenmoon-afk/memory-mcp](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)

| Aspect | Details |
|--------|---------|
| **Backend** | SQLite + FTS5 |
| **Storage** | Single portable .db file |
| **Features** | Zero-cloud, token-efficient |

---

## 5. Specialized Systems

### 5.1 Letta Memory MCP (MemGPT)

**Smithery:** [@letta-ai/memory-mcp](https://smithery.ai/server/@letta-ai/memory-mcp)
**Docs:** [Letta Memory Overview](https://docs.letta.com/guides/agents/memory/)

The original "LLM Operating System" architecture.

| Aspect | Details |
|--------|---------|
| **Architecture** | Two-tier (in-context + external) |
| **Core Memory** | Persona + User blocks (always visible) |
| **Archival Memory** | Vector DB (Chroma/pgvector) |
| **Recall Memory** | Conversation search |

**Memory Types:**
- **Core Memory** - Always in context (persona, user info)
- **Archival Memory** - Long-term vector storage
- **Recall Memory** - Conversation history search

**Tools:**
- `memory_replace` / `memory_insert` / `memory_rethink` - Edit core memory
- `archival_memory_insert` / `archival_memory_search` - Long-term storage
- `conversation_search` / `conversation_search_date` - History lookup

**Key Insight:**
> The agent has self-editing memory - it can update its own personality and user information as it learns.

---

### 5.2 Supermemory

**Smithery:** [supermemory](https://smithery.ai/server/supermemory)

| Aspect | Details |
|--------|---------|
| **Features** | Pattern recognition, semantic matching |
| **Use Case** | Find related experiences across interactions |

---

### 5.3 Memory Bank MCP

**NPM:** [@movibe/memory-bank-mcp](https://www.npmjs.com/package/@movibe/memory-bank-mcp)

| Aspect | Details |
|--------|---------|
| **Backend** | Markdown files |
| **Features** | Modular, multiple development modes |
| **Focus** | Project context tracking |

---

### 5.4 MCP Structured Memory

**NPM:** [@nmeierpolys/mcp-structured-memory](https://www.npmjs.com/package/@nmeierpolys/mcp-structured-memory)

Domain-specific memory management through structured markdown files.

---

### 5.5 Memory Keeper

**NPM:** [mcp-memory-keeper](https://www.npmjs.com/package/mcp-memory-keeper)

Persistent context management for Claude Code assistants - preserves work history, decisions, and progress.

---

## 6. Commercial Solutions

### 6.1 Mem0

**Website:** [mem0.ai](https://mem0.ai)
**Repository:** [mem0ai/mem0](https://github.com/mem0ai/mem0)
**MCP Server:** [mem0ai/mem0-mcp](https://github.com/mem0ai/mem0-mcp)

**THE INDUSTRY LEADER** in AI memory.

| Metric | Value |
|--------|-------|
| **Accuracy** | +26% over OpenAI Memory (LOCOMO benchmark) |
| **Latency** | 91% faster than full-context |
| **Token Savings** | 90% reduction |

**Memory Types:**
- `user_preferences` - User likes/dislikes
- `implementation` - Code decisions
- `troubleshooting` - Problem solutions
- `component_context` - Architecture knowledge
- `project_overview` - High-level context
- `incident_rca` - Root cause analyses

**Options:**
1. **Mem0 Cloud** - Managed service with API
2. **OpenMemory** - Self-hosted, local-first

**Tools:**
- `add_memory` - Store with userId association
- `search_memories` - Semantic retrieval
- `update_memory` - Modify existing
- `delete_memories` - Bulk removal

---

### 6.2 Zep (Enterprise Graphiti)

**Website:** [getzep.com](https://www.getzep.com)

Enterprise-grade with security, performance, and support.

---

### 6.3 MemMachine

**Website:** [memmachine.ai](https://memmachine.ai)

| Metric | Performance |
|--------|-------------|
| **LOCOMO Benchmark** | Top scores |
| **Token Usage** | Substantial reduction |
| **Operations** | Faster than competitors |

---

### 6.4 Pieces Long-Term Memory

**PulseMCP:** [pieces-long-term-memory](https://www.pulsemcp.com/servers/pieces-long-term-memory)

Dual-layer memory system (FIFO cache + persistent) with structured reasoning.

---

## 7. Architecture Comparison

### Storage Backends

| Backend | Pros | Cons | Best For |
|---------|------|------|----------|
| **JSON/SQLite** | Simple, portable, local | Limited scale, basic search | Personal use, prototypes |
| **PostgreSQL + pgvector** | Mature, scalable, SQL | Requires server | Production, teams |
| **Neo4j** | Native graphs, powerful queries | Complex, resource-heavy | Complex relationships |
| **ChromaDB** | Easy setup, good embeddings | Limited scale | RAG applications |
| **Qdrant** | High performance, cloud-native | External dependency | Large-scale vector search |
| **Turso/libSQL** | Edge-ready, low latency | Newer, smaller ecosystem | Edge deployments |
| **Markdown files** | Human-readable, portable | No built-in search | Obsidian users |

### Memory Models

| Model | Description | Examples |
|-------|-------------|----------|
| **Knowledge Graph** | Entities + relations + observations | Anthropic official, MemoryMesh |
| **Vector Store** | Embeddings + similarity search | Qdrant, ChromaDB servers |
| **Hybrid** | Graph + vectors + temporal | Graphiti, Memento |
| **Two-Tier (MemGPT)** | Core (in-context) + Archival (external) | Letta |
| **Multi-Dimensional** | STM + LTM + Episodic + Semantic | Cursor10x |
| **File-Based** | Markdown with semantic index | Basic Memory |

### Search Capabilities

| Type | Speed | Accuracy | Use Case |
|------|-------|----------|----------|
| **Keyword (FTS5/BM25)** | Fast | Exact match only | Known terms |
| **Semantic (Vector)** | Medium | Meaning-based | Conceptual search |
| **Graph Traversal** | Medium | Relationship-based | Connected info |
| **Hybrid** | Slower | Best | Complex queries |

---

## 8. Performance Benchmarks

### LOCOMO Benchmark Results

| Solution | Accuracy | Notes |
|----------|----------|-------|
| **Mem0** | +26% vs baseline | Industry leader |
| **MemMachine v0.2** | Top scores | Efficient token usage |
| **OpenAI Memory** | Baseline | Built into ChatGPT |

### Latency Comparison

| Solution | P95 Latency | Notes |
|----------|-------------|-------|
| **MCP Memory Service** | ~5ms | ChromaDB + local embeddings |
| **Graphiti/Zep** | ~300ms | No LLM calls in retrieval |
| **Full context replay** | 500ms-2s | Token-heavy |

### Token Efficiency

| Approach | Token Usage | Notes |
|----------|-------------|-------|
| **Full context** | 100% (baseline) | Send everything |
| **Mem0** | ~10% | 90% reduction |
| **Selective retrieval** | 15-30% | Query-based |

---

## 9. Recommendations

### For Just-Command Memory System

Based on this research, here's my recommendation for building a **superior memory system**:

#### Architecture: Hybrid Multi-Tier

```
┌─────────────────────────────────────────────────────────────────┐
│                    Just-Command Memory                          │
├─────────────────────────────────────────────────────────────────┤
│  Tier 1: Working Memory (In-Context)                            │
│  ├── Current session context                                    │
│  ├── Active project info                                        │
│  └── Recent decisions                                           │
├─────────────────────────────────────────────────────────────────┤
│  Tier 2: Knowledge Graph (Relationships)                        │
│  ├── Entities (people, projects, concepts)                      │
│  ├── Relations (works_on, depends_on, related_to)               │
│  ├── Observations (facts with timestamps)                       │
│  └── Temporal metadata (when learned, last accessed)            │
├─────────────────────────────────────────────────────────────────┤
│  Tier 3: Vector Store (Semantic Search)                         │
│  ├── Embeddings of all memories                                 │
│  ├── Conversation history                                       │
│  └── Code snippets and patterns                                 │
├─────────────────────────────────────────────────────────────────┤
│  Storage: SQLite + sqlite-vec (single file, portable)           │
└─────────────────────────────────────────────────────────────────┘
```

#### Key Differentiators to Implement

| Feature | Source Inspiration | Priority |
|---------|-------------------|----------|
| **Bi-temporal tracking** | Graphiti | P0 |
| **Self-editing memory** | Letta/MemGPT | P0 |
| **Automatic extraction** | Mem0 | P1 |
| **Dream consolidation** | mcp-memory-service | P1 |
| **Code awareness** | Cursor10x | P1 |
| **Markdown export** | Basic Memory | P2 |
| **Decay/relevance scoring** | mcp-memory-service | P2 |

#### Recommended Storage: SQLite + sqlite-vec

Why SQLite:
- Single file (portable, easy backup)
- No server required
- Fast (5ms retrieval achievable)
- Native FTS5 for keyword search
- sqlite-vec for vector similarity

Why NOT:
- Neo4j: Overkill for personal use, requires server
- PostgreSQL: Server dependency
- External services: Privacy concerns

#### Proposed Tools

```typescript
// Core Memory Tools
memory_store(content, type, metadata?)     // Add new memory
memory_search(query, filters?)             // Semantic + keyword search
memory_recall(context)                     // Auto-retrieve relevant memories
memory_update(id, content)                 // Modify existing
memory_forget(id | query)                  // Delete memories

// Relationship Tools
memory_relate(entity1, relation, entity2)  // Create relationship
memory_traverse(entity, depth?)            // Follow connections

// Introspection Tools
memory_stats()                             // Usage statistics
memory_export(format: json|markdown)       // Export for backup
memory_consolidate()                       // Run maintenance/decay
```

#### Memory Types to Support

| Type | Description | Auto-Extract? |
|------|-------------|--------------|
| `preference` | User preferences and opinions | Yes |
| `decision` | Technical decisions made | Yes |
| `pattern` | Code patterns and conventions | Yes |
| `entity` | People, projects, concepts | Yes |
| `procedure` | How to do things | Manual |
| `troubleshooting` | Problem solutions | Yes |
| `context` | Project/session context | Auto |

---

## 10. Complete Server List

### GitHub Repositories

| Name | URL | Stars | Backend |
|------|-----|-------|---------|
| Official Memory | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | - | JSON |
| Mem0 | [mem0ai/mem0](https://github.com/mem0ai/mem0) | 25k+ | Various |
| Graphiti | [getzep/graphiti](https://github.com/getzep/graphiti) | 3k+ | Neo4j/FalkorDB |
| Basic Memory | [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory) | 1k+ | Markdown |
| MCP Memory Service | [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | 800+ | ChromaDB |
| Cursor10x | [aurda012/cursor10x-mcp](https://github.com/aurda012/cursor10x-mcp) | 500+ | Turso |
| Memento | [gannonh/memento-mcp](https://github.com/gannonh/memento-mcp) | 300+ | Neo4j |
| MemoryMesh | [CheMiguel23/MemoryMesh](https://github.com/CheMiguel23/MemoryMesh) | 200+ | Local |
| Local Memory | [cunicopia-dev/local-memory-mcp](https://github.com/cunicopia-dev/local-memory-mcp) | 100+ | FAISS |
| mcp-memory | [Puliczek/mcp-memory](https://github.com/Puliczek/mcp-memory) | 100+ | Cloudflare |

### NPM Packages

| Package | Weekly Downloads |
|---------|-----------------|
| @modelcontextprotocol/server-memory | High |
| @mem0/mcp-server | Medium |
| @sylweriusz/mcp-neo4j-memory-server | Medium |
| @whenmoon-afk/memory-mcp | Low |
| @movibe/memory-bank-mcp | Low |

### Marketplaces

- **Smithery.ai**: 15+ memory servers
- **PulseMCP**: 198 memory servers listed
- **mcp.so**: Dedicated knowledge-and-memory category

---

## References

### Research Papers
- [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956)
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)
- [Mem0 Research: Memory Benchmark](https://mem0.ai/research)

### Documentation
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [Letta Memory Docs](https://docs.letta.com/guides/agents/memory/)
- [Graphiti Docs](https://help.getzep.com/graphiti/)

### Benchmarks
- [MCPBench](https://github.com/modelscope/MCPBench)
- [LOCOMO Benchmark](https://mem0.ai/research)
- [MCP Server Evaluation Report](https://arxiv.org/html/2504.11094v1)
