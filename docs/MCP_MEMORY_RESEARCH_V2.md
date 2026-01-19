# MCP Memory Servers: Extended Research (v2)

> Deep dive research finding 100+ MCP memory implementations

## Executive Summary

This extended research found **100+ unique MCP memory server implementations** across GitHub, NPM, PyPI, Smithery, PulseMCP, Glama, and curated awesome lists. This document catalogs the most notable discoveries beyond the initial research.

---

## New Discoveries by Category

### 1. Cognitive Architecture Systems

These servers implement human-like memory models with multiple memory types.

| Server | Repository | Key Features |
|--------|------------|--------------|
| **CortexGraph** | [prefrontal-systems/cortexgraph](https://github.com/prefrontal-systems/cortexgraph) | Human-like forgetting curves, Ebbinghaus decay, Obsidian-compatible markdown |
| **ThoughtMCP** | [keyurgolani/ThoughtMcp](https://github.com/keyurgolani/ThoughtMcp) | Dual-process thinking, emotional processing, metacognitive monitoring |
| **Hexis/AGI-Memory** | [QuixiAI/Hexis](https://github.com/QuixiAI/Hexis) | Multi-layered (episodic, semantic, procedural, strategic) |
| **OpenMemory** | [CaviraOSS/OpenMemory](https://github.com/CaviraOSS/OpenMemory) | 5-sector memory (episodic, semantic, procedural, emotional, reflective) |
| **FEGIS** | [p-funk/FEGIS](https://github.com/p-funk/FEGIS) | Customizable cognitive tools with persistent memory |

**CortexGraph Decay Model:**
```
0 hours  = 1.000 (Fresh)
3 days   = 0.500 (Half-life)
7 days   = 0.210 (Decaying)
14 days  = 0.044 (Near forget)
30 days  = 0.001 (Forgotten)
```

---

### 2. Forgetting & Decay Systems

Servers that implement biologically-inspired memory decay.

| Server | Repository | Decay Model |
|--------|------------|-------------|
| **CortexGraph** | [prefrontal-systems/cortexgraph](https://github.com/prefrontal-systems/cortexgraph) | Ebbinghaus forgetting curve, reinforcement on access |
| **Memory Bank (Zettelkasten)** | [AceOfWands/memory-bank-mcp](https://github.com/AceOfWands/memory-bank-mcp) | Retrievability decay with probabilistic filtering |
| **Long-Term Memory** | [Rotoslider/long-term-memory-mcp](https://github.com/Rotoslider/long-term-memory-mcp) | Exponential half-life per memory type, protected tags |
| **MCP Memory Service** | [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | Dream-inspired consolidation, decay scoring |

---

### 3. RAG-Enhanced Memory

Combining retrieval-augmented generation with persistent memory.

| Server | Repository | Features |
|--------|------------|----------|
| **rag-memory-mcp** | [ttommyth/rag-memory-mcp](https://github.com/ttommyth/rag-memory-mcp) | Knowledge graph + vector search + document processing |
| **Context Portal** | [GreatScottyMac/context-portal](https://github.com/GreatScottyMac/context-portal) | Project-specific knowledge graph for RAG |
| **mcp-rag-server** | [kwanLeeFrmVi/mcp-rag-server](https://github.com/kwanLeeFrmVi/mcp-rag-server) | Document indexing, chunking, embedding |
| **Memory-Plus** | [Yuchen20/Memory-Plus](https://github.com/Yuchen20/Memory-Plus) | Hackathon winner, local RAG memory store |
| **Supernova** | [shabib87/supernova-mcp-rag](https://github.com/shabib87/supernova-mcp-rag) | HuggingFace embeddings, in-memory vector store |

---

### 4. Code-Aware Memory

Memory systems specifically designed for coding contexts.

| Server | Repository | Features |
|--------|------------|----------|
| **Cursor10x/DevContext** | [aurda012/cursor10x-mcp](https://github.com/aurda012/cursor10x-mcp) | STM/LTM/Episodic/Semantic, code structure detection |
| **Heimdall** | [lcbcFoo/heimdall-mcp-server](https://github.com/lcbcFoo/heimdall-mcp-server) | Git history analysis, codebase cognitive memory |
| **Enhanced MCP Memory** | [cbunting99/enhanced-mcp-memory](https://github.com/cbunting99/enhanced-mcp-memory) | Auto task extraction, knowledge graphs |
| **Smart Coding MCP** | [omar-haris/smart-coding-mcp](https://github.com/omar-haris/smart-coding-mcp) | Semantic code search with local AI |
| **Provimedia/Chainguard** | [provimedia/provimedia-mcp](https://github.com/provimedia/provimedia-mcp) | Code structure indexing, syntax validation |
| **Claude-Mem** | [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) | Auto-captures sessions, AI compression |

---

### 5. Automatic Memory Capture

Systems that automatically extract and store memories.

| Server | Repository | Auto-Capture Features |
|--------|------------|----------------------|
| **MCP Memory Service** | [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | Project context, architecture decisions, code patterns |
| **Claude-Mem** | [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) | Everything Claude does, AI-compressed |
| **Memory Forge** | [cpretzinger/memory-forge](https://github.com/cpretzinger/memory-forge) | Auto-save every 30 seconds |
| **Enhanced MCP Memory** | [cbunting99/enhanced-mcp-memory](https://github.com/cbunting99/enhanced-mcp-memory) | Auto-extraction of key points, decisions, action items |
| **Memory Keeper** | [mkreyman/mcp-memory-keeper](https://github.com/mkreyman/mcp-memory-keeper) | Work history, decisions, progress preservation |

---

### 6. Personal Knowledge Management Integration

Servers that integrate with PKM tools like Obsidian, Notion, Logseq.

| Server | Repository | Integration |
|--------|------------|-------------|
| **Obsidian MCP** | [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server) | Full vault access via Local REST API |
| **Basic Memory** | [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory) | Markdown files, Obsidian compatible |
| **Logseq MCP** | [ergut/mcp-logseq](https://github.com/ergut/mcp-logseq) | Read/write Logseq graphs |
| **Logseq PKM** | [ruliana/mcp-pkm-logseq](https://github.com/ruliana/mcp-pkm-logseq) | Personal notes, todo lists |
| **Notion MCP** | [kyrelldixon/notion-mcp](https://github.com/kyrelldixon/notion-mcp) | Workspace interaction |
| **OneNote MCP** | [swax/OneNoteMCP](https://github.com/swax/OneNoteMCP) | Personal notebook access |
| **Bear MCP** | [Ssiswent/mcp-server-bear](https://github.com/Ssiswent/mcp-server-bear) | Note creation and search |

---

### 7. Vector Database Backends

MCP servers using various vector databases.

| Server | Repository | Backend |
|--------|------------|---------|
| **Qdrant MCP** | [qdrant/mcp-server-qdrant](https://github.com/qdrant/mcp-server-qdrant) | Qdrant (official) |
| **Weaviate MCP** | weaviate/mcp-server-weaviate | Weaviate + chat memory |
| **Milvus MCP** | zilliztech/mcp-server-milvus | Milvus / Zilliz |
| **Pinecone MCP** | [zx8086/pinecone-vector-db-mcp-server](https://github.com/zx8086/pinecone-vector-db-mcp-server) | Pinecone |
| **ChromaDB MCP** | [chroma-core/chroma-mcp](https://github.com/chroma-core/chroma-mcp) | ChromaDB (official) |
| **LTC-RAG** | [Lvigentini/LTC-RAG-MCP](https://github.com/Lvigentini/LTC-RAG-MCP) | Weaviate long-term |

---

### 8. Graph Database Backends

MCP servers using graph databases for relationship-rich memory.

| Server | Repository | Backend |
|--------|------------|---------|
| **Memento** | [gannonh/memento-mcp](https://github.com/gannonh/memento-mcp) | Neo4j (graph + vector unified) |
| **Graphiti/Zep** | [getzep/graphiti](https://github.com/getzep/graphiti) | Neo4j, FalkorDB, Neptune, Kuzu |
| **Neo4j Agent Memory** | [knowall-ai/mcp-neo4j-agent-memory](https://github.com/knowall-ai/mcp-neo4j-agent-memory) | Neo4j with relationship patterns |
| **DevFlow** | [Takin-Profit/devflow-mcp](https://github.com/Takin-Profit/devflow-mcp) | SQLite + sqlite-vec |
| **Zettelkasten** | [anivenk25/Zettelkasten](https://github.com/anivenk25/Zettelkasten) | Pinecone + Neo4j hybrid |
| **Knowledge Graph** | [aiuluna/knowledge-graph-mcp](https://github.com/aiuluna/knowledge-graph-mcp) | Visualization + management |

---

### 9. Multi-Database Support

Servers supporting multiple database backends.

| Server | Repository | Supported Backends |
|--------|------------|-------------------|
| **mcp-database-server** | [Nam088/mcp-database-server](https://github.com/Nam088/mcp-database-server) | PostgreSQL, MySQL, SQLite, Redis, MongoDB, LDAP |
| **rag-memory-mcp-postgresql** | [thiago4go/rag-memory-mcp-postgresql](https://github.com/thiago4go/rag-memory-mcp-postgresql) | SQLite (default) + PostgreSQL |
| **Memory Forge** | [cpretzinger/memory-forge](https://github.com/cpretzinger/memory-forge) | PostgreSQL + Redis + Qdrant |

---

### 10. Lightweight/Local-First Solutions

Simple, portable memory solutions.

| Server | Repository | Storage |
|--------|------------|---------|
| **Local Memory** | [cunicopia-dev/local-memory-mcp](https://github.com/cunicopia-dev/local-memory-mcp) | SQLite + FAISS + Ollama |
| **Claude Memory** | [@whenmoon-afk/memory-mcp](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp) | SQLite + FTS5 (single .db file) |
| **Simple Memory** | [AojdevStudio/simple-memory-mcp](https://github.com/AojdevStudio/simple-memory-mcp) | JSON file persistence |
| **mcp-local-memory** | [@NickSmet/mcp-local-memory](https://smithery.ai/server/@NickSmet/mcp-local-memory) | SQLite + embeddings, zero setup |
| **Memory MCP** | [JamesANZ/memory-mcp](https://github.com/JamesANZ/memory-mcp) | Multi-LLM support, simple storage |

---

### 11. Episodic Memory Specialists

Focused on conversation/session history.

| Server | Repository | Features |
|--------|------------|----------|
| **Episodic Memory** | [obra/episodic-memory](https://github.com/obra/episodic-memory) | Preserves "why", vector embeddings, Claude Code plugin |
| **ChatDB** | [Svtter/chatdb](https://github.com/Svtter/chatdb) | SQLite conversation recording |
| **Conversation Memory** | [thuhoai27/text-memory](https://github.com/thuhoai27/text-memory) | Conversational context maintenance |
| **MARM Systems** | [Lyellr88/MARM-Systems](https://github.com/Lyellr88/MARM-Systems) | Multi-agent coordination, session continuity |

---

### 12. Agent & Companion Memory

For AI assistants and personal companions.

| Server | Repository | Use Case |
|--------|------------|----------|
| **PA AI Agent** | [zhangzhongnan928/mcp-pa-ai-agent](https://github.com/zhangzhongnan928/mcp-pa-ai-agent) | Personal assistant (calendar, tasks, email) |
| **Super Agent Party** | [heshengtao/super-agent-party](https://github.com/heshengtao/super-agent-party) | AI companion, long-term memory, multi-voice |
| **Mode Manager** | [NiclasOlofsson/mode-manager-mcp](https://github.com/NiclasOlofsson/mode-manager-mcp) | Personal + workspace memory |
| **Agentic Tools** | [Pimzino/agentic-tools-mcp](https://github.com/Pimzino/agentic-tools-mcp) | Task management + agent memories |

---

### 13. Language/Implementation Variants

Different language implementations.

| Language | Server | Repository |
|----------|--------|------------|
| **Go** | memory-mcp-server-go | [okooo5km/memory-mcp-server-go](https://github.com/okooo5km/memory-mcp-server-go) |
| **Go** | mcp-memory-libsql-go | [ZanzyTHEbar/mcp-memory-libsql-go](https://github.com/ZanzyTHEbar/mcp-memory-libsql-go) |
| **Rust** | mcp-memory-server | [rbownes/mcp-memory-server](https://github.com/rbownes/mcp-memory-server) |
| **Swift** | memory-mcp-server | [okooo5km/memory-mcp-server](https://github.com/okooo5km/memory-mcp-server) |
| **Kotlin** | mcp-obsidian-kotlin | [ue-sho/mcp-obsidian-kotlin](https://github.com/ue-sho/mcp-obsidian-kotlin) |
| **Python** | mcp-memory | [mcp-memory PyPI](https://pypi.org/project/mcp-memory/) |

---

### 14. Supabase & Cloud Database

Cloud-backed memory solutions.

| Server | Repository | Features |
|--------|------------|----------|
| **Supabase MCP** | [supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp) | Official, connects to Supabase projects |
| **Query MCP** | [alexander-zuev/supabase-mcp-server](https://github.com/alexander-zuev/supabase-mcp-server) | SQL, schema management, migrations |
| **MCP Brain** | TensorBlock list | Supabase for cross-installation knowledge graphs |
| **Cloudflare Memory** | [Puliczek/mcp-memory](https://github.com/Puliczek/mcp-memory) | Cloudflare Workers, D1, Vectorize |

---

### 15. Specialized Memory Types

Unique memory approaches.

| Server | Repository | Specialty |
|--------|------------|-----------|
| **Memora** | [agentic-mcp-tools/memora](https://github.com/agentic-mcp-tools/memora) | LLM deduplication, memory linking, hybrid search |
| **Ultimate MCP** | [Dicklesworthstone/ultimate_mcp_server](https://github.com/Dicklesworthstone/ultimate_mcp_server) | Consolidation, reflection, relevance optimization |
| **Think Tank** | [flight505/mcp-think-tank](https://github.com/flight505/mcp-think-tank) | Structured thinking + knowledge graphs |
| **Mind Palace** | [andrewginns/mcp-mind-palace](https://github.com/andrewginns/mcp-mind-palace) | ChromaDB-based searchable knowledge |
| **Arc Memory** | [Arc-Computer/arc-mcp-server](https://github.com/Arc-Computer/arc-mcp-server) | Temporal knowledge graphs for development |

---

## PyPI Packages Summary

| Package | Description |
|---------|-------------|
| `mem0-mcp-server` | Official Mem0 MCP wrapper |
| `mcp-memory` | Python memory implementation |
| `memory-mcp` | Alternative Python implementation |
| `basic-memory` | Zettelkasten + knowledge graphs |
| `mcp-server-qdrant` | Qdrant vector search |
| `mcp-neo4j-memory` | Neo4j graph integration |
| `chroma-mcp-server` | ChromaDB integration |
| `powermem-mcp` | PowerMem memory management |

---

## NPM Packages Summary

| Package | Description |
|---------|-------------|
| `@modelcontextprotocol/server-memory` | Official Anthropic server |
| `@mem0/mcp-server` | Official Mem0 server |
| `@sylweriusz/mcp-neo4j-memory-server` | Neo4j with batch operations |
| `@whenmoon-afk/memory-mcp` | SQLite + FTS5, zero-cloud |
| `@movibe/memory-bank-mcp` | Markdown-based project context |
| `@nmeierpolys/mcp-structured-memory` | Domain-specific markdown |
| `mcp-memory-keeper` | Context preservation for Claude Code |

---

## Key Metrics Discovered

### Performance Benchmarks

| Solution | Retrieval Latency | Token Savings |
|----------|------------------|---------------|
| MCP Memory Service | ~5ms | 90% via Code Execution API |
| Graphiti/Zep | P95 < 300ms | Hybrid retrieval |
| Mem0 | 91% faster | 90% reduction |
| MemMachine v0.2 | Top LOCOMO scores | Substantial reduction |

### Ecosystem Size

| Platform | Memory Servers Found |
|----------|---------------------|
| GitHub | 80+ repositories |
| awesome-mcp-servers list | 260+ in knowledge category |
| PulseMCP | 198 memory servers |
| Smithery | 15+ memory servers |
| Glama | 20+ memory servers |
| NPM | 15+ packages |
| PyPI | 8+ packages |

---

## Feature Comparison Matrix

| Feature | Official | Graphiti | Mem0 | Basic Memory | Cursor10x | CortexGraph |
|---------|----------|----------|------|--------------|-----------|-------------|
| Knowledge Graph | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Vector Search | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Temporal Tracking | ❌ | ✅✅ | ✅ | ❌ | ✅ | ✅✅ |
| Decay/Forgetting | ❌ | ✅ | ❌ | ❌ | ❌ | ✅✅ |
| Auto-Extraction | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Code Awareness | ❌ | ❌ | ❌ | ❌ | ✅✅ | ❌ |
| Self-Editing | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Markdown Export | ❌ | ❌ | ❌ | ✅✅ | ❌ | ✅ |
| Multi-User | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Obsidian Compatible | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |

---

## Unique Innovations Found

### 1. **CortexGraph's Forgetting Curves**
Implements Ebbinghaus forgetting with reinforcement on access - memories naturally fade unless used.

### 2. **Hexis Multi-Layer Memory**
Four distinct memory types (episodic, semantic, procedural, strategic) mimicking human cognition.

### 3. **Memory-Bank's Probabilistic Recall**
Uses probability functions where higher retrievability = greater chance of recall, mimicking human uncertainty.

### 4. **Episodic Memory's "Why" Preservation**
"Code comments explain what, documentation explains how, but episodic memory preserves why."

### 5. **Mem0's Auto-Extraction**
Automatically identifies and stores preferences, decisions, and patterns without explicit commands.

### 6. **Graphiti's Bi-Temporal Model**
Tracks both event occurrence time AND ingestion time for accurate point-in-time queries.

---

## Recommendations for Just-Command

Based on this extended research, the ideal Just-Command memory system should combine:

### Must-Have Features
1. **Hybrid Storage**: SQLite + sqlite-vec (portable, fast)
2. **Knowledge Graph**: Entities + relations + observations
3. **Semantic Search**: Vector embeddings for meaning-based retrieval
4. **Temporal Tracking**: When learned, last accessed, decay scores

### Should-Have Features
5. **Forgetting Curves**: Ebbinghaus-inspired decay with reinforcement
6. **Auto-Extraction**: Detect preferences, decisions, patterns
7. **Code Awareness**: Function/class relationships, conventions

### Nice-to-Have Features
8. **Markdown Export**: Human-readable, Obsidian-compatible
9. **Multi-Tier Memory**: Working + long-term + archival
10. **Dream Consolidation**: Background maintenance and compression

### Unique Differentiator
**Combine CortexGraph's forgetting curves + Mem0's auto-extraction + Cursor10x's code awareness** - no existing server has all three.

---

## References

### Curated Lists
- [TensorBlock/awesome-mcp-servers](https://github.com/TensorBlock/awesome-mcp-servers/blob/main/docs/knowledge-management--memory.md) - 260+ servers
- [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)
- [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers)

### Marketplaces
- [PulseMCP Memory Servers](https://www.pulsemcp.com/servers?q=memory) - 198 servers
- [Smithery Memory Category](https://smithery.ai/)
- [Glama Knowledge & Memory](https://glama.ai/mcp/servers/categories/knowledge-and-memory)
- [mcp.so Knowledge-and-Memory](https://mcp.so/servers?category=knowledge-and-memory)

### Research
- [Agent Memory Paper List](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)
- [MCP Server Evaluation Report](https://arxiv.org/html/2504.11094v1)
- [MCPBench](https://github.com/modelscope/MCPBench)
