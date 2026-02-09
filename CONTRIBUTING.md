# Contributing to Just-Memory

Thank you for your interest in contributing to Just-Memory. This guide covers everything you need to get started.

## Development Setup

### Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm 9+**
- A C++ compiler for `better-sqlite3` native bindings:
  - Debian/Ubuntu: `apt install build-essential`
  - macOS: `xcode-select --install`
  - Windows: Visual Studio Build Tools

### Getting Started

```bash
git clone https://github.com/Voork1144/Just-Memory.git
cd Just-Memory
npm ci
npm run build
npm test
```

## Project Structure

```
src/                         # TypeScript source (ESM, strict mode)
  just-memory-v2.1.ts       # Orchestrator — MCP server lifecycle, DB setup, dispatch wiring
  tool-definitions.ts        # MCP tool schema definitions (name, description, inputSchema)
  tool-handlers.ts           # ToolDispatch interface + dispatchToolCall function
  memory.ts                  # Memory CRUD operations
  search.ts                  # Hybrid keyword + semantic search
  entities.ts                # Knowledge graph entities and relations
  contradiction.ts           # Contradiction detection (DeBERTa NLI)
  contradiction-resolution.ts # Auto-resolution logic
  consolidation.ts           # Background decay, strengthening, cleanup
  chat-ingestion.ts          # Claude Code / Desktop conversation import
  session.ts                 # Session tracking, crash recovery, task state
  scheduled-tasks.ts         # Cron parsing and task scheduling
  backup.ts                  # Backup creation, restoration, listing
  tool-logging.ts            # Tool call logging and history
  schema.ts                  # Database migrations and table creation
  stats.ts                   # Memory statistics and project listing
  config.ts                  # Constants, thresholds, environment config
  validation.ts              # Input sanitization and validation
  models.ts                  # Lazy ML model loading (embeddings, NLI, summarizer)
  vector-store.ts            # VectorStore abstraction (Qdrant / sqlite-vec)
  qdrant-store.ts            # Qdrant sidecar lifecycle and gRPC client
  write-lock.ts              # Async FIFO mutex for SQLite write serialization

tests/                       # Test suites (node:test + tsx runner)
  helpers/
    test-db.ts               # In-memory SQLite with full schema
  *.test.ts                  # One test file per source module

dist/                        # Compiled output (git-ignored)
```

## Code Style

- **TypeScript strict mode** — all strict compiler flags enabled (`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`)
- **ESM** — `"type": "module"` in package.json, `"module": "NodeNext"` in tsconfig
- **Import suffix** — always use `.js` extension in import paths (TypeScript + NodeNext resolution)
- **No `any`** — avoid `any` types; use typed alternatives or `unknown`
- **ESLint** — run `npm run lint` before submitting; config covers all `src/` files
- **Target ES2022** — `Array.at()`, `Object.hasOwn()`, `Error.cause`, top-level `await` are all fine

## How to Add a New MCP Tool

Adding a tool involves four files. Here is the process:

### Step 1: Define the tool schema in `tool-definitions.ts`

Add a new entry to the exported tools array with `name`, `description`, and `inputSchema`:

```ts
{
  name: 'memory_my_tool',
  description: 'Brief description of what it does.',
  inputSchema: {
    type: 'object',
    properties: {
      my_param: { type: 'string', description: 'What this param does' }
    },
    required: ['my_param']
  }
}
```

### Step 2: Add the method signature to the `ToolDispatch` interface in `tool-handlers.ts`

```ts
export interface ToolDispatch {
  // ... existing methods ...
  myTool(param: string, projectId?: string): any;
}
```

### Step 3: Add the dispatch case in the `dispatchToolCall` function in `tool-handlers.ts`

```ts
case 'memory_my_tool':
  return dispatch.myTool(args.my_param, dispatch.getEffectiveProject(args.project_id));
```

### Step 4: Wire the implementation in `just-memory-v2.1.ts`

Add your implementation function, then include it in the `toolDispatch` object:

```ts
const toolDispatch: ToolDispatch = {
  // ... existing methods ...
  myTool: myToolImplementation,
};
```

## Test Conventions

- **Framework**: `node:test` (built-in Node.js test runner)
- **Runner**: `tsx` (TypeScript execution without pre-compilation)
- **Command**: `npm test` runs `tsx --test tests/*.test.ts`
- **Database**: Tests use in-memory SQLite via `tests/helpers/test-db.ts` — no file I/O, no cleanup needed
- **Structure**: Each test file mirrors its source module (`src/search.ts` -> `tests/search.test.ts`)
- **Assertions**: Use `node:assert` (`assert.strictEqual`, `assert.ok`, `assert.throws`, etc.)

Example test skeleton:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';

describe('myTool', () => {
  it('should do the thing', () => {
    const db = createTestDb();
    insertTestMemory(db, { content: 'test data' });
    // ... test logic ...
    assert.strictEqual(result, expected);
  });
});
```

Run a quick subset during development:

```bash
npm run test:quick    # config + validation only
```

## Pull Request Process

1. **Fork and branch** — create a feature branch from `main`
2. **Make changes** — keep PRs focused on a single concern
3. **Verify locally**:
   ```bash
   npm run build
   npm test
   npm run lint
   ```
4. **Open a PR** — fill in the PR template (description, related issue, type of change, testing checklist)
5. **CI must pass** — build, test, and lint checks run automatically
6. **Review** — a maintainer will review and may request changes

### Commit Message Format

Use imperative mood with a concise summary. Prefix with the area of change when helpful:

```
Fix confidenceThreshold ignored in vector search
Add write lock timeout support
Extract 8 modules from orchestrator monolith
Chat ingestion: add Layer 3 conversation summarization
Security: add ReDoS protection to contradiction detection
```

Keep the first line under 72 characters. Add a blank line and body paragraph for complex changes.

## Reporting Issues

- **Bugs**: Use the [bug report template](https://github.com/Voork1144/Just-Memory/issues/new?template=bug_report.md)
- **Features**: Use the [feature request template](https://github.com/Voork1144/Just-Memory/issues/new?template=feature_request.md)
- **Security**: See [SECURITY.md](SECURITY.md) — do not open public issues for vulnerabilities

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
