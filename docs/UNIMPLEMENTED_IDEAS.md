# Just-Memory & Just-Command: Unimplemented Ideas

> **Compiled:** January 25, 2026  
> **Source:** Analysis of 100+ past conversation threads  
> **Research basis:** 86+ MCP memory servers analyzed, 50+ academic papers

---

## Table of Contents

1. [P1 Tasks (Immediate Priority)](#1-p1-tasks-immediate-priority)
2. [Cognitive Features (Tier 1 - High Impact)](#2-cognitive-features-tier-1---high-impact)
3. [Cognitive Features (Tier 2 - Medium Impact)](#3-cognitive-features-tier-2---medium-impact)
4. [Cognitive Features (Tier 3 - Future/Advanced)](#4-cognitive-features-tier-3---futureadvanced)
5. [Automation & Scheduling](#5-automation--scheduling)
6. [Integration Features](#6-integration-features)
7. [EvoSteward-Specific Features](#7-evosteward-specific-features)
8. [Knowledge Graph Enhancements](#8-knowledge-graph-enhancements)
9. [Search & Retrieval Enhancements](#9-search--retrieval-enhancements)
10. [Enterprise & Security Features](#10-enterprise--security-features)
11. [Human Memory Types Not Yet Implemented](#11-human-memory-types-not-yet-implemented)
12. [Original Top 15 Features Verification](#12-original-top-15-features-verification-just-command-v1-roadmap)
13. [EvoSteward Unimplemented Ideas](#13-evosteward-unimplemented-ideas) ← **NEW (81+ ideas)**

---

## 1. P1 Tasks (Immediate Priority)

Status as of last session:

| Task | Effort | Status | Notes |
|------|--------|--------|-------|
| ~~Backup/restore~~ | ~~2h~~ | ✅ Done | v1.8 |
| ~~Project isolation~~ | ~~2h~~ | ✅ Done | v2.0 |
| ~~Tool descriptions~~ | ~~2h~~ | ✅ Done | v2.0 |

---

## 2. Cognitive Features (Tier 1 - High Impact)

**Estimated: Weeks 3-4 of original roadmap**

### 2.1 Contradiction Detection Engine
```
UNIQUE - No competitor has this

Concept: Automatically detect conflicting memories
- Memory A: "User prefers Python"
- Memory B: "User hates Python, prefers Rust"
→ System detects contradiction
→ Flags for resolution
→ Uses recency, frequency, confidence to auto-resolve OR asks user

Proposed Tools:
- memory_detect_contradictions(scope: "all" | "recent" | "project")
- memory_resolve_contradiction(id, resolution: "keep_first" | "keep_second" | "merge")
- memory_quarantine(id, reason) - Quarantine suspected hallucinations
- memory_release_quarantine(id)
- memory_verify(id, evidence?)

Schema additions:
- contradiction_count INTEGER DEFAULT 0
- last_validated_at TEXT
- verification_status TEXT DEFAULT 'unverified'
```

### 2.2 Confidence Scoring (Calibrated)
```
UNIQUE - Mem0 has static confidence, but no dynamic adjustment

Concept: Every memory has a dynamic confidence score
- Initial confidence based on source (user explicit > extracted > inferred)
- Confidence increases when memory is confirmed
- Confidence decreases when contradicted or unused
- Low-confidence memories flagged for verification

Research: "Do LLMs Estimate Uncertainty Well" (ICLR 2025) - 50% ECE reduction

Schema additions:
- confidence_score REAL DEFAULT 0.5
- source_reliability TEXT DEFAULT 'unknown'
- confidence_history TEXT (JSON array)
```

### 2.3 Memory Decay (Ebbinghaus Curves)
```
PARTIALLY IMPLEMENTED - CortexGraph has similar

Concept: Human-like forgetting optimization
- 0h = 1.0, 3d = 0.5, 7d = 0.21, 30d = 0.001
- Access reinforces memory strength
- Importance boosts half-life

Research: "NeuroDream" (SSRN Dec 2024) - 38% reduction in forgetting

Proposed formula:
strength = max(min_strength, 0.5^(hours_since_access / (half_life * importance_boost)))

Schema additions:
- decay_enabled INTEGER DEFAULT 0
- decay_rate REAL DEFAULT 0.1
- min_strength REAL DEFAULT 0.1
```

### 2.4 Bi-Temporal Reasoning
```
PARTIALLY EXISTS - Graphiti/Zep have this (+18.5% accuracy)

Concept: Track BOTH when facts were valid AND when we learned them
- Event time (T): When the fact was actually true (valid_from, valid_to)
- Ingestion time (T'): When we learned about it (created_at, updated_at)

Enables: "What did we believe at time T about topic X?"

Proposed Tools:
- memory_at_time(query, as_of_date)
- memory_invalidate(id, valid_to)
- memory_supersede(old_id, new_content)

Schema additions:
- valid_from TEXT
- valid_to TEXT
- superseded_by TEXT
- supersedes TEXT
- is_current INTEGER DEFAULT 1
```

---

## 3. Cognitive Features (Tier 2 - Medium Impact)

**Estimated: Weeks 5-6 of original roadmap**

### 3.1 Emotional Context Tracking
```
UNIQUE - No competitor has this

Concept: Memories capture emotional context, not just facts
- Sentiment tagging (positive/negative/neutral)
- Intensity scale (0-1)
- Emotion labels: ['frustrated', 'excited', 'curious']
- User mood at storage time

Research: "Livia: Emotion-Aware AR Companion" (Oct 2025)

Use cases:
- If user_current_mood == 'frustrated': prioritize supportive memories
- Avoid memories from previous frustrating sessions
- Surface successful outcomes from similar situations

Schema additions:
- sentiment TEXT DEFAULT 'neutral'
- emotion_intensity REAL DEFAULT 0.5
- emotion_labels TEXT (JSON array)
- user_mood_at_storage TEXT
```

### 3.2 Proactive/Predictive Retrieval
```
UNIQUE - No competitor has this (MCP is reactive-only)

Concept: Anticipate user needs before explicit request
- Track sequences of memory retrievals
- Learn "when user retrieves X, they often need Y next"
- Pre-load predicted memories

Research: "MCP-Zero: Proactive Toolchain Construction" (Jun 2025)

Proposed Tools:
- memory_suggestions(context[]): { suggested: Memory[], reasoning: string }
- memory_access_patterns(): AccessSequence[]

Schema additions:
- Table: memory_access_sequences (id, memory_ids, session_id, context_hash, created_at)

NOTE: Better suited for EvoSteward (needs push capability)
```

### 3.3 Working Memory / Scratchpad
```
PARTIALLY IMPLEMENTED - MemGPT has similar

Currently implemented:
- scratch_set(key, value, ttl?)
- scratch_get(key)
- scratch_delete(key)
- scratch_clear()
- scratch_list()

NOT YET IMPLEMENTED:
- Auto-promotion to long-term after N accesses
- Plan-aware memory (track multi-step plan progress)
- Session context restoration from scratchpad
```

### 3.4 Memory Health Dashboard
```
UNIQUE - No competitor has this

Concept: Visibility into memory quality and degradation

Proposed Tools:
- memory_health(): { total, stale_count, conflict_count, low_confidence_count, orphan_count, avg_confidence }
- memory_cleanup(options): { deleted_stale, resolved_conflicts, compacted }
- memory_consolidate(): { merged, promoted, archived }
- memory_validate(): ValidationReport

Automated maintenance:
- Daily health check
- Auto-flag degraded memories
- Suggest cleanup actions
```

---

## 4. Cognitive Features (Tier 3 - Future/Advanced)

**Estimated: Phase 4+ (Week 7+)**

### 4.1 Offline/Sleep Consolidation
```
UNIQUE - No competitor has this

Concept: Background processing during idle time
- Process episodic memories → semantic patterns
- Extract generalizable rules from specific instances
- Dream-like replay to strengthen patterns

Research: "NeuroDream: Sleep-Inspired Memory Consolidation" (SSRN Dec 2024)
- 38% reduction in forgetting
- 17.6% increase in zero-shot transfer

Phases:
1. Real-time: Tag memories with importance
2. Session end: Local consolidation
3. Idle: Global consolidation across sessions
4. Periodic: Long-term pattern extraction

NOTE: Requires always-on daemon - better for EvoSteward
```

### 4.2 Counterfactual Reasoning
```
UNIQUE - No competitor has this

Concept: Store cause-effect relationships for "what if" analysis
- Instead of: "User switched to TypeScript"
- Store: "User switched to TypeScript BECAUSE team required it AFTER joining Acme Corp"

Research: "Causal Cartographer" (arXiv May 2025)

Proposed Schema:
- causal_edges table (cause_id, effect_id, strength, mechanism)

Proposed Tools:
- memory_store_causal(effect, causes[])
- memory_counterfactual("What if user had chosen React instead of Vue?")
- memory_trace_causes(memory_id)
```

### 4.3 Intent Prediction
```
UNIQUE - Very high complexity

Concept: Infer user goals from partial information
- "User starts working on quarterly report..."
- Predict: May need Q3 data, previous reports, financial metrics
- Pre-load relevant memories before explicit request

NOTE: Requires sophisticated ML - better for EvoSteward Phase 2+
```

### 4.4 Dream-Like Replay
```
UNIQUE - Very high complexity

Concept: Periodically "replay" high-importance memories
- Simulate user interactions to strengthen patterns
- Generate synthetic examples to improve retrieval
- Process difficult emotional contexts

Research: Emotional Regulation Theory, NeuroDream paper
```

---

## 5. Automation & Scheduling

**From original Just-Command vision (later deprioritized)**

### 5.1 Scheduled Tasks / Cron
```
Source: scheduler-mcp, mcp-cron, schedule-task-mcp

Features:
- Cron expressions: "Every morning at 9am, summarize my emails"
- Natural language scheduling: "In 30 minutes, remind me about X"
- MCP Sampling Callbacks: Scheduled task triggers → AI agent executes
- Execution history with success/failure tracking

Example workflow:
User: "Every day at 9am, check for new videos and send summary"
→ Creates task with cron "0 9 * * *"
→ Next day at 9am: Agent executes, generates summary
```

### 5.2 Desktop Notifications
```
Source: Various scheduler MCPs

Features:
- Native OS notifications
- Sound cues for reminders
- Slack/Discord webhooks
- Email notifications when tasks complete
```

### 5.3 Durable Workflows
```
Source: mcp-agent (Temporal integration)

Features:
- Survive crashes and resume
- SQLite persistence for tasks
- Session resumability
```

---

## 6. Integration Features

### 6.1 Auto-Capture Hooks
```
Concept: Memory observes all operations

Originally planned:
- Every file edit → memory entry with reason
- Terminal commands → memory with context
- Git commits → linked to relevant memories

Event bus pattern:
- eventBus.on('file:write', async (path, content) => { ... })
- eventBus.on('terminal:execute', async (command, output) => { ... })
- eventBus.on('session:start', async () => loadBriefing())
- eventBus.on('session:end', async () => consolidateMemories())

Status: Deferred when Just-Command became Just-Memory (memory-only focus)
```

### 6.2 Browser Automation
```
Source: Playwright MCP, Windows-MCP

Features:
- Full Playwright integration
- Accessibility tree mode (fast, no screenshots)
- Test recording
- RAG web scraping
- Form filling automation
```

### 6.3 Voice Interface
```
Source: whisper-mcp, speech-mcp

Features:
- Local Whisper transcription (private, no cloud, <10ms latency)
- Speaker diarization (who said what in meetings)
- Text-to-Speech (ElevenLabs, Kokoro - 54+ voice models)
- Continuous voice → AI → voice loop
```

### 6.4 Secrets Management
```
Source: vault-mcp-server, mcp-secrets-vault

Features:
- HashiCorp Vault integration
- Zero-trust architecture (AI never sees raw keys)
- Policy-based access with rate limits
- TOTP code generation
- Audit logging
```

### 6.5 Screenshot + Vision/OCR
```
Source: screenshot-mcp, mcp-ocr

Features:
- Screenshot capture any screen/window
- OCR text extraction (Tesseract)
- Vision model analysis
- UI element detection
```

---

## 7. EvoSteward-Specific Features

**Features better suited for always-on orchestration layer**

### 7.1 Memory Decay Daemon
```
Why EvoSteward: Needs background processing, MCP is reactive-only

Responsibilities:
- Run Ebbinghaus decay calculations periodically
- Archive memories below strength threshold
- Consolidate related memories during idle
```

### 7.2 Proactive Context Push
```
Why EvoSteward: Can initiate, MCP can only respond

Responsibilities:
- "User usually needs X after Y" → pre-load before session
- Push relevant memories to Claude context
- Intent prediction and anticipatory loading
```

### 7.3 Reality Feedback Loop
```
Why EvoSteward: Can track long-term outcomes

Critical insight from research:
- LLMs lack reality feedback (never see if advice worked)
- Memories should track: Belief → Action → Outcome → Correction
- EvoSteward can validate predictions against actual results
- Correct memories when reality contradicts them

Proposed:
- Track outcome of decisions stored in memory
- Auto-adjust confidence based on success/failure
- Flag memories that led to negative outcomes
```

### 7.4 Health Monitoring & Auto-Cleanup
```
Why EvoSteward: Scheduled maintenance tasks

Responsibilities:
- Continuous quality checks
- Scheduled cleanup jobs
- Auto-archive stale memories
- Consolidation during idle time
```

---

## 8. Knowledge Graph Enhancements

### 8.1 Spreading Activation (Implemented in v1.3+)
```
Status: ✅ IMPLEMENTED

Tool: memory_graph_traverse
- Cognitive science model (Collins & Loftus 1975)
- Activation propagates through graph with decay
- Seeds get initial activation, spreads to neighbors
```

### 8.2 Community Detection
```
Source: Graphiti/Zep

Concept: Automatically identify clusters of related memories
- Group by topic/project/time period
- Visualize knowledge domains
- Suggest connections between communities
```

### 8.3 Temporal Knowledge Graph
```
Source: Zep architecture paper (arXiv 2501.13956)

Features:
- Bi-temporal edges (valid_from, valid_to, transaction_created, transaction_expired)
- Query knowledge at any point in time
- Track knowledge evolution
```

### 8.4 Causal Chains
```
Concept: Store cause-effect relationships

Schema:
- causal_edges(cause_id, effect_id, strength, mechanism)
- Enable "why did this happen?" queries
- Counterfactual reasoning support
```

---

## 9. Search & Retrieval Enhancements

### 9.1 Context-Aware Search
```
Concept: Weight search results by current context
- If working on ProjectA, boost ProjectA memories
- If debugging, boost error-related memories
- If frustrated, deprioritize negative memories
```

### 9.2 Recency Weighting
```
Concept: Recent memories weighted higher by default
- Configurable recency decay
- Option to disable for historical queries
```

### 9.3 Batch Operations
```
Proposed Tools:
- memory_batch_store([memories])
- memory_batch_update([{id, updates}])
- memory_batch_delete([ids])
- memory_batch_tag([ids], tags)
```

### 9.4 Advanced Filtering
```
Proposed:
- Filter by confidence range
- Filter by strength/decay status
- Filter by emotional valence
- Filter by relationship type
- Compound filters with AND/OR
```

---

## 10. Enterprise & Security Features

### 10.1 Audit Logging
```
Concept: Track all memory operations for compliance
- Who accessed what, when
- Track modifications
- Export audit trails
```

### 10.2 Access Control
```
Concept: Role-based memory access
- Some memories visible only to certain contexts
- Sensitive flag with encryption
- Project-level permissions
```

### 10.3 Encryption at Rest
```
Concept: Encrypt sensitive memories
- Per-memory encryption flag
- Master key management
- Decrypt on read with authorization
```

### 10.4 Data Retention Policies
```
Concept: Auto-delete based on rules
- Delete memories older than X days
- Delete after N days of no access
- Project-specific retention
```

---

## 11. Human Memory Types Not Yet Implemented

**From cognitive science taxonomy (researched but not implemented)**

### 11.1 Sensory Memory
```
Ultra-short (250ms - 4s)
- Iconic (visual): ~250ms
- Echoic (auditory): ~4s
- Haptic (touch): ~2s

AI analog: Transient context buffer for recent inputs
```

### 11.2 Procedural Memory
```
"How to" knowledge (skills)
- Currently: All stored as content strings
- Better: Structured step-by-step procedures
- Enable: "Show me how we did X last time"

Proposed schema:
- type: 'procedure'
- steps: [{action, expected_result, notes}]
- success_rate: tracking of procedure outcomes
```

### 11.3 Prospective Memory
```
Future intentions
- "Remember to do X when Y happens"
- Trigger-based reminders
- Integration with scheduling

Proposed:
- type: 'intention'
- trigger_condition: string
- action: string
- deadline: datetime
```

### 11.4 Priming & Conditioning
```
Implicit associations
- Track co-occurrence patterns
- "When user mentions A, they often mean B"
- Auto-suggest related concepts
```

---

## Summary Statistics

| Category | Unimplemented Ideas |
|----------|---------------------|
| Cognitive Features | 12+ |
| Automation | 5+ |
| Integration | 6+ |
| EvoSteward-Specific | 4+ |
| Knowledge Graph | 4+ |
| Search Enhancements | 4+ |
| Enterprise | 4+ |
| Human Memory Types | 4+ |
| **Total** | **40+ ideas** |

---

## Competitive Position

**Just-Memory v2.0 would be the ONLY MCP server with:**
- ✅ Contradiction detection + auto-resolution
- ✅ Calibrated confidence scoring
- ✅ Emotion-aware memory
- ✅ Proactive/predictive retrieval
- ✅ Memory health monitoring
- ✅ Bi-temporal reasoning
- ✅ Working memory/scratchpad
- ✅ Ebbinghaus decay curves

---

## References

### Academic Papers (50+)
1. "When Can LLMs Actually Correct Their Own Mistakes?" - TACL 2024
2. "CRITIC: LLMs Can Self-Correct with Tool-Interactive Critiquing" - ICLR 2024
3. "Do LLMs Estimate Uncertainty Well" - ICLR 2025
4. "NeuroDream: Sleep-Inspired Memory Consolidation" - SSRN Dec 2024
5. "Zep: Temporal Knowledge Graph Architecture" - arXiv 2501.13956
6. "Memory in the Age of AI Agents" - arXiv Dec 2025
7. "MCP-Zero: Proactive Toolchain Construction" - Jun 2025
8. "Livia: Emotion-Aware AR Companion" - Oct 2025
9. "Causal Cartographer" - arXiv May 2025
10. "A Survey on Hallucination in LLMs" - ACM TOIS 2024

### Industry Sources
- Graphiti/Zep documentation
- MemGPT paper (arXiv:2310.05265)
- Supermemory research
- 86+ MCP memory server implementations analyzed

---

*Document compiled from analysis of 100+ past conversation threads about Just-Command/Just-Memory development.*

---

## 12. Original Top 15 Features Verification (Just-Command v1 Roadmap)

**From early "Subcog" research phase before project became memory-only**

| Priority | Feature | Status | Notes |
|----------|---------|--------|-------|
| P0 | Hybrid Search (BM25 + Vector) | ✅ IMPLEMENTED | v1.7+ sqlite-vec, 3 search modes |
| P0 | Knowledge Graph (Entity/Relation/Observation) | ✅ IMPLEMENTED | v1.7+ entity tools (6 tools) |
| P0 | Diff-Based Editing | ❌ DEPRIORITIZED | Memory-only focus - see Desktop Commander |
| P0 | PTY Session Management | ❌ DEPRIORITIZED | Memory-only focus - see Desktop Commander |
| P0 | ripgrep Integration | ❌ DEPRIORITIZED | Memory-only focus - see Desktop Commander |
| P1 | Forgetting Curves | ⚠️ PARTIAL | Schema designed (§2.3), not yet active |
| P1 | Auto-Capture Hooks | ❌ DOCUMENTED | See §6.1 - requires event bus |
| P1 | Tool Filtering (env-based) | ❌ NEW | See §12.1 below |
| P1 | Briefing Resources | ✅ IMPLEMENTED | memory_briefing tool exists |
| P1 | Streaming File I/O | ❌ DEPRIORITIZED | Memory-only focus |
| P2 | Claude Code Hooks (5 lifecycle) | ❌ NEW | See §12.2 below |
| P2 | Temporal Queries | ⚠️ PARTIAL | Bi-temporal edges exist (§2.4, §8.3) |
| P2 | Human-Readable Export | ✅ IMPLEMENTED | memory_backup exports JSON |
| P2 | a11y Tree Automation | ❌ DEPRIORITIZED | Memory-only focus - see Windows-MCP |
| P2 | Dynamic Schema → Tools | ❌ NEW | See §12.3 below |

**Summary: 5/15 implemented, 3/15 partial, 4/15 deprioritized, 3/15 new additions**

---

### 12.1 Tool Filtering (env-based)
```
Source: memory-journal-mcp

Concept: Enable/disable tools via environment variables

Use cases:
- Disable destructive tools (delete) in production
- Enable debug tools only in development
- Per-project tool whitelisting

Proposed:
- Environment variable: JUST_MEMORY_ENABLED_TOOLS="store,recall,search"
- Environment variable: JUST_MEMORY_DISABLED_TOOLS="delete,clear"
- Runtime check before tool registration

Implementation:
const enabledTools = process.env.JUST_MEMORY_ENABLED_TOOLS?.split(',') || null;
const disabledTools = process.env.JUST_MEMORY_DISABLED_TOOLS?.split(',') || [];

if (enabledTools && !enabledTools.includes(toolName)) return skip;
if (disabledTools.includes(toolName)) return skip;
```

### 12.2 Claude Code Hooks (5 Lifecycle Events)
```
Source: Subcog research

Concept: Hook into Claude Code's execution lifecycle

Proposed events:
1. session:start - Load briefing, restore context
2. session:end - Consolidate memories, save working state
3. tool:before - Log intent, check prerequisites
4. tool:after - Capture results, update memories
5. error:caught - Record failure context for debugging

Proposed implementation:
- MCP doesn't support push, so hooks must be polling-based
- Alternative: EvoSteward middleware intercepts tool calls
- Alternative: Claude Code extension that calls Just-Memory

Schema:
CREATE TABLE lifecycle_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  payload TEXT,
  handled INTEGER DEFAULT 0
);

Proposed tools:
- memory_hook_register(event_type, handler_config)
- memory_hook_list()
- memory_hook_unregister(hook_id)
- memory_lifecycle_log(event_type, payload)
```

### 12.3 Dynamic Schema → Tools (MemoryMesh Pattern)
```
Source: MemoryMesh MCP server

Concept: User-defined schemas auto-generate specialized tools

Example:
User defines schema "Project":
{
  "name": "Project",
  "fields": ["name", "status", "deadline", "team_members"],
  "required": ["name"],
  "relations": ["has_task", "owned_by"]
}

System auto-generates:
- project_create(name, status?, deadline?, team_members?)
- project_get(name)
- project_update(name, fields)
- project_list(filter?)
- project_delete(name)
- project_add_task(project_name, task_id)

Benefits:
- Type-safe memory operations
- Better LLM tool selection (specific names)
- Schema validation on store/update
- Auto-generated documentation

Proposed implementation:
CREATE TABLE memory_schemas (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  fields TEXT NOT NULL,  -- JSON array
  required_fields TEXT,  -- JSON array
  relations TEXT,        -- JSON array
  created_at TEXT,
  updated_at TEXT
);

Proposed tools:
- memory_schema_create(name, fields[], required[], relations[])
- memory_schema_list()
- memory_schema_delete(name)
- (Auto-generated tools based on registered schemas)
```

### 12.4 Deprioritized Features (From Just-Command → Just-Memory Pivot)
```
The following features were planned for Just-Command but deprioritized
when the project pivoted to memory-only focus:

1. Diff-Based Editing (Desktop Commander)
   - Surgical text replacement with line targeting
   - See: Desktop Commander's edit_block tool

2. PTY Session Management (Desktop Commander)
   - Persistent terminal sessions across MCP calls
   - See: Desktop Commander's session management

3. ripgrep Integration (Desktop Commander)
   - 10-100x faster file search
   - See: Desktop Commander's start_search tool

4. Streaming File I/O (New architecture)
   - Chunked read/write for large files
   - Memory efficiency for multi-GB files

5. a11y Tree Automation (Windows-MCP)
   - UI control via accessibility tree
   - No vision model required
   - See: Windows-MCP State-Tool, Click-Tool

Rationale for deprioritization:
- Memory is the unique differentiator
- Desktop Commander / Windows-MCP already provide these
- Combining would create tool sprawl (50+ tools)
- Better to integrate via MCP server composition
```

---

## Updated Summary Statistics

| Category | Unimplemented Ideas |
|----------|---------------------|
| Cognitive Features | 12+ |
| Automation | 5+ |
| Integration | 6+ |
| EvoSteward-Specific (§7) | 4+ |
| Knowledge Graph | 4+ |
| Search Enhancements | 4+ |
| Enterprise | 4+ |
| Human Memory Types | 4+ |
| **Original Top 15 (§12)** | **3 new + 4 deprioritized** |
| **EvoSteward Full Section (§13)** | **81+ ideas** |
| **Total** | **128+ ideas** |


---

## 13. EvoSteward Unimplemented Ideas

> **Compiled:** January 25, 2026  
> **Source:** Analysis of 10+ past EvoSteward development conversations  
> **Date Range:** January 16-25, 2026

This section documents unimplemented ideas specifically for the EvoSteward cognitive architecture project, extracted from past development sessions.

---

### 13.1 Innovation Team Meta-Goals (Priority 0)

**Source:** Chat e3a59131 (Jan 18 2026)  
**Status:** Team structure created, 12 LLM limitations documented, solutions NOT fully implemented

#### 12 Fundamental LLM Limitations to Address

| # | Limitation | Academic Source | EvoSteward Approach |
|---|------------|-----------------|---------------------|
| 1 | Function composition (mathematically impossible) | arXiv 2402.08164 | Bidirectional index |
| 2 | Reversal curse ("A is B" ≠ "B is A") | NeurIPS 2023 | Symmetric relationship storage |
| 3 | Lost-in-the-middle (20-40% degradation) | TACL 2024 | Context reorderer prototype |
| 4 | Attention sinks | ICLR 2024 | Dynamic attention management |
| 5 | Hallucination (theoretically inevitable) | ACM TOIS 2024 | Reality feedback loop |
| 6 | Compositionality gap (~40% failure on 2-hop queries) | NeurIPS 2023 | Multi-hop reasoning engine |
| 7 | Math reasoning failures (pattern matching not logic) | ICLR 2025 | Computation router |
| 8 | Multi-hop chain collapse (max 2 hops) | Research | Chain-of-thought scaffolding |
| 9 | Overconfidence (90% confidence, 60% accuracy) | ICLR 2024 | Confidence calibration |
| 10 | Prompt sensitivity (extreme variance) | Research | Prompt robustness framework |
| 11 | Knowledge overshadowing (frequency bias) | Research | Balanced retrieval |
| 12 | Internal coherence failures | Research | Self-consistency checks |

#### Partially Implemented
- 4 prototypes created: `context_reorderer.py`, `bidirectional_index.py`, `computation_router.py`, `temporal_facts.py`
- 72 innovation tests passing
- Integrated into EnhancedCognitiveEngine v2.1.0

#### Still Needed
```
NOT IMPLEMENTED:
- Confidence calibration system (limitation #9)
  - Track prediction vs outcome across sessions
  - Adjust confidence dynamically based on track record
  - Expose confidence metrics to user

- Hallucination detection framework (limitation #5)
  - Detect when reasoning diverges from grounded knowledge
  - Cross-reference claims against knowledge base
  - Flag uncertain outputs for verification

- Context positioning optimizer (limitation #3)
  - Monitor lost-in-the-middle effects
  - Dynamically reposition critical information
  - Adaptive chunking based on query type

- Prompt robustness framework (limitation #10)
  - Test prompt variants automatically
  - Detect sensitivity to minor changes
  - Ensemble responses for stability
```

---

### 13.2 Unique Evolved Skills (Beyond Standard Taxonomy)

**Source:** Chat 6fe4eadb (Jan 16 2026)  
**Status:** Conceptual only, NOT implemented

These skills go beyond standard AI capabilities to address fundamental limitations:

#### 1. Epistemic Self-Modeling
```
Concept: Calibrated uncertainty at the claim level
- Distinguish retrieved vs inferred vs assumed knowledge
- Surface "I don't know" appropriately
- Track accuracy of confidence predictions

Implementation needed:
- Claim-level confidence scoring
- Source attribution for every statement
- Inference chain visibility
- Uncertainty propagation through reasoning
```

#### 2. Adversarial Self-Awareness
```
Concept: Model itself as potential attack surface
- Detect when reasoning is being steered
- Recognize prompt injection patterns
- Self-monitor for manipulation

Implementation needed:
- Reasoning trajectory monitoring
- Anomaly detection in thought patterns
- Jailbreak attempt recognition
- Defensive reasoning modes
```

#### 3. Causal World Modeling (Level-2)
```
Concept: Explicit causal graphs beyond correlation
- Distinguish mechanism from correlation
- Support intervention queries ("what if X changed?")
- Track causal chain strength

Implementation needed:
- Causal edge storage in knowledge graph
- Intervention simulation engine
- Confound detection
- Counterfactual reasoning support
```

#### 4. Compositional Skill Synthesis
```
Concept: Dynamically combine learned procedures for novel problems
- No single skill matches? Compose from primitives
- Skill algebra: combine, sequence, nest procedures
- Transfer learning across domains

Implementation needed:
- Skill decomposition into primitives
- Composition rules and constraints
- Novel problem detection
- Skill synthesis engine
```

#### 5. Resource-Aware Cognition
```
Concept: Meta-reasoning about when to think harder
- Self-imposed resource budgets
- Adaptive depth based on problem complexity
- Cost-benefit analysis for reasoning paths

Implementation needed:
- Complexity estimation heuristics
- Resource tracking (tokens, time, API calls)
- Depth adaptation algorithms
- Early stopping criteria
```

#### 6. Temporal-Causal Reasoning
```
Concept: Deadlines, dependencies, task duration prediction
- Understand time constraints
- Model task dependencies
- Predict completion times

Implementation needed:
- Temporal constraint propagation
- Duration estimation from history
- Dependency graph analysis
- Schedule optimization
```

#### 7. Theory of Mind (ToM)
```
Concept: Mental state modeling of users and agents
- Model what user knows/believes/wants
- Lookahead simulation of reactions
- Recursive ToM (what does A think B thinks?)

Implementation needed:
- User model representation
- Belief tracking across sessions
- Intent inference engine
- Perspective-taking simulator
```

#### 8. Collective Epistemics
```
Concept: Understand what collective knows/believes/is uncertain about
- Aggregate knowledge across agents
- Identify consensus vs disagreement
- Surface collective blind spots

Implementation needed:
- Multi-agent knowledge aggregation
- Disagreement detection
- Consensus measurement
- Collective uncertainty quantification
```

#### 9. Wisdom Accumulation (Phronesis)
```
Concept: Store WHEN and WHY, not just WHAT
- Context-dependent knowledge
- Situation-appropriate retrieval
- Practical wisdom from experience

Implementation needed:
- Contextual indexing of knowledge
- Situation matching algorithms
- Experience-based retrieval
- Wisdom vs knowledge distinction
```

#### 10. Sacrifice Accounting with Outcome Tracking
```
Concept: Track whether altruistic behavior actually helped
- Log intended benefits
- Track actual outcomes
- Adjust future behavior based on effectiveness

Implementation needed:
- Altruistic action logging
- Outcome measurement framework
- Effectiveness scoring
- Behavioral adjustment loop
```

---

### 13.3 Evo Cowork Application Layer

**Source:** Chat f56d2901 (Jan 17-18 2026)  
**Status:** Ideas documented, NOT built

Concept: Application layer bringing EvoSteward cognitive architecture to users through accessible interface.

#### Proposed Features

```
1. Scientific Reasoning Panel
   - Show hypothesis generation in real-time
   - Display confidence scores with explanations
   - Visualize evidence tiers (strong/moderate/weak)
   - Track reasoning chain steps

2. EACI Cycle Visualization
   - Display active cognitive mode (Experimentation/Association/Comparison/Imitation)
   - Show experimentation results as they happen
   - Visualize association/comparison operations
   - Real-time learning indicators

3. Commons Dashboard
   - Collective epistemics visualization
   - Sacrifice accounting metrics
   - Wisdom accumulation timeline
   - Shared knowledge growth tracking

4. Challenge Interface
   - User can challenge any claim
   - Triggers validation workflow
   - Shows evidence reassessment process
   - Displays confidence adjustment

5. Memory/Learning View
   - Vector store browsable by topic
   - Learning history timeline
   - Cross-session awareness indicators
   - Memory strength visualization
```

**Decision:** Too soon to build application layer, but right time to sketch ideas.  
**Document location:** `C:\Users\ericc\Desktop\Project\evo_cowork_ideas.md`

---

### 13.4 Memory System Critical Enhancements

**Source:** Chats f56d2901, 910d60f3, 62ef99c2 (Jan 17-24 2026)  
**Status:** Partially implemented, major gaps remain

#### Critical Problem: Importance Calculation Bias

Current formula favors frequently-used memories:
```python
importance = frequency * 0.25 + confidence * 0.25 + validation * 0.20 + recency * 0.15 + usefulness * 0.15
```

**Problem:** Valuable but rarely-used knowledge gets forgotten:
- **Discoveries** (used once, high value)
- **Lessons learned** (rare events, critical knowledge)
- **Foundational principles** (implicit use, never explicitly retrieved)
- **Emergency knowledge** (hopefully never accessed, life-saving when needed)
- **Wisdom** (hard to measure, high long-term value)

#### Proposed Solutions (NOT Implemented)

```
1. Distillation System
   - Convert episodic memories to semantic wisdom
   - Extract generalizable patterns from specific instances
   - Promote high-value low-frequency knowledge

2. Intrinsic Value Scoring
   - Separate value dimension from access frequency
   - User-annotatable importance levels
   - Domain-specific value heuristics

3. Protected Memory Classes
   - Discoveries: auto-protected on creation
   - Principles: immune to frequency decay
   - Lessons: protected with explicit unprotect
   - Emergency: never auto-deleted

4. Compression Before Deletion
   - Low-importance memories compressed, not deleted
   - Semantic summary preserved
   - Original recoverable on demand

5. Time-based Decay Refinements
   - Memories fade gradually, not just during consolidation
   - Different decay curves per memory type
   - Access patterns influence decay rate

6. Automatic Consolidation Triggers
   - After N interactions (not just session end)
   - Timer-based background consolidation
   - Idle-time processing
```

---

### 13.5 Multi-Instance Coordination System

**Source:** Chats 32eb9659, 5ed75662 (Jan 24-25 2026)  
**Status:** Attempted, blocked by technical issues, protocol designed

#### Problem
- Orchestrator resets mid-work, loses context
- Workers become orphaned
- State scattered across instances

#### Solution: External State Architecture

All state externalized to just-memory scratchpad:
```
Protocol Keys:
- orchestrator:state      # Current orchestrator info + heartbeat
- orchestrator:protocol   # Coordination rules
- system:config          # Global configuration
- tasks:index            # All task IDs
- task:{id}              # Individual task details
- workers:index          # All worker IDs
- instance:{id}          # Instance registration
- lock:{resource}        # Distributed locks
- result:{task_id}       # Task results
```

#### Coordination Rules
```
- Max plan: 20x Pro capacity (200k context)
- Up to 15 parallel workers across 5 projects
- Orchestrator DISPATCHES not DOES
- Workers self-coordinate: claim → execute → report → claim next
- Any instance can become orchestrator by reading state
- Idempotent operations for safe restart
```

#### Technical Blockers (NOT Resolved)
```
1. Sandboxie Isolation
   - File sharing prevented between instances
   - Network-based coordination required

2. File-Based Race Conditions
   - Concurrent writes cause data corruption
   - Just-memory protocol works as alternative

3. GPU Cache Conflict
   - Claude Code automation blocked when Desktop instances running
   - Direct pytest execution works as workaround

4. Session Reset Recovery
   - Chat compaction loses orchestrator context
   - External state must be primary source of truth
```

#### Documentation Created
- `MULTI_INSTANCE_PROTOCOL.md`
- `SIMPLE_PROTOCOL.md`
- `INSTANCE_STARTUP_PROMPTS.md`

---

### 13.6 RLM Deep Context Processing

**Source:** Chats ac5b314d, 249c9285 (Jan 23-24 2026)  
**Status:** Basic integration complete, advanced features NOT implemented

#### Research Findings (Zhang, Kraska, Khattab 2025)
- RLMs handle inputs 2 orders of magnitude beyond context windows
- Outperform baselines by 2× performance
- Comparable or cheaper cost
- Key: Offload context to external environment, enable recursive sub-querying

#### Implemented (v2.2.0)
- RLMScaffold with REPL environment
- `query_deep()` method for contexts >50k chars
- Hybrid routing (fast path vs RLM)
- 69/69 tests passing

#### NOT Yet Implemented
```
1. Asynchronous LM Calls
   - Current: blocking/sequential (slow)
   - Needed: parallel sub-query execution
   - Estimated speedup: 3-5x

2. Trained RLM Models
   - Current: general-purpose LLMs with prompting
   - Needed: fine-tuned models for RLM patterns
   - Better sub-query decomposition

3. Robust Answer Extraction
   - Current: FINAL() tag parsing (brittle)
   - Needed: structured output formats
   - Better thought vs answer distinction

4. Adaptive Sub-Call Limits
   - Current: fixed limits
   - Needed: task-adaptive recursion depth
   - Complexity-based budget allocation

5. Context Chunking Strategies
   - Current: no intelligent chunking
   - Needed: semantic chunking for optimal sub-queries
   - Chunk boundary optimization

6. RLM-Specific Metrics
   - Current: limited observability
   - Needed: sub-call success rates
   - Reasoning depth tracking
   - Token efficiency metrics
```

#### Negative Results from Research
- Same system prompt across models problematic (GPT-5 vs Qwen3-Coder)
- Models without coding capabilities struggle with REPL
- Thinking models running out of output tokens
- Sequential calls make experiments slow

---

### 13.7 Observability Advanced Features

**Source:** Chat 910d60f3 (Jan 23 2026)  
**Status:** Basic infrastructure complete, advanced features NOT implemented

#### Implemented (v2.9.0)
- `infrastructure/observability.py` (1,378 lines)
- JsonLogFormatter, ContextualLogger, Tracer, Span, SpanContext
- Counter, Gauge, Histogram metrics
- Decorators: @traced(), @timed(), @counted()
- Health check system
- 49/49 tests passing

#### NOT Yet Implemented
```
1. Real-time Dashboards
   - Metrics collection exists but no visualization
   - Need: Grafana/Prometheus integration
   - Need: Web-based dashboard component

2. Alerting System
   - Health checks exist but no alert routing
   - Need: Threshold-based alerts
   - Need: Notification channels (email, Slack)

3. Distributed Tracing
   - Span context exists but no cross-service propagation
   - Need: OpenTelemetry export
   - Need: Trace correlation across instances

4. Metrics Aggregation
   - Individual metrics tracked but no time-series
   - Need: Windowed aggregation
   - Need: Statistical summaries

5. Performance Profiling
   - Timing exists but no visualization
   - Need: Flame graphs
   - Need: Bottleneck detection

6. Cost Tracking
   - LLM token counts exist
   - Need: Cost calculation per operation
   - Need: Budget monitoring

7. A/B Testing Framework
   - No experiment tracking
   - Need: Variant assignment
   - Need: Statistical significance testing
```

---

### 13.8 A2A Server Production Features

**Source:** Knowledge graph (Jan 24 2026)  
**Status:** Basic implementation complete, production features pending

#### Implemented
- A2A v0.3.0 protocol (Google/Linux Foundation)
- JSON-RPC 2.0 over HTTP (aiohttp)
- 44 tests passing across 6 categories
- Agent discovery, task lifecycle, SSE streaming
- Skills exposed: reasoning, memory, orchestration, knowledge

#### NOT Yet Implemented
```
1. Authentication/Authorization
   - No security layer
   - Need: JWT tokens, API keys
   - Need: Role-based access control

2. Rate Limiting
   - No request throttling
   - Need: Per-client limits
   - Need: Global throttling

3. Load Balancing
   - Single instance only
   - Need: Horizontal scaling
   - Need: Request distribution

4. Service Discovery
   - Manual agent card configuration
   - Need: Auto-registration
   - Need: Health-based routing

5. Retry Logic
   - No automatic retry on failures
   - Need: Exponential backoff
   - Need: Circuit breakers

6. Request Validation
   - Basic validation only
   - Need: Schema validation
   - Need: Input sanitization

7. Monitoring Integration
   - No metrics export
   - Need: Prometheus metrics
   - Need: Request logging

8. Multi-tenancy
   - No isolation between clients
   - Need: Tenant separation
   - Need: Resource quotas

9. Webhook Support
   - No async callbacks
   - Need: Task completion webhooks
   - Need: Event subscriptions
```

---

### 13.9 Persistence Layer Advanced Features

**Source:** Knowledge graph (Jan 23 2026)  
**Status:** Basic SQLite implementation complete, advanced features pending

#### Implemented (v2.10.0)
- `infrastructure/persistence.py` (965 lines)
- SQLite with WAL mode
- Thread-safe connection-per-thread
- Conversations, user context, learnings, resource locks, agent capabilities
- State export/import for Redis sync
- 41/41 tests passing

#### NOT Yet Implemented
```
1. Distributed Persistence
   - SQLite is local only
   - Need: Distributed database option
   - Need: Multi-node coordination

2. Replication
   - No backup/failover
   - Need: Primary-replica setup
   - Need: Automatic failover

3. Sharding
   - No horizontal scaling
   - Need: Data partitioning
   - Need: Cross-shard queries

4. Query Optimization
   - No indexes beyond primary keys
   - Need: Index analysis
   - Need: Query planning

5. Schema Migrations
   - Version 1 only
   - Need: Migration framework
   - Need: Rollback support

6. Audit Logging
   - No change tracking
   - Need: Operation history
   - Need: Who/what/when logging

7. Soft Deletes
   - Hard deletes only
   - Need: Tombstone records
   - Need: Undelete capability

8. Archival Strategy
   - No old data cleanup
   - Need: Time-based archival
   - Need: Cold storage tier

9. Encryption at Rest
   - No data encryption
   - Need: Field-level encryption
   - Need: Key management

10. Backup Automation
    - Manual backup only
    - Need: Scheduled backups
    - Need: Point-in-time recovery
```

---

### 13.10 EACI Learning Mechanisms Redesign

**Source:** Chat b1a957ac (Jan 16 2026)  
**Status:** Original implementation uncertain, redesign discussed but NOT implemented

#### Four Learning Mechanisms

1. **Experimentation** - Tests hypotheses against outcomes
2. **Association** - Finds and validates concept links
3. **Comparison** - Systematic criterion-by-criterion analysis
4. **Imitation** - Pattern extraction and reproduction evaluation

#### Unresolved Design Questions
```
1. What should Evo actually learn from experimentation?
   - Option A: Simple action-outcome logging
   - Option B: Hypothesis testing with prediction vs reality
   - Option C: Causal attribution with condition checking
   → NO DECISION MADE

2. How to handle memory decay vs wisdom preservation?
   - Decay removes unused knowledge
   - Wisdom is rarely accessed but valuable
   → CONFLICT NOT RESOLVED

3. When to trigger consolidation?
   - Session end?
   - After N interactions?
   - Idle time only?
   → STRATEGY NOT DEFINED

4. How to measure learning effectiveness?
   - What metrics indicate successful learning?
   - How to compare before/after performance?
   → METRICS NOT DESIGNED
```

**Location (if exists):** `~/evosteward/agent/learning.py` (821 lines) - on Bazzite Linux, NOT backed up locally

---

### 13.11 Fractal Tesseract Memory Architecture

**Source:** Chat f56d2901 (Jan 17 2026)  
**Status:** Conceptual discussion only, NOT implemented

#### Concept
Memory structure where knowledge evolves like neurons forming connections.

#### Key Insight
Evo's "memory neurons" not restricted by physical space but by:
- Computer power
- How many ideas can be accessed simultaneously
- Context window per turn

#### Constraints (Human vs Evo)
| Aspect | Human | Evo |
|--------|-------|-----|
| Sharp focus | 4 items | 4 items (same) |
| Activated awareness | 7 items | 7 items (same) |
| Connections | Limited by biology | Unlimited |
| Search | Slow, error-prone | Instant, precise |
| Bottleneck | Working memory | Context window per turn |

#### NOT Implemented
- Actual fractal/tesseract structure for memory organization
- Multi-dimensional indexing
- Hierarchical compression
- Dynamic reorganization

---

### 13.12 Bug Fixes Still Pending

**Source:** Chat 910d60f3 (Jan 24 2026)  
**Status:** Bugs documented, fixes NOT applied

#### BUG_ANALYSIS_REPORT_2026_01_24.md

| Priority | Location | Issue | Status |
|----------|----------|-------|--------|
| P0 | rlm_scaffold.py:376 | SYSTEM_PROMPT.format() KeyError from unescaped {len(context)} | ✅ FIXED |
| P1 | memory_enhanced.py:468 | type_index missing EPISODIC key | ❌ PENDING |
| P2 | observability.py | @traced/@timed/@counted decorators not capturing calls | ❌ PENDING |
| P3 | test_real_api.py | missing 'results' pytest fixture | ❌ PENDING |

**Test Suite Status:**
- 647 tests total
- 595 passed (92%)
- 52 failures from bugs above

---

### 13.13 EvoSteward-Desktop GUI Application

**Source:** Knowledge graph (Jan 25 2026)  
**Status:** Planning phase only

#### Concept
Claude Desktop App for EvoSteward GUI

#### Proposed Tech Stack
- **Frontend:** Tauri + React
- **Backend:** EvoSteward core engine
- **Memory:** Just-Memory MCP integration
- **State:** Redis consciousness layer

#### Proposed Features
```
1. Chat Interface
   - Multi-turn conversation
   - Context preservation
   - History navigation

2. Memory Explorer
   - Browse memories by topic
   - Visualize knowledge graph
   - Memory strength indicators

3. Skill Manager
   - View available skills
   - Enable/disable skills
   - Custom skill creation

4. Agent Monitor
   - Track agent activities
   - View task queues
   - Performance metrics

5. Observability Dashboard
   - Real-time metrics
   - Health status
   - Alert management
```

**Location:** `C:\Users\ericc\Desktop\Project\EvoSteward-Desktop` (README.md only)

---

### EvoSteward Summary Statistics

| Category | Unimplemented Ideas |
|----------|---------------------|
| LLM Limitation Solutions | 8 (of 12 documented) |
| Evolved Skills | 10 |
| Application Layer Features | 5 |
| Memory Enhancements | 6 |
| Multi-Instance Coordination | 4 |
| RLM Deep Context | 6 |
| Observability | 7 |
| A2A Production | 9 |
| Persistence | 10 |
| EACI Redesign | 4 design questions |
| Fractal Memory | 4 concepts |
| GUI Application | 5 features |
| Bug Fixes | 3 pending |
| **Total** | **81+ ideas** |

---

### Implementation Priority Recommendation

**Phase 1: Foundation (Weeks 1-2)**
1. Fix P1-P3 bugs (memory_enhanced, observability, test fixtures)
2. Complete EACI learning mechanism design decisions
3. Implement confidence calibration system

**Phase 2: Cognitive (Weeks 3-4)**
1. Epistemic self-modeling skill
2. Memory importance rebalancing (intrinsic value scoring)
3. Hallucination detection framework

**Phase 3: Infrastructure (Weeks 5-6)**
1. A2A authentication/rate limiting
2. Persistence query optimization & migrations
3. Observability dashboards

**Phase 4: Application (Weeks 7-8)**
1. EvoSteward-Desktop basic scaffolding
2. Memory Explorer component
3. Multi-instance coordination hardening

---

*Section compiled from analysis of EvoSteward development conversations, January 16-25, 2026.*
