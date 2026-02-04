# Just-Command Master Plan v3
## Memory-First MCP Server with Innovative Cognitive Features

> **Version**: 3.0
> **Date**: January 21, 2026
> **Status**: Research Complete → Implementation Ready

---

## Executive Summary

Just-Command is a **memory-first specialist** MCP server that combines:
- **86+ memory server research** - Competitive analysis complete
- **50+ academic papers (2024-2025)** - Innovative features identified
- **8 unique cognitive features** - No competitor has these combined

**Strategic Position**: Complement Desktop Commander, don't compete.

---

## Table of Contents

1. [Strategic Direction](#strategic-direction)
2. [Critical Bugs](#critical-bugs)
3. [Innovative Features Research](#innovative-features-research)
4. [Implementation Priority Matrix](#implementation-priority-matrix)
5. [Technical Specifications](#technical-specifications)
6. [Enhanced Roadmap](#enhanced-roadmap)
7. [Success Metrics](#success-metrics)

---

# Strategic Direction

## Memory-First Vision

```
Just-Command v3 Architecture:
├── 🧠 Core Memory (FOUNDATION)
│   ├── Semantic search (hybrid BM25 + vector)
│   ├── Knowledge graph (entities, relations)
│   └── Session briefings (context generation)
├── 🔬 Innovative Cognitive Layer (DIFFERENTIATOR)
│   ├── Contradiction detection
│   ├── Confidence scoring
│   ├── Memory decay (Ebbinghaus curves)
│   ├── Bi-temporal reasoning
│   ├── Emotional context tracking
│   ├── Proactive/predictive retrieval
│   ├── Working memory/scratchpad
│   └── Memory health monitoring
└── 🔗 Integration Layer
    └── Desktop Commander bridge
```

## Competitive Differentiation

| Feature | Just-Command | Best Competitor | Gap |
|---------|-------------|-----------------|-----|
| Contradiction detection | ✅ Planned | ❌ None | **UNIQUE** |
| Confidence scoring | ✅ Planned | ❌ None | **UNIQUE** |
| Emotional tagging | ✅ Planned | ❌ None | **UNIQUE** |
| Proactive retrieval | ✅ Planned | ❌ None | **UNIQUE** |
| Memory health dashboard | ✅ Planned | ❌ None | **UNIQUE** |
| Memory decay | ✅ Planned | 🟡 CortexGraph only | Partial |
| Bi-temporal | ✅ Planned | 🟡 Graphiti/Zep | Partial |
| Knowledge graph | ✅ Planned | ✅ Official MCP | Parity |

---

# Critical Bugs

## 🔴 P0 - Must Fix Before Release

### Bug #1: No Ripgrep Validation
```
Severity: 🔴 CRITICAL
Module: Search
Status: 🔴 NOT FIXED
```
Server crashes if ripgrep binary missing. Need validation on startup.

### Bug #2: Session Memory Leak
```
Severity: 🔴 CRITICAL
Module: Terminal
Status: 🔴 NOT FIXED
```
Sessions never cleaned up. Need MAX_SESSIONS=10, 30-min timeout, auto-cleanup.

### Bug #3: Binary Offset Inconsistency
```
Severity: 🟡 MEDIUM
Module: Filesystem
Status: 🟡 NOT FIXED
```
Confusing API for text vs binary offset. Need separate lineOffset/byteOffset.

---

# Innovative Features Research

## Research Methodology
- **50+ papers/sources** from 2024-2025 academic research
- **7 comprehensive web searches** across major themes
- **Focus**: Features not yet implemented in any MCP server

---

## Feature 1: Contradiction Detection

### Problem
Memory corruption occurs when incorrect information is stored and treated as accurate. Hallucinations stored in long-term memory contaminate the reasoning base.

### Research Sources
- "When Can LLMs Actually Correct Their Own Mistakes?" (TACL 2024)
- "CRITIC: LLMs Can Self-Correct with Tool-Interactive Critiquing" (ICLR 2024)
- "A Survey on Hallucination in LLMs" (ACM TOIS 2024)

### Key Insights
- LLMs struggle with **intrinsic self-correction** without external feedback
- Self-correction works with **external tools** (code executors, proof assistants)
- Feedback loops reinforce previous outputs → self-reinforcing biases

### Implementation
```typescript
interface ContradictionDetection {
  validateMemory(content: string): {
    hasContradiction: boolean;
    conflictingMemories: Memory[];
    confidence: number;
  };
  
  detectContradictions(): {
    pairs: [Memory, Memory][];
    resolutionSuggestions: string[];
  };
}
```

---

## Feature 2: Confidence Scoring

### Problem
Memories are stored without reliability indicators. Users can't distinguish well-established facts from uncertain beliefs.

### Research Sources
- "Do LLMs Estimate Uncertainty Well" (ICLR 2025)
- "AI Confidence Scores" (Emergent Mind 2025)
- "Detecting Hallucinations via Substantive Uncertainty" (2026)

### Key Insights
- **Verbalized confidence** provides better calibration than logits (50% ECE reduction)
- Derived facts should have confidence ≤ min(parent confidences)

---

## Feature 3: Memory Decay (Ebbinghaus Curves)

### Problem
Memories accumulate without limit, diluting relevance. Human-like forgetting is optimization.

### Research Sources
- "NeuroDream: Sleep-Inspired Memory Consolidation" (SSRN Dec 2024)
- "The Agent's Memory Dilemma" (Medium Nov 2025)

### Key Insights
- Ebbinghaus curve: 0h=1.0, 3d=0.5, 7d=0.21, 30d=0.001
- Access reinforces memory strength

---

## Feature 4: Bi-Temporal Reasoning

### Problem
Most memory systems only track when information was stored, not when facts were valid.

### Research Sources
- "Zep: Temporal Knowledge Graph" (arXiv Jan 2025): 18.5% accuracy improvement
- "Supermemory" (2025): 76.69% temporal reasoning accuracy

### Key Insights
- **Event Time**: When fact was true (valid_from, valid_to)
- **Ingestion Time**: When we learned it (created_at, updated_at)

---

## Feature 5: Emotional Context Tracking

### Problem
Memories lack emotional/sentiment tracking.

### Research Sources
- "Livia: Emotion-Aware AR Companion" (Oct 2025)
- "AI PERSONA: Life-long Personalization" (Dec 2024)

### Implementation
Sentiment tagging, mood patterns, empathetic retrieval.

---

## Feature 6: Proactive/Predictive Memory

### Problem
Current memory is reactive, not proactive.

### Research Sources
- "Memory in the Age of AI Agents" (arXiv Dec 2025)
- "MCP-Zero: Proactive Toolchain Construction" (Jun 2025)

### Implementation
Intent detection, pattern recognition, anticipatory retrieval.

---

## Feature 7: Working Memory / Scratchpad

### Problem
Agents lack active working memory for complex tasks.

### Research Sources
- "MemGPT" (2023): Virtual context management
- "Context Engineering for Agents" (Jun 2025)

### Implementation
Session scratchpad with TTL, auto-promotion to long-term.

---

## Feature 8: Memory Health Dashboard

### Problem
No visibility into memory quality, conflicts, or degradation.

### Implementation
Health metrics, stale detection, conflict resolution, cleanup tools.

---

# Implementation Priority Matrix

## Tier 1: High Impact, Feasible (Weeks 3-4)
| Feature | Impact | Complexity | Unique? |
|---------|--------|------------|--------|
| Contradiction Detection | High | Medium | ✅ Yes |
| Confidence Scoring | High | Low | ✅ Yes |
| Memory Decay | High | Low | Partial |
| Bi-Temporal Support | High | Medium | Partial |

## Tier 2: Medium Impact (Weeks 5-6)
| Feature | Impact | Complexity | Unique? |
|---------|--------|------------|--------|
| Emotional Tagging | Medium | Medium | ✅ Yes |
| Proactive Retrieval | High | High | ✅ Yes |
| Working Memory | Medium | Low | Partial |
| Memory Health | Medium | Low | ✅ Yes |

## Tier 3: Future (Phase 4+)
| Feature | Impact | Complexity | Unique? |
|---------|--------|------------|--------|
| Offline Consolidation | High | High | ✅ Yes |
| Counterfactual Reasoning | Medium | High | ✅ Yes |
| Dream-Like Replay | Medium | Very High | ✅ Yes |

---

# Technical Specifications

## Tool Inventory (45 Total)

### Core Memory (17 tools)
10 existing + 7 new (batch ops, linking, history, backup)

### Knowledge Graph (8 tools)
Entity CRUD, Relations, Observations, Graph queries

### Cognitive Features (12 tools) - **UNIQUE**
Validation, confidence, decay, temporal, emotion, scratchpad, suggestions

### Health & Analytics (8 tools) - **UNIQUE**
Health dashboard, cleanup, consolidation, access patterns

---

# Enhanced Roadmap

```
Week 0     ████ Bug Fixes (3 critical)
Week 1-2   ████████ Knowledge Graph (+8 tools)
Week 3-4   ████████ Tier 1 Cognitive (+6 tools)
Week 5-6   ████████ Tier 2 Cognitive (+10 tools)
Week 7-8   ████████ Polish & Release
───────────────────────────────────────────
           Total: ~8 weeks to v2.0 (45 tools)
```

---

# Success Metrics

| Metric | Target |
|--------|--------|
| P0 Bugs | 0 |
| Tools Implemented | 45 |
| Search latency P95 | < 50ms |
| Test coverage | > 80% |
| Unique features | 6+ |

## Competitive Position

Just-Command v2.0 will be the **ONLY** MCP server with:
- ✅ Contradiction detection + auto-resolution
- ✅ Calibrated confidence scoring
- ✅ Emotion-aware memory
- ✅ Proactive/predictive retrieval
- ✅ Memory health monitoring
- ✅ Bi-temporal reasoning
- ✅ Working memory/scratchpad
- ✅ Ebbinghaus decay curves

---

# References

50+ academic papers - see docs/INNOVATIVE_FEATURES.md for full list.
86+ MCP servers analyzed - see MEMORY_MCP_COMPARISON.md.