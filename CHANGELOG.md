# Changelog

All notable changes to Just-Memory are documented here.

## [4.3.4] - 2026-02-08

### Fixed
- **Source maps shipped in npm package** — `package.json` `files` whitelist overrode `.npmignore`; changed to explicit `**/*.js` + `**/*.d.ts` globs (package 754KB -> 474KB)
- **`toHNSWProvider` unsafe `as any` cast** — added `getHNSWSearch()` public accessor to `SqliteVecStore`
- **MCP error responses leak file paths** — `sanitizeErrorMessage()` strips absolute paths and truncates to 200 chars
- **Consolidation timer could hang forever** — wrapped in `Promise.race` with 5-minute hard timeout

### Changed
- **`@xenova/transformers` replaced with `@huggingface/transformers`** — Xenova fork abandoned May 2024; migrated to actively maintained `@huggingface/transformers` v3.8
- **ESM module format** — `"type": "module"` in package.json, `"module": "NodeNext"` in tsconfig
- **TypeScript target ES2022** — enables `Array.at()`, `Object.hasOwn()`, `Error.cause`, top-level `await`
- **Global `any` types removed from models.ts** — `PipelineInstance`, `ClassifierInstance`, `SummarizerInstance` callable types
- **Magic numbers extracted to config.ts** — `EMBEDDING_TIMEOUT_MS`, `NLI_TIMEOUT_MS`, `SUMMARIZATION_TIMEOUT_MS`, `MAX_SENTENCE_LENGTH`, `MAX_WORD_ARRAY_SIZE`, `CONSOLIDATION_HARD_TIMEOUT_MS`
- **`activeConsolidation` typed as `Promise<unknown>`** instead of `Promise<any>`

### Added
- `bin` field in package.json — enables `npx just-memory`
- `exports` field in package.json — explicit ESM entry point
- Shebang (`#!/usr/bin/env node`) in entry point
- `SECURITY.md` — vulnerability reporting policy
- `npm audit` step in CI pipeline
- 19 new tests: `vector-store.test.ts` (13), entity error paths (6), strengthened search assertions

### Stats
- 436 tests passing, 0 failures, 0 build errors

---

## [4.3.3] - 2026-02-08

### Fixed
- **confidenceThreshold ignored in vector search** — VectorFilter.confidenceThreshold was defined but never applied to SQL queries in both HNSW and fallback search paths
- **LIKE escape missing backslash** — sanitizeLikePattern now escapes backslashes before `%` and `_`
- **Source maps shipped to npm** — added `*.map` to .npmignore

### Added
- Write lock timeout support — `acquire(timeoutMs)` prevents indefinite waits
- Reserved project ID validation — rejects "global", "system", "admin", "default"
- Port and writer count range validation in config
- Strict compiler flags — `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- Lint step in CI pipeline
- `prepublishOnly` script (build + test before publish)
- ReDoS protection — sentence length cap (500 chars) and word array cap (500 words) in contradiction detection
- Quick Start and Troubleshooting sections in README
- Dynamic CI status badge in README

### Changed
- Removed 26 unused imports and dead wrapper functions (surfaced by strict compiler flags)

---

## [4.3.2] - 2026-02-08

### Added
- 3 new test suites: contradiction-resolution (25 tests), stats (14 tests), tool-logging (12 tests)
- 4 additional search tests (FTS5 fallback, limit, project scoping)
- Feb 29 cron leap year test

### Fixed
- Cron parser leap year bound: 365 days increased to 366 to correctly reach Feb 29

### Stats
- 411 tests passing, 0 failures, 0 build errors

---

## [4.3.1] - 2026-02-07

### Added
- 150 new tests across 4 suites (write-lock, backup, scheduled-tasks, tool-handlers)
- Session error logging: 12 catch blocks now log warnings instead of silently swallowing

### Fixed
- Backup TOCTOU race condition: `realpathSync` validation before restore
- Backup schema validation: rejects malformed backup files
- Embedding worker atomic SELECT: prevents partial reads during concurrent writes
- Short-subject contradiction false positives: requires 2+ word subjects with 2+ overlapping words
- Consolidation lock timeout: capped at 5 minutes to prevent indefinite blocking

### Security
- ProjectId whitelist validation: rejects path traversal and injection attempts

### Stats
- 411 tests passing (263 new since v4.3.0)

---

## [4.3.0] - 2026-02-07

### Changed
- Monolith refactor: extracted 8 modules from the 4,860-line orchestrator
  - `tool-definitions.ts` — MCP tool schema definitions
  - `tool-handlers.ts` — Tool dispatch via ToolDispatch DI interface
  - `scheduled-tasks.ts` — Cron parsing and task scheduling
  - `backup.ts` — Backup creation, restoration, and listing
  - `contradiction-resolution.ts` — Auto-resolution logic
  - `tool-logging.ts` — Tool call logging and history
  - `schema.ts` — Database migrations and table creation
  - `stats.ts` — Memory statistics and project listing
- Orchestrator reduced to 1,304 lines (thin lifecycle management)
- ToolDispatch dependency injection interface for all handler modules

### Stats
- 23 TypeScript source modules, 148 tests passing

---

## [4.2.0] - 2026-02-06

### Added
- Quality gates: minimum content length, duplicate detection on store
- Garbage cleanup: automatic removal of low-value system memories
- Contradiction auto-resolution: version updates and temporal supersession
- Layer 3 conversation summarization for chat ingestion
- `JUST_MEMORY_SUMMARIZER` environment variable

### Changed
- Confidence recalibration: floor (0.1), cap (1.0), decay rate adjustments

---

## [4.0.0] - 2026-02-05

### Added
- VectorStore abstraction: Qdrant sidecar for 1M+ scale, sqlite-vec fallback
- WriteLock async FIFO mutex for SQLite write serialization
- Configurable embedding model via `JUST_MEMORY_EMBEDDING` environment variable
- Lazy background embedding worker with atomic operations
- Qdrant auto-download and lifecycle management
- `JUST_MEMORY_QDRANT`, `JUST_MEMORY_QDRANT_PORT`, `JUST_MEMORY_QDRANT_BINARY` environment variables

### Changed
- Semantic search uses VectorStore KNN instead of full table scan when available
- Consolidation similarity detection uses VectorStore streaming KNN
- Embedding dimensions: 1024 (e5-large-v2) default, 384 (e5-small-v2) option
