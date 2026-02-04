# Just-Memory v1.0 Sprint Plan

**Goal:** Complete Just-Memory v1.0 to unblock EvoSteward P2  
**Start:** January 24, 2026  
**Target:** 2-3 days

---

## Current State

| Component | Status |
|-----------|--------|
| Core 6 tools | ✅ Working |
| Ebbinghaus decay | ✅ Implemented |
| SQLite backend | ✅ Working |
| Claude Desktop | ✅ Integrated |

**Lines of code:** 207 (just-memory-v1.ts)

---

## Missing for v1.0 Complete

| Feature | Priority | Est. LOC | Dependencies |
|---------|----------|----------|--------------|
| Confidence scoring | P0 | +30 | None |
| Bi-temporal queries | P0 | +60 | Schema change |
| Contradiction detection | P1 | +80 | Confidence scoring |
| Knowledge graph (entities) | P1 | +100 | Schema change |
| Working memory/scratchpad | P2 | +50 | None |

**Total estimated:** ~320 new lines → ~530 total

---

## Sprint Tasks

### Day 1: Schema + Confidence + Bi-temporal

#### Task 1.1: Schema Migration
Add new columns to memories table:
```sql
ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN valid_from TEXT;
ALTER TABLE memories ADD COLUMN valid_to TEXT;
ALTER TABLE memories ADD COLUMN source TEXT;
```

#### Task 1.2: Confidence Scoring
- Add `confidence` parameter to `memory_store`
- Derived facts get `confidence ≤ min(parent confidences)`
- New tool: `memory_update_confidence(id, confidence, reason)`

#### Task 1.3: Bi-temporal Queries
- Add `valid_from`, `valid_to` to store
- New tool: `memory_query_temporal(query, as_of_date)`
- Filter: only return memories valid at queried time

### Day 2: Knowledge Graph + Contradiction

#### Task 2.1: Entities Table
```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT DEFAULT 'concept',
  properties TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (from_entity) REFERENCES entities(id),
  FOREIGN KEY (to_entity) REFERENCES entities(id)
);
```

#### Task 2.2: KG Tools
- `memory_entity_create(name, type, properties)`
- `memory_entity_get(name)`
- `memory_relation_create(from, to, type, confidence)`
- `memory_graph_query(entity, depth)`

#### Task 2.3: Contradiction Detection
- On `memory_store`, check for contradicting memories
- Use simple keyword overlap + negation detection
- Return `{ stored: true, conflicts: [...] }` if conflicts found
- New tool: `memory_check_contradictions()`

### Day 3: Working Memory + Polish

#### Task 3.1: Working Memory
```sql
CREATE TABLE scratchpad (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

Tools:
- `memory_scratch_set(key, value, ttl_seconds)`
- `memory_scratch_get(key)`
- `memory_scratch_clear()`

#### Task 3.2: Integration Tests
- Test all new tools
- Test contradiction detection
- Test bi-temporal queries

#### Task 3.3: Documentation
- Update README.md
- Update tool descriptions
- Create migration guide

---

## Success Criteria

1. ✅ 15+ tools (currently 6)
2. ✅ Confidence scores on all memories
3. ✅ Bi-temporal queries working
4. ✅ Basic contradiction detection
5. ✅ Entity/relation storage
6. ✅ Working memory scratchpad
7. ✅ All tests passing

---

## Tool Count Target

| Category | Tools |
|----------|-------|
| Core CRUD | 6 (existing) |
| Confidence | 1 |
| Bi-temporal | 1 |
| Knowledge Graph | 4 |
| Contradiction | 1 |
| Working Memory | 3 |
| **Total** | **16** |

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/just-memory-v1.ts` | Modify - add all features |
| `dist/just-memory-v1.js` | Rebuild |
| `README.md` | Update tool list |
| `tests/memory/*.test.ts` | Add tests |
| `CHANGELOG.md` | Document changes |

---

## Rollback Plan

Keep `dist-v1.0/` as backup before modifications.
