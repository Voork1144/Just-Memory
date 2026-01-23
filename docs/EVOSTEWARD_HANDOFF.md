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

**Implementation Notes:**
```python
# Decay formula
strength = initial_strength * e^(-time_elapsed / half_life)

# Decay schedule
- Every hour: Update strength scores
- Every day: Archive weak memories
- Every week: Consolidate similar memories
```

**Database Schema (shared):**
```sql
-- Add to Just-Memory schema
ALTER TABLE memories ADD COLUMN strength REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN last_decay_at TEXT;
```

---

### 2. Proactive Retrieval (Predict + Push)

**Why EvoSteward:** MCP cannot push information to Claude unprompted

**Functionality:**
- Track access patterns: "User asks X after Y"
- Predict what memories will be needed
- Pre-load relevant context before Claude needs it
- Push briefings at session start

**Implementation Notes:**
```python
# Access sequence tracking
sequences = [
    ("project:alpha", "decision:auth-method"),  # often accessed together
    ("morning", "email-summary"),               # time-based pattern
]

# Prediction triggers
- Session start → push recent context
- Topic detected → pre-load related memories
- Time of day → load routine memories
```

**Database Schema:**
```sql
CREATE TABLE access_sequences (
    id TEXT PRIMARY KEY,
    pattern JSON,           -- ["memory_id_1", "memory_id_2"]
    frequency INTEGER,
    last_seen TEXT,
    confidence REAL
);
```

---

### 3. Offline Consolidation ("Sleep" Cycles)

**Why EvoSteward:** Background processing during idle time

**Functionality:**
- Detect idle periods (no Claude activity)
- Merge similar/duplicate memories
- Extract patterns from episodic → semantic
- Clean up orphaned data

**Implementation Notes:**
```python
# Consolidation triggers
- 3am local time (configurable)
- 30min+ idle detected
- Manual trigger via API

# Consolidation tasks
1. Find similar memories (cosine > 0.9)
2. Merge into single high-confidence memory
3. Archive originals with link to merged
4. Update knowledge graph relations
```

---

### 4. Health Monitoring & Auto-Cleanup

**Why EvoSteward:** Continuous monitoring, scheduled maintenance

**Functionality:**
- Monitor database size and growth rate
- Track query performance
- Alert on anomalies (sudden growth, slow queries)
- Auto-archive old/unused memories
- Vacuum database periodically

**Implementation Notes:**
```python
# Health metrics
metrics = {
    "db_size_mb": 45.2,
    "memory_count": 21,
    "avg_query_ms": 12,
    "growth_rate_per_day": 0.5,
    "last_backup": "2026-01-23T10:00:00Z"
}

# Alerts
- db_size > 500MB → suggest cleanup
- query_time > 100ms → suggest index optimization
- no_backup > 7days → auto-backup
```

---

### 5. Reality Feedback Loop

**Why EvoSteward:** Track outcomes over time, validate predictions

**Functionality:**
- Store predictions with expected outcomes
- Track if predictions came true
- Adjust confidence scores based on track record
- Flag memories that led to wrong outcomes

**Critical Insight:**
> Memory must REINFORCE weights (reality), not erode them.
> LLMs never see consequences. EvoSteward can track them.

**Implementation Notes:**
```python
# Prediction tracking
prediction = {
    "id": "pred_123",
    "memory_id": "mem_456",
    "prediction": "User will need auth docs tomorrow",
    "confidence": 0.8,
    "outcome": None,  # filled later
    "validated_at": None
}

# Feedback loop
1. Make prediction
2. Track if it was useful
3. Adjust source memory confidence
4. Learn patterns for better predictions
```

**Database Schema:**
```sql
CREATE TABLE predictions (
    id TEXT PRIMARY KEY,
    memory_id TEXT,
    prediction TEXT,
    confidence REAL,
    outcome TEXT,        -- 'correct', 'incorrect', 'partial'
    created_at TEXT,
    validated_at TEXT,
    FOREIGN KEY (memory_id) REFERENCES memories(id)
);
```

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

### SQLite Database
- **Location:** `~/.claude-memory/memory.db`
- **Access:** Both Just-Memory and EvoSteward read/write
- **Locking:** SQLite WAL mode handles concurrent access

### Configuration
- **Location:** `~/.evosteward/config.yaml`
- **Shared settings:** decay rates, consolidation schedule, thresholds

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

## Next Steps

1. **Design EvoSteward daemon architecture**
   - Python service with scheduler (APScheduler)
   - REST API for manual triggers
   - Systemd/Windows service integration

2. **Extend Just-Memory schema**
   - Add `strength` column for decay
   - Add `access_sequences` table
   - Add `predictions` table

3. **Implement Phase 1: Decay Daemon**
   - Hourly decay calculations
   - Daily archival of weak memories
   - Integration with Just-Memory briefing

---

## References

- Chat history: Evo/MCP split discussion (Jan 23, 2026)
- Memory ID: `897c26f8c2b6ef266eee029104cf6090`
- Research: `C:/Users/ericc/memory-mcp-research/`
- Just-Memory: `C:/Users/ericc/Just-Memory/`
- EvoSteward: `C:/Users/ericc/Desktop/Project/EvoSteward/`
