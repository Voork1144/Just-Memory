# Memory Decay & Health System

**Just-Memory v2.2 Feature**

## Overview

The Memory Decay system implements the **Ebbinghaus forgetting curve** to model how memories weaken over time without reinforcement. This creates a more realistic and manageable memory system that automatically prioritizes frequently-accessed information.

## Research Foundation

### Ebbinghaus Forgetting Curve (1885)

The retention formula:
```
R(t) = e^(-t × λ / S)
```

Where:
- `R(t)` = Retention at time t
- `t` = Time since last access (hours)
- `λ` = Decay constant (0.693 = ln(2))
- `S` = Memory strength (1.0 - 10.0)

At strength=1.0, memory halves approximately every 24 hours.

### Spaced Repetition

Each recall/access:
1. Boosts memory strength
2. Resets the decay timer
3. Creates more durable memories

Boost formula with diminishing returns:
```
boost = BASE_BOOST / (1 + DIMINISHING_FACTOR × access_count)
```

### NeuroDream Research (Dec 2024)

Our decay system is informed by NeuroDream research showing 38% reduction in forgetting through proper memory management and consolidation patterns.

## New Tools (4)

### memory_decay_status

Get retention status for memories.

```json
{
  "filter": "all|needs_review|at_risk|forgotten",
  "limit": 20,
  "project_id": "optional"
}
```

Returns for each memory:
- `retention`: Current retention (0-1)
- `retentionLevel`: strong|moderate|weak|forgotten
- `projectedRetention24h`: Retention in 24 hours
- `projectedRetention7d`: Retention in 7 days
- `needsReview`: Boolean flag
- `atRisk`: Boolean flag

### memory_health

Get memory system health dashboard.

```json
{
  "project_id": "optional"
}
```

Returns:
- Total/active/archived counts
- Strength distribution
- Average retention/strength
- At-risk and needs-review counts
- Actionable recommendations

### memory_cleanup

Archive or delete weak memories.

```json
{
  "action": "archive|delete|restore",
  "dry_run": true,
  "strength_threshold": 0.3,
  "days_inactive": 30,
  "project_id": "optional"
}
```

**Always use `dry_run: true` first!**

### memory_boost

Manually boost memory strength.

```json
{
  "id": "memory-id",
  "boost_amount": 0.5
}
```

## Configuration

```typescript
DECAY_CONFIG = {
  DECAY_CONSTANT: 0.693,  // ln(2) - half-life at strength=1
  
  MIN_STRENGTH: 0.1,
  MAX_STRENGTH: 10.0,
  INITIAL_STRENGTH: 1.0,
  
  RETENTION_THRESHOLDS: {
    STRONG: 0.8,      // Well remembered
    MODERATE: 0.5,    // Needs review
    WEAK: 0.3,        // At risk
    FORGOTTEN: 0.1,   // Effectively lost
  },
  
  IMPORTANCE_MULTIPLIER: {
    LOW: 0.5,        // importance < 0.3
    NORMAL: 1.0,     // 0.3-0.7
    HIGH: 1.5,       // 0.7-0.9
    CRITICAL: 3.0,   // >= 0.9 (never fully decays)
  },
}
```

## Retention Levels

| Level | Retention | Description |
|-------|-----------|-------------|
| Strong | ≥80% | Well remembered, recently accessed |
| Moderate | 50-80% | Should review soon |
| Weak | 30-50% | At risk of forgetting |
| Forgotten | <30% | Effectively lost without recall |

## Example Usage

### Check memory health
```
memory_health
```

### Find memories needing review
```
memory_decay_status filter="needs_review" limit=10
```

### Preview cleanup
```
memory_cleanup action="archive" dry_run=true strength_threshold=0.2
```

### Boost important memory
```
memory_boost id="important-memory-id" boost_amount=1.0
```

## Integration with Existing Features

### Recall Strengthening
Every `memory_recall` call:
1. Updates `last_accessed`
2. Increments `access_count`
3. Boosts `strength` via spaced repetition

### Search Filtering
Search results are filtered by retention:
- Results with retention < 0.3 are deprioritized
- Confidence includes decay factor

### Confidence Scoring
Effective confidence includes:
- Base confidence
- Time decay penalty
- Source confirmations
- Contradiction penalties

## Files

- `src/memory/decay.ts` - Core decay functions and tool definitions
- `tests/memory/decay.test.ts` - Comprehensive test suite

## Test Coverage

39 tests covering:
- Retention calculation accuracy
- Retention level boundaries
- Strength boost with diminishing returns
- Decay rate calculations
- Retention projections
- Status generation
- Health recommendations
- Config validation
