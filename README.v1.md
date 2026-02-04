# Just-Memory v1.0

> Standalone MCP server with Ebbinghaus decay for persistent memory

## Features

- **6 tools**: store, recall, search, list, delete, stats
- **Ebbinghaus decay**: Memories naturally fade unless accessed
- **Spaced repetition**: Accessing memories strengthens them
- **~200 lines**: Minimal, focused implementation
- **SQLite backend**: Single portable file at `~/.just-memory/memories.db`

## Ebbinghaus Forgetting Curve

```
R = e^(-t/S)

R = retention (0-1)
t = hours since last access  
S = memory strength (grows with each recall)
DECAY_CONSTANT = 0.5 (half-life ~1 day at strength=1)
```

Memories below 10% retention are filtered from search/list results (recoverable with `includeWeak: true`).

## Installation

```bash
# From Just-Memory directory
npm install
npm run build  # or: npx tsc -p tsconfig.v1.json
```

## Claude Desktop Configuration

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "just-memory": {
      "command": "node",
      "args": ["C:\\Users\\ericc\\Just-Memory\\dist\\just-memory-v1.js"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store new memory with type, tags, importance |
| `memory_recall` | Recall by ID (strengthens memory via spaced repetition) |
| `memory_search` | Search by content (filters weak memories < 10% retention) |
| `memory_list` | List recent memories above threshold |
| `memory_delete` | Soft delete (default) or permanent delete |
| `memory_stats` | Database statistics (total, active, dbPath) |

## Memory Types

`fact`, `event`, `observation`, `preference`, `note`, `decision`

## Example Usage

```javascript
// Store a memory
memory_store: {
  "content": "User prefers TypeScript over JavaScript",
  "type": "preference",
  "importance": 0.8,
  "tags": ["coding", "preferences"]
}

// Recall strengthens the memory
memory_recall: { "id": "abc123..." }
// Returns: strength increased, access_count++, retention recalculated

// Search (weak memories filtered)
memory_search: { "query": "TypeScript", "limit": 10 }

// List with weak memories included
memory_list: { "limit": 20, "includeWeak": true }

// Stats
memory_stats: {}
// Returns: { total: 5, activeAboveThreshold: 3, dbPath: "..." }
```

## Spaced Repetition

Each `memory_recall` call:
1. Increments `access_count`
2. Increases `strength` logarithmically: `S = min(10, S + 0.2 * ln(access_count + 1))`
3. Updates `last_accessed` timestamp
4. Returns fresh `retention` calculation

Stronger memories decay slower, simulating human long-term memory consolidation.

## Files

| File | Purpose |
|------|---------|
| `src/just-memory-v1.ts` | Source (205 lines) |
| `dist/just-memory-v1.js` | Compiled output |
| `tsconfig.v1.json` | TypeScript config |
| `~/.just-memory/memories.db` | SQLite database |
