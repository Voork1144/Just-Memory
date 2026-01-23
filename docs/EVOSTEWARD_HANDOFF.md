# EvoSteward Feature Transfer Handoff

> **Date:** January 23, 2026
> **Purpose:** Document features to be transferred from Just-Memory to EvoSteward
> **Status:** Planning Phase

---

## Executive Summary

Just-Memory (MCP server) and EvoSteward have different architectural capabilities:
- **MCP = Reactive** - Claude calls tools, tools respond
- **EvoSteward = Proactive** - Can run background tasks, monitor, predict, push

Features requiring background processing or proactive behavior belong in EvoSteward.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   EvoSteward                         │
│         (Orchestration - Always Running)            │
│  ┌─────────────────────────────────────────────────┐│
│  │ • Memory decay daemon (Ebbinghaus curves)       ││
│  │ • Proactive retrieval (predict → push)          ││
│  │ • Offline consolidation ("sleep" cycles)        ││
│  │ • Health monitoring & auto-cleanup              ││
│  │ • Intent prediction & pre-loading               ││
│  │ • Reality feedback loop (track outcomes)        ││
│  └─────────────────────────────────────────────────┘│
│                       ↕ SQLite DB (shared)          │
│  ┌─────────────────────────────────────────────────┐│
│  │         Just-Memory MCP Server                   ││
│  │ • Memory CRUD (store/recall/search/delete)      ││
│  │ • Knowledge graph (entities/relations)          ││
│  │ • Confidence scoring (metadata)                 ││
│  │ • Bi-temporal queries                           ││
│  │ • Working memory/scratchpad                     ││
│  │ • Contradiction detection (on-demand)           ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
           ↕ MCP Protocol
┌─────────────────────────────────────────────────────┐
│       Claude Desktop / Claude.ai / MCP Client       │
└─────────────────────────────────────────────────────┘
```

---

## Features to Transfer to EvoSteward

### 1. Memory Decay Daemon (Ebbinghaus Curves)

**Why EvoSteward:** Requires continuous background processing

**Functionality:**
- Run decay calculations periodically (e.g., hourly)
- Apply Ebbinghaus forgetting curves to memory strength
- Archive memories below threshold (strength < 0.1)
- Reinforce accessed memories

**Implementation:**
```python
# Decay formula
strength = initial_strength * e^(-time_elapsed / half_life)

# Schedule
- Hourly: Update strength scores
- Daily: Archive weak memories
- Weekly: Consolidate similar memories
```

---

### 2. Proactive Retrieval (Predict + Push)

**Why EvoSteward:** MCP cannot push information to Claude unprompted

**Functionality:**
- Track access patterns: "User asks X after Y"
- Predict what memories will be needed
- Pre-load relevant context before Claude needs it
- Push briefings at session start

---

### 3. Offline Consolidation ("Sleep" Cycles)

**Why EvoSteward:** Background processing during idle time

**Functionality:**
- Detect idle periods (no Claude activity)
- Merge similar/duplicate memories
- Extract patterns from episodic → semantic
- Clean up orphaned data

---

### 4. Health Monitoring & Auto-Cleanup

**Why EvoSteward:** Continuous monitoring, scheduled maintenance

**Functionality:**
- Monitor database size and growth rate
- Track query performance
- Alert on anomalies
- Auto-archive old/unused memories
- Vacuum database periodically

---

### 5. Reality Feedback Loop

**Why EvoSteward:** Track outcomes over time, validate predictions

**Critical Insight:**
> Memory must REINFORCE weights (reality), not erode them.
> LLMs never see consequences. EvoSteward can track them.

**Functionality:**
- Store predictions with expected outcomes
- Track if predictions came true
- Adjust confidence scores based on track record
- Flag memories that led to wrong outcomes

---

## Features Staying in Just-Memory

| Feature | Reason |
|---------|--------|
| Memory CRUD | Reactive, Claude-initiated |
| Knowledge graph | Data operations, no background needed |
| Confidence scoring | Metadata, set on store/update |
| Bi-temporal queries | Query logic only |
| Working memory | Session-scoped, ephemeral |
| Contradiction detection | On-demand check |
| Search (BM25 + vector) | Reactive query |
| Backup/restore | User-initiated |

---

## Shared Resources

- **SQLite Database:** `~/.claude-memory/memory.db`
- **Config:** `~/.evosteward/config.yaml`
- **Locking:** SQLite WAL mode handles concurrent access

---

## Implementation Priority

| Phase | Feature | Complexity | Impact |
|-------|---------|------------|--------|
| 1 | Memory decay daemon | Medium | High |
| 2 | Health monitoring | Low | Medium |
| 3 | Proactive retrieval | High | High |
| 4 | Offline consolidation | Medium | Medium |
| 5 | Reality feedback loop | High | Critical |

---

## References

- Memory ID: `897c26f8c2b6ef266eee029104cf6090`
- Just-Memory: `C:/Users/ericc/Just-Memory/`
- EvoSteward: `C:/Users/ericc/Desktop/Project/EvoSteward/`
