# Contradiction Detection in Just-Memory v2.1

## Overview

Just-Memory v2.1 introduces enhanced contradiction detection that automatically identifies potential conflicts between memories using multiple detection strategies:

1. **Semantic Similarity** - Uses embeddings to find semantically related memories
2. **Negation Patterns** - Detects explicit and implicit negations
3. **Antonym Detection** - Identifies opposing terms
4. **Factual Claim Comparison** - Extracts and compares subject-predicate-object triples

## New Tool: `memory_find_contradictions`

Proactively check for contradictions BEFORE storing a memory.

### Usage

```typescript
// Check for contradictions before storing
const result = await memory_find_contradictions({
  content: "Paris is the capital of Germany",
  limit: 10,
  project_id: "my_project"  // optional
});

// Result structure
{
  query: "Paris is the capital of Germany",
  project_id: "my_project",
  summary: {
    totalFound: 1,
    byType: {
      semantic: 0,
      factual: 1,
      negation: 0,
      antonym: 0,
      temporal: 0
    },
    actionRequired: 1,
    reviewSuggested: 0
  },
  contradictions: [
    {
      id: "abc123",
      type: "factual",
      confidence: 0.9,
      similarity: 0.85,
      explanation: "Factual conflict: 'Paris is the capital of Germany' contradicts 'Paris is the capital of France'",
      suggestedAction: "resolve",
      content: "Paris is the capital of France..."
    }
  ]
}
```

## Automatic Detection on Store

When storing a new memory with `memory_store`, the system automatically:

1. Searches for semantically similar memories
2. Analyzes negation patterns
3. Extracts factual claims
4. Compares against existing memories
5. Adjusts confidence score based on contradictions found
6. Creates contradiction edges in the knowledge graph

### Example

```typescript
const result = await memory_store({
  content: "The meeting is cancelled",
  type: "event"
});

// If a contradiction with "The meeting is confirmed" exists:
{
  id: "xyz789",
  content: "The meeting is cancelled",
  confidence: 0.35,  // Reduced from 0.5 due to contradiction
  contradictions: [
    {
      id: "def456",
      type: "negation",
      confidence: 0.8,
      explanation: "New memory contains negation 'cancelled' while existing memory is affirmative on similar topic",
      suggestedAction: "review",
      preview: "The meeting is confirmed for..."
    }
  ]
}
```

## Contradiction Types

| Type | Description | Confidence Penalty |
|------|-------------|-------------------|
| `semantic` | High semantic similarity but different meaning | 0.15 |
| `factual` | Same subject with different predicate/object | 0.25 |
| `negation` | One affirms, one negates the same topic | 0.20 |
| `antonym` | Contains opposing terms (yes/no, true/false) | 0.15 |
| `temporal` | Time-based conflicts (planned feature) | 0.10 |

## Configuration Constants

```typescript
CONTRADICTION_CONFIG = {
  SEMANTIC_SIMILARITY_THRESHOLD: 0.6,  // Min similarity to check
  FACTUAL_SIMILARITY_THRESHOLD: 0.7,   // Min for factual comparison
  MAX_RESULTS: 10                       // Max contradictions returned
}
```

## Negation Detection

### Explicit Negations
`not`, `n't`, `don't`, `doesn't`, `isn't`, `aren't`, `won't`, `can't`, `never`, `no`, `none`, `neither`, `nor`, `nothing`, `nobody`, `nowhere`, `hardly`, `barely`, `scarcely`

### Implicit Negations
`fail`, `unable`, `impossible`, `false`, `wrong`, `incorrect`, `untrue`, `refuse`, `deny`, `reject`, `stop`, `end`, `cease`, `lack`, `absent`, `missing`, `without`

### Antonym Pairs (50+ pairs)
`true/false`, `yes/no`, `good/bad`, `start/stop`, `open/close`, `success/failure`, `accept/reject`, `always/never`, `more/less`, etc.

## Factual Claim Extraction

The system extracts factual claims using pattern matching:

- "X is Y" → `{subject: X, predicate: "is", object: Y}`
- "X has Y" → `{subject: X, predicate: "has", object: Y}`
- "The capital of X is Y" → `{subject: "capital of X", predicate: "is", object: Y}`
- "X lives in Y" → `{subject: X, predicate: "lives_in", object: Y}`
- "X was born in Y" → `{subject: X, predicate: "born_in", object: Y}`

## Best Practices

1. **Proactive Check**: Use `memory_find_contradictions` before storing important facts
2. **Review Suggestions**: Act on "resolve" suggestions immediately
3. **Confidence Monitoring**: Track memories with low confidence due to contradictions
4. **Edge Queries**: Use `memory_edge_query` to see all contradiction relationships

## Research Basis

This implementation is based on findings from:
- TACL 2024: "When Can LLMs Actually Correct Their Own Mistakes?"
- Collins & Loftus (1975): Spreading Activation cognitive model
- ICLR 2025: "Do LLMs Estimate Uncertainty Well"

## Migration from v2.0

v2.1 is fully backward compatible with v2.0. The only additions are:
- New tool: `memory_find_contradictions`
- Enhanced `storeMemory` with semantic contradiction detection
- More detailed contradiction edges with metadata

## Tool Count

v2.1 includes 32 tools (31 from v2.0 + `memory_find_contradictions`)
