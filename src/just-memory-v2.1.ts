#!/usr/bin/env node
/**
 * Just-Memory v5.0.0 — MCP Server Orchestrator (23 tools)
 *
 * Thin orchestrator: DB setup, HNSW management, wrapper functions, consolidation timer,
 * MCP server lifecycle. All business logic extracted to 19 modules.
 *
 * Modules:
 *   config.ts, models.ts, validation.ts, session.ts, contradiction.ts,
 *   memory.ts, search.ts, entities.ts, consolidation.ts, chat-ingestion.ts,
 *   write-lock.ts, vector-store.ts, qdrant-store.ts,
 *   tool-definitions.ts, scheduled-tasks.ts, backup.ts,
 *   contradiction-resolution.ts, tool-logging.ts, schema.ts, stats.ts,
 *   tool-handlers.ts
 *
 * v4.3.3: Test coverage hardening — 3 new test suites (contradiction-resolution, stats,
 *         tool-logging), expanded search tests, cron leap year fix (365→366)
 * v4.3.1: Hostile audit remediation — session error logging, projectId whitelist,
 *         backup TOCTOU fix + schema validation, embedding worker atomic SELECT,
 *         short-subject contradiction fix, consolidation lock timeout 5min,
 *         148 new tests (write-lock, backup, scheduled-tasks, tool-handlers)
 * v4.3:  Monolith refactor — extracted 8 new modules (tool-definitions, scheduled-tasks,
 *        backup, contradiction-resolution, tool-logging, schema, stats, tool-handlers),
 *        ToolDispatch interface for handler dependency injection
 * v4.2:  Data hygiene (quality gates, garbage cleanup, contradiction auto-resolution),
 *        confidence recalibration (floor, cap, decay), Layer 3 conversation summarization
 * v4.0:  VectorStore abstraction (Qdrant sidecar or sqlite-vec), WriteLock concurrency,
 *        configurable embedding model, lazy background embedding worker
 * v3.13: Modular split, schema migrations, dead table cleanup, threshold fixes
 * v3.12: Context recovery (task tracking, briefing_seq, session-based crash detection)
 * v3.8:  Fixed false positive contradictions and confidence collapse
 * v3.7:  Crash recovery (auto-ingest, auto-backup, session state tracking)
 * v3.6:  Tool consolidation (52 -> 22 tools)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import {
  BACKUP_DIR, MODEL_CACHE, DB_DIR, DB_PATH, EMBEDDING_DIM,
  GLOBAL_PROJECT,
  CONTRADICTION_CONFIG,
  CONSOLIDATION_INTERVAL_MS, IDLE_THRESHOLD_MS, CONSOLIDATION_HARD_TIMEOUT_MS,
  TOOL_LOG_EXCLUDED,
  QDRANT_ENABLED, QDRANT_PORT, QDRANT_DATA_DIR, QDRANT_BINARY, QDRANT_COLLECTION,
  WRITE_LOCK_MAX_CONCURRENT,
  EMBEDDING_WORKER_BATCH_SIZE, EMBEDDING_WORKER_INTERVAL_MS,
  EMBEDDING_MODEL,
  type ContradictionResult,
} from './config.js';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { platform } from 'os';
import { join, dirname, basename, resolve, sep } from 'path';
import * as sqliteVec from 'sqlite-vec';

// v4.0: Write lock, vector store, Qdrant
import { WriteLock } from './write-lock.js';
import { SqliteVecStore } from './vector-store.js';
import type { VectorStore } from './vector-store.js';
import { QdrantStore } from './qdrant-store.js';
import { generateEmbedding } from './models.js';
import { TOOLS } from './tool-definitions.js';
import {
  createScheduledTask as _createScheduledTask,
  listScheduledTasks as _listScheduledTasks,
  checkDueTasks as _checkDueTasks,
  completeScheduledTask as _completeScheduledTask,
  cancelScheduledTask as _cancelScheduledTask,
} from './scheduled-tasks.js';
import {
  backupMemories as _backupMemories,
  restoreMemories as _restoreMemories,
  listBackups as _listBackups,
  cleanupOldBackups,
} from './backup.js';
import {
  getPendingResolutions as _getPendingResolutions,
  resolveContradiction as _resolveContradiction,
  scanContradictions as _scanContradictions,
} from './contradiction-resolution.js';
import {
  logToolCall as _logToolCall,
  getToolHistory as _getToolHistory,
} from './tool-logging.js';
import {
  runMigrations,
  initVectorlite as _initVectorlite,
  createCoreTables,
  seedEntityTypes,
  runLegacyCleanup,
  initFTS5,
  type SearchHNSWFn,
} from './schema.js';
import {
  suggestFromContext as _suggestFromContext,
  getStats as _getStats,
  listProjects as _listProjects,
} from './stats.js';
import { dispatchToolCall, type ToolDispatch } from './tool-handlers.js';
import type { ChatConversationListRow, ChatParseAndIngestResult } from './types.js';

// Chat Ingestion imports
import {
  ingestClaudeDesktopExport,
  initChatSchema,
  parseClaudeCodeJsonl,
  ingestConversation,
  ingestAllClaudeCode,
  discoverClaudeCodeConversations,
  getConversationStats,
  searchConversations,
  getConversation,
  extractFactsFromConversation,
  extractFactsBatch,
  cleanupGarbageFacts,
  summarizeConversation,
  summarizeBatch,
  extractConversationTopics,
  searchConversationSummaries,
} from './chat-ingestion.js';

// ============================================================================
// Models — imported from models.ts
// ============================================================================
import { getModelState, warmupModels } from './models.js';

// Pre-warm models on startup
warmupModels();

// Contradiction detection — imported from contradiction.ts
import {
  findContradictionsEnhanced as _findContradictionsEnhanced,
  type HNSWProvider,
} from './contradiction.js';

// Memory CRUD & confidence — imported from memory.ts
import {
  storeMemory as _storeMemory,
  reembedOrphaned as _reembedOrphaned,
  recallMemory as _recallMemory,
  updateMemory as _updateMemory,
  type MemoryUpdates,
  deleteMemory as _deleteMemory,
  listMemories as _listMemories,
  getBriefingMemories as _getBriefingMemories,
  confirmMemory as _confirmMemory,
  contradictMemory as _contradictMemory,
  findContradictionsProactive as _findContradictionsProactive,
  recalibrateContradictionCounts as _recalibrateContradictionCounts,
} from './memory.js';

// Search — imported from search.ts
import {
  hybridSearch as _hybridSearch,
} from './search.js';

// Entities, edges, scratchpad — imported from entities.ts
import {
  createEdge as _createEdge, queryEdges as _queryEdges, invalidateEdge as _invalidateEdge,
  scratchSet as _scratchSet, scratchGet as _scratchGet, scratchDelete as _scratchDelete,
  scratchList as _scratchList, scratchClear as _scratchClear,
  createEntity as _createEntity, getEntity as _getEntity, linkEntities as _linkEntities,
  searchEntities as _searchEntities, observeEntity as _observeEntity, deleteEntity as _deleteEntity,
  defineEntityType as _defineEntityType, getTypeHierarchy as _getTypeHierarchy,
  getBriefingEntities as _getBriefingEntities,
  listEntityTypes as _listEntityTypes, searchEntitiesByTypeHierarchy as _searchEntitiesByTypeHierarchy,
} from './entities.js';

// Consolidation — imported from consolidation.ts
import {
  findSimilarMemories as _findSimilarMemories,
  strengthenActiveMemories as _strengthenActiveMemories,
  applyMemoryDecay as _applyMemoryDecay,
  cleanExpiredScratchpad as _cleanExpiredScratchpad,
  pruneToolLogs as _pruneToolLogs,
} from './consolidation.js';

// Validation — imported from validation.ts
import { getEffectiveProject as _getEffectiveProject } from './validation.js';

// ============================================================================
// Project Detection
// ============================================================================
let currentProjectId: string = GLOBAL_PROJECT;
let currentProjectPath: string | null = null;

function detectProject(startPath?: string): { id: string; path: string | null; source: string } {
  const envProject = process.env.CLAUDE_PROJECT || process.env.JUST_MEMORY_PROJECT;
  if (envProject) {
    return { id: envProject, path: null, source: 'env' };
  }
  
  const searchPath = startPath || process.cwd();
  let current = resolve(searchPath);
  const root = platform() === 'win32' ? current.split(sep)[0] + sep : '/';
  
  while (current !== root) {
    const gitPath = join(current, '.git');
    if (existsSync(gitPath)) {
      const projectName = basename(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      return { id: projectName, path: current, source: 'git' };
    }
    
    const packagePath = join(current, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
        const projectName = (pkg.name || basename(current)).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        return { id: projectName, path: current, source: 'package.json' };
      } catch { /* ignore parse errors in package.json during project detection */ }
    }
    
    const pyprojectPath = join(current, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      const projectName = basename(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      return { id: projectName, path: current, source: 'pyproject.toml' };
    }
    
    const cargoPath = join(current, 'Cargo.toml');
    if (existsSync(cargoPath)) {
      const projectName = basename(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      return { id: projectName, path: current, source: 'Cargo.toml' };
    }
    
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  
  return { id: GLOBAL_PROJECT, path: null, source: 'default' };
}

function initProject() {
  const detected = detectProject();
  currentProjectId = detected.id;
  currentProjectPath = detected.path;
  console.error(`[Just-Memory] Project: ${detected.id} (${detected.source})`);
}

initProject();

// ============================================================================
// Database Setup
// ============================================================================
// DB_PATH, DB_DIR imported from config.ts
if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
if (!existsSync(MODEL_CACHE)) mkdirSync(MODEL_CACHE, { recursive: true });
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Startup integrity check
const integrityResult = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
if (integrityResult[0]?.integrity_check !== 'ok') {
  console.error('[Just-Memory] ⚠️ DATABASE INTEGRITY CHECK FAILED:', integrityResult);
  console.error('[Just-Memory] Attempting to continue, but data may be corrupted. Consider restoring from backup.');
} else {
  console.error('[Just-Memory] Database integrity check passed');
}

try {
  sqliteVec.load(db);
  console.error('[Just-Memory] sqlite-vec extension loaded');
} catch (err) {
  console.error('[Just-Memory] Warning: sqlite-vec load failed:', err);
}

// ============================================================================
// v4.0: Write Lock (async mutex for serialized writes)
// ============================================================================
const writeLock = new WriteLock(WRITE_LOCK_MAX_CONCURRENT);

// ============================================================================
// v4.0: VectorStore (Qdrant sidecar or sqlite-vec fallback)
// ============================================================================
let vectorStore: VectorStore | null = null;
let embeddingWorkerTimer: NodeJS.Timeout | null = null;

async function initVectorStore(): Promise<void> {
  // Try Qdrant first if enabled
  if (QDRANT_ENABLED) {
    try {
      const qdrant = new QdrantStore({
        dataDir: QDRANT_DATA_DIR,
        embeddingDim: EMBEDDING_DIM,
        port: QDRANT_PORT,
        collection: QDRANT_COLLECTION,
        binaryPath: QDRANT_BINARY,
      });
      const started = await qdrant.start();
      if (started) {
        vectorStore = qdrant;
        console.error(`[Just-Memory] VectorStore: Qdrant (${EMBEDDING_DIM}-dim, port ${QDRANT_PORT})`);
        return;
      }
    } catch (err: any) {
      console.error(`[Just-Memory] Qdrant init failed: ${err.message}, falling back to sqlite-vec`);
    }
  }

  // Fallback: SqliteVecStore wrapping existing sqlite-vec + optional HNSW
  vectorStore = new SqliteVecStore({
    db,
    embeddingDim: EMBEDDING_DIM,
    hnswSearch: (embedding, limit, efSearch) => searchHNSW(embedding, limit, efSearch),
    hnswReady: () => hnswIndexReady,
  });
  console.error(`[Just-Memory] VectorStore: sqlite-vec (${EMBEDDING_DIM}-dim, HNSW=${hnswIndexReady ? 'yes' : 'pending'})`);
}

// Start VectorStore init (non-blocking)
initVectorStore().catch(err => {
  console.error('[Just-Memory] VectorStore init failed:', err);
});

/**
 * v4.0: Lazy embedding worker — embeds memories with NULL embeddings in background batches.
 * Allows memory_store to return instantly, embedding happens asynchronously.
 */
async function runEmbeddingWorker(): Promise<number> {
  if (!vectorStore?.isReady()) return 0;

  const orphans = db.prepare(`
    SELECT id, content FROM memories
    WHERE embedding IS NULL AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(EMBEDDING_WORKER_BATCH_SIZE) as Array<{ id: string; content: string }>;

  if (orphans.length === 0) return 0;

  let embedded = 0;
  for (const mem of orphans) {
    try {
      const embedding = await generateEmbedding(mem.content);
      if (embedding) {
        // Store in SQLite + fetch project_id atomically under write lock
        const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
        const projectId = await writeLock.withLock(() => {
          db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(buffer, mem.id);
          return (db.prepare('SELECT project_id FROM memories WHERE id = ?').get(mem.id) as { project_id: string } | undefined)?.project_id || GLOBAL_PROJECT;
        });
        // Also upsert to VectorStore (Qdrant)
        await vectorStore!.upsert(mem.id, embedding, { projectId });
        embedded++;
      }
    } catch (err: any) {
      console.error(`[Just-Memory] Embedding worker failed for ${mem.id}: ${err.message}`);
    }
  }

  if (embedded > 0) {
    console.error(`[Just-Memory] Embedding worker: processed ${embedded}/${orphans.length} memories`);
  }
  return embedded;
}

function startEmbeddingWorker(): void {
  if (embeddingWorkerTimer) return;
  embeddingWorkerTimer = setInterval(() => {
    runEmbeddingWorker().catch(err => {
      console.error('[Just-Memory] Embedding worker error:', err);
    });
  }, EMBEDDING_WORKER_INTERVAL_MS);
}

// ============================================================================
// Schema Init (logic in schema.ts)
// ============================================================================
runMigrations(db);

let _vectorliteLoaded = false;
let hnswIndexReady = false;
let searchHNSW: SearchHNSWFn = () => [];

// Init vectorlite (non-blocking)
_initVectorlite(db).then(state => {
  _vectorliteLoaded = state.vectorliteLoaded;
  hnswIndexReady = state.hnswIndexReady;
  searchHNSW = state.searchHNSW;
}).catch(() => { /* silently fall back to sqlite-vec */ });

createCoreTables(db);
seedEntityTypes(db);
runLegacyCleanup(db);
let fts5Ready = initFTS5(db);

// Initialize chat ingestion schema (hierarchical conversation storage)
initChatSchema(db);

// Wrapper that provides currentProjectId as fallback
function getEffectiveProject(projectId?: string): string {
  return _getEffectiveProject(projectId, currentProjectId);
}

// ============================================================================
// Tool Logging Wrappers (logic in tool-logging.ts)
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP args/output are untyped JSON
function logToolCall(toolName: string, args: any, output: unknown, success: boolean, error: string | null, durationMs: number, projectId: string): string {
  return _logToolCall(db, toolName, args, output, success, error, durationMs, projectId, updateSessionState);
}
function getToolHistory(toolName?: string, success?: boolean, since?: string, limit: number = 50, projectId?: string) {
  return _getToolHistory(db, toolName, success, since, limit, projectId);
}

function pruneToolLogs(daysToKeep: number = 7): number {
  return _pruneToolLogs(db, daysToKeep);
}

// ============================================================================
// Session & Crash Recovery — imported from session.ts
// ============================================================================
import {
  CURRENT_SESSION_ID,
  updateSessionHeartbeat as _updateSessionHeartbeat,
  updateSessionState as _updateSessionState,
  detectCrashStateForBriefing as _detectCrashStateForBriefing,
  markCrashReported, updateStoredSessionId as _updateStoredSessionId,
  clearSessionState as _clearSessionState,
  markSessionStart as _markSessionStart,
  setCurrentTask as _setCurrentTask,
  updateTaskProgress as _updateTaskProgress,
  clearCurrentTask as _clearCurrentTask,
  getCurrentTask as _getCurrentTask,
  incrementBriefingSeq as _incrementBriefingSeq,
  needsAutoBackup,
} from './session.js';

// Wrappers that inject db + currentProjectId
function updateSessionHeartbeat() { _updateSessionHeartbeat(db, currentProjectId); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP args are untyped JSON
function updateSessionState(toolName: string, args: any) { _updateSessionState(db, currentProjectId, toolName, args); }
function detectCrashStateForBriefing() { return _detectCrashStateForBriefing(db, currentProjectId); }
function updateStoredSessionId() { _updateStoredSessionId(db, currentProjectId); }
function clearSessionState() { _clearSessionState(db, currentProjectId); }
function markSessionStart() { _markSessionStart(db, currentProjectId); }
function setCurrentTask(description: string, totalSteps?: number) { _setCurrentTask(db, currentProjectId, description, totalSteps); }
function updateTaskProgress(stepNumber: number, stepDescription: string) { _updateTaskProgress(db, currentProjectId, stepNumber, stepDescription); }
function clearCurrentTask() { _clearCurrentTask(db, currentProjectId); }
function getCurrentTask() { return _getCurrentTask(db, currentProjectId); }
function incrementBriefingSeq() { return _incrementBriefingSeq(db, currentProjectId); }

// startupRecoveryInit stays in monolith (references backupMemories + ingestAllClaudeCode defined later)
async function startupRecoveryInit(): Promise<{ ingested: number; backed_up: boolean }> {
  let ingested = 0;
  let backed_up = false;

  console.error(`[Just-Memory] MCP Server starting with session ID: ${CURRENT_SESSION_ID}`);

  if (needsAutoBackup()) {
    try {
      backupMemories(currentProjectId);
      backed_up = true;
      console.error('[Just-Memory] Auto-backup created (>24h since last)');
    } catch (e) {
      console.error('[Just-Memory] Auto-backup failed:', e);
    }
  }

  try {
    const result = ingestAllClaudeCode(db, currentProjectId);
    ingested = result.imported;
    if (ingested > 0) {
      console.error(`[Just-Memory] Auto-ingested ${ingested} new conversations`);
    }
  } catch (e) {
    console.error('[Just-Memory] Auto-ingest failed:', e);
  }

  // v4.1: Auto-extract facts from conversations that have messages but no extracted facts yet
  try {
    const unextracted = db.prepare(`
      SELECT DISTINCT cm.conversation_id
      FROM conversation_messages cm
      LEFT JOIN memory_sources ms ON cm.conversation_id = ms.conversation_id
      WHERE ms.id IS NULL
      GROUP BY cm.conversation_id
      HAVING COUNT(cm.id) > 0
      LIMIT 5
    `).all() as Array<{ conversation_id: string }>;

    let factsExtracted = 0;
    for (const row of unextracted) {
      try {
        const extracted = extractFactsFromConversation(db, row.conversation_id, currentProjectId);
        factsExtracted += extracted.factsExtracted;
      } catch { /* skip individual failures */ }
    }
    if (factsExtracted > 0) {
      console.error(`[Just-Memory] Auto-extracted ${factsExtracted} facts from ${unextracted.length} conversations`);
    }
  } catch (e) {
    console.error('[Just-Memory] Auto-extract failed:', e);
  }

  // v4.2: Auto-summarize up to 3 unsummarized conversations
  try {
    const summaryResult = await summarizeBatch(db, currentProjectId, 3);
    if (summaryResult.summarized > 0) {
      console.error(`[Just-Memory] Auto-summarized ${summaryResult.summarized} conversations`);
    }
  } catch (e) {
    console.error('[Just-Memory] Auto-summarize failed:', e);
  }

  // v4.1 Phase 3: Clean up garbage auto-extracted facts on startup
  try {
    const cleanup = cleanupGarbageFacts(db, currentProjectId);
    if (cleanup.memoriesDeleted > 0 || cleanup.entitiesDeleted > 0) {
      console.error(`[Just-Memory] Cleaned up ${cleanup.memoriesDeleted} garbage facts, ${cleanup.entitiesDeleted} garbage entities`);
    }
  } catch (e) {
    console.error('[Just-Memory] Garbage cleanup failed:', e);
  }

  // v4.2: Recalibrate contradiction counts to match actual unresolved edges
  try {
    const recal = _recalibrateContradictionCounts(db, currentProjectId);
    if (recal.recalibrated > 0) {
      console.error(`[Just-Memory] Recalibrated ${recal.recalibrated} memory contradiction counts`);
    }
  } catch (e) {
    console.error('[Just-Memory] Contradiction recalibration failed:', e);
  }

  markSessionStart();
  return { ingested, backed_up };
}


// ============================================================================
// Retention, strength, confidence — imported from memory.ts
// ============================================================================

// ============================================================================
// Contradiction Detection — imported from contradiction.ts
// HNSW provider + wrappers for functions imported from memory.ts
// ============================================================================

/** HNSW provider adapter for the contradiction module */
function getHNSWProvider(): HNSWProvider {
  return {
    isReady: () => hnswIndexReady,
    search: (embedding, limit, efSearch) => searchHNSW(embedding, limit, efSearch),
  };
}

/** Wrapper that injects monolith globals (db, hnsw) into the extracted module */
async function findContradictionsEnhanced(
  content: string,
  projectId: string,
  limit = CONTRADICTION_CONFIG.MAX_RESULTS,
  excludeId?: string,
  includeSemanticSearch = true
): Promise<ContradictionResult[]> {
  return _findContradictionsEnhanced(db, content, projectId, getHNSWProvider(), limit, excludeId, includeSemanticSearch);
}

// Memory CRUD wrappers — inject db + contradiction finder
function storeMemory(content: string, type = 'note', tags: string[] = [], importance = 0.5, confidence = 0.5, projectId?: string) {
  return _storeMemory(db, findContradictionsEnhanced, content, type, tags, importance, confidence, getEffectiveProject(projectId));
}
function reembedOrphaned(projectId?: string, limit = 50, forceRebuild = false) {
  return _reembedOrphaned(db, getEffectiveProject(projectId), limit, forceRebuild);
}
function recallMemory(id: string, projectId?: string) { return _recallMemory(db, id, getEffectiveProject(projectId)); }
function updateMemory(id: string, updates: MemoryUpdates, projectId?: string) { return _updateMemory(db, findContradictionsEnhanced, id, updates, getEffectiveProject(projectId)); }
function deleteMemory(id: string, permanent = false, projectId?: string) { return _deleteMemory(db, id, permanent, getEffectiveProject(projectId)); }
function listMemories(projectId?: string, limit = 20, includeDeleted = false) {
  return _listMemories(db, getEffectiveProject(projectId), limit, includeDeleted);
}
function getBriefingMemories(projectId: string, coreLimit = 5, recentLimit = 5) {
  return _getBriefingMemories(db, getEffectiveProject(projectId), coreLimit, recentLimit);
}
function confirmMemory(id: string, sourceId?: string, projectId?: string) { return _confirmMemory(db, id, sourceId, getEffectiveProject(projectId)); }
function contradictMemory(id: string, contradictingId?: string, projectId?: string) { return _contradictMemory(db, id, contradictingId, getEffectiveProject(projectId)); }
function findContradictionsProactive(content: string, projectId?: string, limit = 10) {
  return _findContradictionsProactive(findContradictionsEnhanced, content, getEffectiveProject(projectId), limit);
}

// ============================================================================
// Search Functions — imported from search.ts
// v4.0: Pass VectorStore when available, fallback to HNSWProvider
// ============================================================================
function hybridSearch(query: string, projectId: string, limit = 10, confidenceThreshold = 0) {
  return _hybridSearch(db, query, projectId, limit, confidenceThreshold, vectorStore || getHNSWProvider(), fts5Ready);
}

// ============================================================================
// Edges, Scratchpad, Entities — imported from entities.ts
// ============================================================================
function createEdge(fromId: string, toId: string, relationType: string, confidence = 1.0, metadata = {}, projectId?: string) {
  return _createEdge(db, fromId, toId, relationType, confidence, metadata, getEffectiveProject(projectId));
}
function queryEdges(memoryId: string, direction = 'both', projectId?: string) {
  return _queryEdges(db, memoryId, direction, getEffectiveProject(projectId));
}
function invalidateEdge(edgeId: string) { return _invalidateEdge(db, edgeId); }
function scratchSet(key: string, value: string, ttlSeconds?: number, projectId?: string) {
  return _scratchSet(db, key, value, ttlSeconds, getEffectiveProject(projectId));
}
function scratchGet(key: string, projectId?: string) { return _scratchGet(db, key, getEffectiveProject(projectId)); }
function scratchDelete(key: string, projectId?: string) { return _scratchDelete(db, key, getEffectiveProject(projectId)); }
function scratchList(projectId?: string) { return _scratchList(db, getEffectiveProject(projectId)); }
function scratchClear(projectId?: string) { return _scratchClear(db, getEffectiveProject(projectId)); }
function createEntity(name: string, entityType = 'concept', observations: string[] = [], projectId?: string) {
  return _createEntity(db, name, entityType, observations, getEffectiveProject(projectId));
}
function getEntity(name: string, projectId?: string) { return _getEntity(db, name, getEffectiveProject(projectId)); }
function linkEntities(from: string, relationType: string, to: string, projectId?: string) {
  return _linkEntities(db, from, relationType, to, getEffectiveProject(projectId));
}
function searchEntities(query: string, entityType?: string, projectId?: string, limit = 20) {
  return _searchEntities(db, query, entityType, getEffectiveProject(projectId), limit);
}
function getBriefingEntities(projectId: string, limit = 10) {
  return _getBriefingEntities(db, getEffectiveProject(projectId), limit);
}
function observeEntity(name: string, observations: string[], projectId?: string) {
  return _observeEntity(db, name, observations, getEffectiveProject(projectId));
}
function deleteEntity(name: string, projectId?: string) { return _deleteEntity(db, name, getEffectiveProject(projectId)); }
function defineEntityType(name: string, parentType?: string, description?: string) {
  return _defineEntityType(db, name, parentType, description);
}
function getTypeHierarchy(typeName: string) { return _getTypeHierarchy(db, typeName); }
function listEntityTypes() { return _listEntityTypes(db); }
function searchEntitiesByTypeHierarchy(entityType: string, query?: string, projectId?: string, limit = 50) {
  return _searchEntitiesByTypeHierarchy(db, entityType, query, getEffectiveProject(projectId), limit);
}

// ============================================================================
// Proactive Retrieval Wrapper (logic in stats.ts)
// ============================================================================
function suggestFromContext(contextText: string, projectId?: string, limit = 10) {
  return _suggestFromContext(db, contextText, getEffectiveProject(projectId), limit);
}










// ============================================================================
// Sleep Consolidation Functions
// ============================================================================

// Track last activity time for idle detection
let lastActivityTime = Date.now();
let consolidationTimer: NodeJS.Timeout | null = null;
let activeConsolidation: Promise<unknown> | null = null;
// IDLE_THRESHOLD_MS, CONSOLIDATION_INTERVAL_MS imported from config.ts

/**
 * Check if system is idle
 */
function isIdle(): boolean {
  return Date.now() - lastActivityTime > IDLE_THRESHOLD_MS;
}

// Consolidation pure functions — imported from consolidation.ts
// v4.0: Prefer async VectorStore-aware version when store is ready
function findSimilarMemories(projectId?: string, similarityThreshold = 0.85, limit = 20) {
  return _findSimilarMemories(db, getEffectiveProject(projectId), similarityThreshold, limit);
}
function strengthenActiveMemories(projectId?: string) {
  return _strengthenActiveMemories(db, getEffectiveProject(projectId));
}
function applyMemoryDecay(projectId?: string) {
  return _applyMemoryDecay(db, getEffectiveProject(projectId));
}
function cleanExpiredScratchpad(projectId?: string) {
  return _cleanExpiredScratchpad(db, getEffectiveProject(projectId));
}

/**
 * Run full consolidation cycle
 */
async function runConsolidation(projectId?: string): Promise<Record<string, unknown>> {
  const project = getEffectiveProject(projectId);
  
  // Advisory lock: prevent multiple instances from consolidating simultaneously
  // Uses atomic transaction to prevent TOCTOU race condition
  const lockKey = '__system_consolidation_lock';
  const lockValue = `${process.pid}_${Date.now()}`;
  const LOCK_TIMEOUT_MS = 300000; // 5 minutes (v4.3.1: increased from 2min for large DBs)

  const acquireLock = db.transaction(() => {
    const existingLock = db.prepare('SELECT value, created_at FROM scratchpad WHERE key = ? AND project_id = ?').get(lockKey, project) as { value: string; created_at: string } | undefined;

    if (existingLock) {
      const lockAge = Date.now() - new Date(existingLock.created_at).getTime();
      // If lock is less than 5 minutes old, another instance is consolidating
      if (lockAge < LOCK_TIMEOUT_MS) {
        return { acquired: false, reason: 'Another instance is consolidating', locked_by: existingLock.value };
      }
      // Stale lock (instance crashed) — take over
      console.error(`[Just-Memory] Stale consolidation lock detected (${lockAge}ms old), taking over`);
    }

    // Acquire lock atomically within this transaction
    db.prepare('INSERT OR REPLACE INTO scratchpad (key, value, project_id, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(lockKey, lockValue, project);
    return { acquired: true, lockValue };
  });

  const lockResult = acquireLock();
  if (!lockResult.acquired) {
    return { skipped: true, ...lockResult };
  }
  
  try {
  const startTime = Date.now();
  const idleDetected = isIdle();

  // Wrap all consolidation writes in a transaction
  const doConsolidate = db.transaction(() => {
    const strengthened = strengthenActiveMemories(project);
    const decayed = applyMemoryDecay(project);
    const scratchpad_cleaned = cleanExpiredScratchpad(project);
    const similar_memories = findSimilarMemories(project, 0.85, 10);
    const tool_logs_pruned = pruneToolLogs(7);
    const garbage_cleaned = cleanupGarbageFacts(db, project);

    const duration_ms = Date.now() - startTime;

    // Log consolidation to scratchpad instead of memories (no embedding waste)
    // Keep only the last 10 consolidation logs
    const consolidationKey = `consolidation_log_${Date.now()}`;
    db.prepare(`
      INSERT OR REPLACE INTO scratchpad (key, value, project_id, created_at, expires_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now', '+7 days'))
    `).run(
      consolidationKey,
      JSON.stringify({
        type: 'consolidation_run',
        results: {
          strengthened,
          decayed,
          cleaned: scratchpad_cleaned,
          tool_logs_pruned,
          garbage_cleaned,
          similar_found: similar_memories.length
        },
        duration_ms
      }),
      project
    );

    // Cleanup old consolidation logs (keep only last 10)
    db.prepare(`
      DELETE FROM scratchpad
      WHERE key LIKE 'consolidation_log_%'
        AND project_id = ?
        AND key NOT IN (
          SELECT key FROM scratchpad
          WHERE key LIKE 'consolidation_log_%' AND project_id = ?
          ORDER BY created_at DESC LIMIT 10
        )
    `).run(project, project);

    return {
      project_id: project,
      started_at: new Date().toISOString(),
      idle_detected: idleDetected,
      strengthened,
      decayed,
      scratchpad_cleaned,
      tool_logs_pruned,
      garbage_cleaned,
      similar_memories,
      duration_ms
    };
  });

  const consolidateResult = doConsolidate();

  // WAL checkpoint AFTER transaction completes to avoid deadlock risk
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch {
    // Non-critical - checkpoint failure is acceptable
  }

  // Re-embed orphaned memories (async, outside transaction)
  const reembedded = await reembedOrphaned(project, 50);

  // Auto-backup if last backup is >24h old
  let autoBackup: Record<string, unknown> | null = null;
  try {
    const backups = listBackups();
    const lastBackupTime = backups.backups.length > 0 ? new Date(backups.backups[0].created).getTime() : 0;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (Date.now() - lastBackupTime > twentyFourHours) {
      autoBackup = backupMemories(project);
      console.error(`[Just-Memory] Auto-backup created: ${autoBackup.filename}`);
    }
  } catch (err: any) {
    console.error(`[Just-Memory] Auto-backup failed: ${err.message}`);
  }

  return { ...consolidateResult, reembedded, autoBackup };
  } finally {
    // Release advisory lock
    db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?').run(lockKey, project);
  }
}

/**
 * Start background consolidation timer
 */
function startConsolidationTimer() {
  if (consolidationTimer) return;

  consolidationTimer = setInterval(() => {
    if (isIdle() && !activeConsolidation) {
      activeConsolidation = Promise.race([
        runConsolidation(),
        new Promise(resolve => setTimeout(resolve, CONSOLIDATION_HARD_TIMEOUT_MS)) // 5-minute hard timeout
      ])
        .catch((err: any) => {
          console.error('[Just-Memory] Background consolidation error:', err.message);
        })
        .finally(() => {
          activeConsolidation = null;
        });
    }
  }, CONSOLIDATION_INTERVAL_MS);
}







// ============================================================================
// Scheduled Tasks Wrappers (logic in scheduled-tasks.ts)
// ============================================================================
function createScheduledTask(title: string, scheduleExpr: string, description?: string, recurring = false, actionType = 'reminder', actionData?: Record<string, unknown>, memoryId?: string, projectId?: string) {
  return _createScheduledTask(db, title, scheduleExpr, description, recurring, getEffectiveProject(projectId), actionType, actionData, memoryId);
}
function listScheduledTasks(status?: string, projectId?: string, limit = 50) {
  return _listScheduledTasks(db, status, getEffectiveProject(projectId), limit);
}
function checkDueTasks(projectId?: string) {
  return _checkDueTasks(db, getEffectiveProject(projectId));
}
function completeScheduledTask(taskId: string) {
  return _completeScheduledTask(db, taskId);
}
function cancelScheduledTask(taskId: string) {
  return _cancelScheduledTask(db, taskId);
}

// ============================================================================
// Contradiction Resolution Wrappers (logic in contradiction-resolution.ts)
// ============================================================================
function getPendingResolutions(projectId?: string, limit = 20) {
  return _getPendingResolutions(db, getEffectiveProject(projectId), limit);
}
function resolveContradiction(resolutionId: string, resolutionType: 'keep_first' | 'keep_second' | 'keep_both' | 'merge' | 'delete_both', note?: string, mergedContent?: string) {
  return _resolveContradiction(db, resolutionId, resolutionType, note, mergedContent);
}
function scanContradictions(projectId?: string, autoCreateResolutions = true) {
  return _scanContradictions(db, getEffectiveProject(projectId), autoCreateResolutions);
}










// ============================================================================
// Backup/Restore Wrappers (logic in backup.ts)
// ============================================================================
function backupMemories(projectId?: string) {
  return _backupMemories(db, getEffectiveProject(projectId));
}
function restoreMemories(backupPath: string, mode = 'merge', targetProject?: string) {
  return _restoreMemories(db, backupPath, mode, targetProject, currentProjectId);
}
function listBackups() {
  return _listBackups();
}

// Auto-backup flag (used by shutdown handler)
const autoBackupEnabled = true;

// Signal handlers moved to main() for proper shutdown sequence

// ============================================================================
// Stats & Project Wrappers (logic in stats.ts)
// ============================================================================
function getStats(projectId?: string) {
  return _getStats(db, projectId ? getEffectiveProject(projectId) : undefined);
}
function listProjects() {
  return _listProjects(db, currentProjectId);
}

function setCurrentProject(projectId: string, path?: string) {
  currentProjectId = projectId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  currentProjectPath = path || null;
  return { project_id: currentProjectId, path: currentProjectPath, set: true };
}


// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new Server(
  { name: 'just-memory', version: '5.0.0' },
  { capabilities: { tools: {} } }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

/** Sanitize error messages before sending to MCP client — strips file paths and stack traces */
function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Strip absolute file paths, keep first 200 chars
  return raw.replace(/\/[^\s:]+/g, '[path]').slice(0, 200);
}

// ============================================================================
// Tool Dispatch Object (wires monolith wrappers into extracted handler)
// ============================================================================

/** Briefing handler — stays in monolith due to deep access to session state */
function buildBriefingResult(projectId?: string, maxTokens?: number) {
  const briefingProjectId = getEffectiveProject(projectId);

  // v4.1: Tiered memory selection — core knowledge always surfaces
  const tokens = maxTokens || 500;
  const coreLimit = tokens < 300 ? 2 : 5;
  const recentLimit = tokens < 300 ? 3 : tokens > 800 ? 10 : 5;

  const briefingMemories = getBriefingMemories(briefingProjectId, coreLimit, recentLimit);
  const briefingEntities = getBriefingEntities(briefingProjectId, 10);

  // Check for crash recovery - compares session IDs to detect new session
  const crashState = detectCrashStateForBriefing();

  // Get recent scheduled tasks that may be due
  const pendingTasks = db.prepare(`
    SELECT title, description, next_run FROM scheduled_tasks
    WHERE status = 'pending' AND (project_id = ? OR project_id = 'global')
    AND next_run <= datetime('now', '+1 hour')
    ORDER BY next_run LIMIT 5
  `).all(briefingProjectId) as Array<{ title: string; description: string | null; next_run: string | null }>;

  // v3.12: Get in-progress task (for context recovery after retry/compaction)
  const inProgressTask = getCurrentTask();

  // v4.1: Trim task steps to last 5 for briefing (full list via memory_task get)
  if (inProgressTask && inProgressTask.steps && inProgressTask.steps.length > 5) {
    inProgressTask.steps = inProgressTask.steps.slice(-5);
  }

  // v3.12: Increment briefing sequence counter
  const briefingSeq = incrementBriefingSeq();

  // Build crash recovery context if detected
  let crashRecoveryResult = null;
  if (crashState.crashed) {
    crashRecoveryResult = {
      detected: true,
      message: 'Previous session ended without graceful shutdown',
      last_heartbeat: crashState.lastHeartbeat,
      last_tool: crashState.lastTool,
      working_files: crashState.workingFiles,
      previous_session_start: crashState.sessionStart,
    };
    // Mark as reported so we don't repeat on next briefing in same session
    markCrashReported();
  }

  // Update stored session ID (marks this session as "seen")
  updateStoredSessionId();

  return {
    project_id: briefingProjectId,
    core_memories: briefingMemories.core,     // v4.1: High-importance (>= 0.8), always present
    recent_memories: briefingMemories.recent,  // v4.1: Most recently accessed
    entities: briefingEntities,
    stats: getStats(briefingProjectId),
    crash_recovery: crashRecoveryResult,
    in_progress_task: inProgressTask,
    briefing_seq: briefingSeq,
    pending_tasks: pendingTasks.length > 0 ? pendingTasks : null,
    current_session_id: CURRENT_SESSION_ID,
  };
}

/** Health handler — stays in monolith due to deep access to vectorStore, writeLock, etc. */
async function buildHealthInfo() {
  const sessionStartMs = parseInt(CURRENT_SESSION_ID.split('_')[0]) || Date.now();
  let dbIntegrity = false;
  try { dbIntegrity = ((db.pragma('integrity_check') as Array<{ integrity_check: string }>)[0])?.integrity_check === 'ok'; } catch { /* */ }
  const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL').get() as { c: number } | undefined)?.c || 0;
  const migrationCount = (() => { try { return (db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number } | undefined)?.c || 0; } catch { return 0; } })();
  const pendingEmbeddings = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE embedding IS NULL AND deleted_at IS NULL').get() as { c: number } | undefined)?.c || 0;
  const vectorCount = vectorStore?.isReady() ? await vectorStore.count() : 0;
  return {
    status: 'ok',
    version: '5.0.0',
    session_id: CURRENT_SESSION_ID,
    uptime_seconds: Math.floor((Date.now() - sessionStartMs) / 1000),
    models: {
      embedder: getModelState().embedderReady,
      nli: getModelState().nliReady,
      vectorlite: _vectorliteLoaded,
      embedding_model: EMBEDDING_MODEL,
      embedding_dim: EMBEDDING_DIM,
    },
    vector_store: {
      backend: vectorStore?.backend || 'none',
      ready: vectorStore?.isReady() || false,
      vectors: vectorCount,
      pending_embeddings: pendingEmbeddings,
    },
    concurrency: {
      max_writers: WRITE_LOCK_MAX_CONCURRENT,
      ...writeLock.stats,
    },
    database: {
      path: DB_PATH,
      integrity: dbIntegrity,
      memories: memCount,
      migrations: migrationCount
    },
    project: currentProjectId
  };
}

/** Chat ingest wrapper — parse + ingest inline */
function chatParseAndIngest(filePath: string, projectId?: string): ChatParseAndIngestResult {
  const parsed = parseClaudeCodeJsonl(filePath);
  if (!parsed) {
    return { error: 'Failed to parse conversation file', file: filePath };
  }
  const importResult = ingestConversation(db, parsed, getEffectiveProject(projectId));
  return importResult || { error: 'Conversation already imported or failed', sessionId: parsed.sessionId };
}

/** Chat list wrapper — inline SQL */
function chatListConversations(projectId?: string, limit?: number): ChatConversationListRow[] {
  const chatLimit = Math.min(limit || 20, 100);
  const chatProject = getEffectiveProject(projectId);
  return db.prepare(`
    SELECT id, source, source_session_id, project_context, started_at, ended_at,
           message_count, tool_use_count, total_input_tokens, total_output_tokens, model
    FROM conversations WHERE project_id = ? OR project_id = 'global'
    ORDER BY started_at DESC LIMIT ?
  `).all(chatProject, chatLimit) as ChatConversationListRow[];
}

const toolDispatch: ToolDispatch = {
  // Memory CRUD
  storeMemory,
  recallMemory,
  updateMemory,
  deleteMemory,
  findContradictionsProactive,
  // Search
  hybridSearch,
  listMemories,
  // Confidence
  confirmMemory,
  contradictMemory,
  // Edges
  createEdge,
  queryEdges,
  invalidateEdge,
  // Scratchpad
  scratchSet,
  scratchGet,
  scratchDelete,
  scratchList,
  scratchClear,
  // Entities
  createEntity,
  getEntity,
  searchEntities,
  observeEntity,
  deleteEntity,
  linkEntities,
  defineEntityType,
  getTypeHierarchy,
  listEntityTypes,
  searchEntitiesByTypeHierarchy,
  // Suggestions
  suggestFromContext,
  // Scheduled Tasks
  createScheduledTask,
  listScheduledTasks,
  checkDueTasks,
  completeScheduledTask,
  cancelScheduledTask,
  // Contradictions
  scanContradictions,
  getPendingResolutions,
  resolveContradiction,
  // Backup
  backupMemories,
  restoreMemories,
  listBackups,
  // Stats
  getStats,
  getToolHistory,
  // Embeddings
  reembedOrphaned,
  // Briefing
  getBriefingResult: buildBriefingResult,
  // Task tracking
  setCurrentTask,
  updateTaskProgress,
  clearCurrentTask,
  getCurrentTask,
  // Projects
  listProjects,
  setCurrentProject,
  // Health
  getHealthInfo: buildHealthInfo,
  // Chat
  discoverConversations: (basePath) => discoverClaudeCodeConversations(basePath),
  parseAndIngest: chatParseAndIngest,
  ingestAll: (projectId, basePath) => ingestAllClaudeCode(db, getEffectiveProject(projectId), basePath),
  ingestExport: (filePath, projectId) => ingestClaudeDesktopExport(db, filePath, getEffectiveProject(projectId)),
  getConversationStats: (projectId) => getConversationStats(db, getEffectiveProject(projectId)),
  searchConversations: (query, projectId, limit) => searchConversations(db, query, getEffectiveProject(projectId), limit || 20),
  getConversation: (conversationId) => getConversation(db, conversationId),
  listConversations: chatListConversations,
  extractFacts: (conversationId, projectId) => extractFactsFromConversation(db, conversationId, getEffectiveProject(projectId)),
  extractFactsBatch: (projectId, limit) => extractFactsBatch(db, getEffectiveProject(projectId), limit || 100),
  summarizeConversation: (conversationId, projectId) => summarizeConversation(db, conversationId, getEffectiveProject(projectId)),
  summarizeBatch: (projectId, limit) => summarizeBatch(db, getEffectiveProject(projectId), limit || 5),
  searchSummaries: (query, projectId, limit) => searchConversationSummaries(db, query, getEffectiveProject(projectId), limit || 10),
  extractTopics: (conversationId, projectId) => extractConversationTopics(db, conversationId, getEffectiveProject(projectId)),
  // Helper
  getEffectiveProject,
};

// Handle tool calls (dispatch logic in tool-handlers.ts)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP args are untyped JSON from wire
  const args = rawArgs as any;
  lastActivityTime = Date.now();
  updateSessionHeartbeat();
  const startTime = Date.now();
  const shouldLog = !TOOL_LOG_EXCLUDED.includes(name);

  try {
    const result = await dispatchToolCall(name, args, toolDispatch);

    // Log successful tool call
    if (shouldLog) {
      const durationMs = Date.now() - startTime;
      const projectId = args.project_id || currentProjectId;
      logToolCall(name, args, result, true, null, durationMs, projectId);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  } catch (error: any) {
    // Log failed tool call — wrapped in its own try to prevent logging failure from crashing
    try {
      if (shouldLog) {
        const durationMs = Date.now() - startTime;
        const projectId = args?.project_id || currentProjectId;
        logToolCall(name, args, null, false, error.message || String(error), durationMs, projectId);
      }
    } catch (logErr: any) {
      console.error(`[Just-Memory] Tool log also failed: ${logErr.message}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ error: sanitizeErrorMessage(error) }) }],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Just-Memory] Server started (modular)');
  console.error(`[Just-Memory] Session ID: ${CURRENT_SESSION_ID}`);
  console.error(`[Just-Memory] Project: ${currentProjectId} (from ${detectProject().source})`);
  console.error(`[Just-Memory] Database: ${DB_PATH}`);
  console.error(`[Just-Memory] Tools: ${TOOLS.length}`);

  // Startup recovery: auto-ingest, auto-backup
  try {
    const recovery = await startupRecoveryInit();
    if (recovery.ingested > 0 || recovery.backed_up) {
      console.error(`[Just-Memory] Startup: ingested=${recovery.ingested}, backup=${recovery.backed_up}`);
    }
  } catch (e) {
    console.error('[Just-Memory] Startup recovery failed:', e);
  }

  // Start background consolidation timer
  startConsolidationTimer();

  // v4.0: Start lazy embedding worker
  startEmbeddingWorker();

  // Graceful shutdown: clear session state, wait for in-flight work, then close DB cleanly
  const shutdown = async (signal: string) => {
    console.error(`[Just-Memory] Received ${signal}, shutting down gracefully...`);

    // Clear session state (indicates graceful shutdown, not crash)
    clearSessionState();

    // v4.0: Stop embedding worker
    if (embeddingWorkerTimer) {
      clearInterval(embeddingWorkerTimer);
      embeddingWorkerTimer = null;
    }

    // v4.0: Drain write lock queue
    writeLock.drain('Server shutting down');

    if (consolidationTimer) {
      clearInterval(consolidationTimer);
      consolidationTimer = null;
    }
    // Wait for in-flight consolidation to finish (with timeout)
    if (activeConsolidation) {
      console.error('[Just-Memory] Waiting for in-flight consolidation to finish...');
      try {
        await Promise.race([
          activeConsolidation,
          new Promise(r => setTimeout(r, 5000))
        ]);
      } catch {
        // Swallow — consolidation error already logged
      }
    }
    // Run auto-backup BEFORE closing the database
    if (autoBackupEnabled) {
      try {
        console.error('[Just-Memory] Auto-backup on shutdown...');
        const backupResult = backupMemories();
        console.error(`[Just-Memory] Auto-backup saved: ${backupResult.filename}`);
        cleanupOldBackups(BACKUP_DIR, 10);
      } catch (err: any) {
        console.error(`[Just-Memory] Auto-backup failed: ${err.message}`);
      }
    }
    // v4.0: Close VectorStore (stops Qdrant sidecar if running)
    if (vectorStore) {
      try {
        await vectorStore.close();
        console.error('[Just-Memory] VectorStore closed');
      } catch (err: any) {
        console.error(`[Just-Memory] VectorStore close error: ${err.message}`);
      }
    }
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.error('[Just-Memory] Database closed cleanly');
    } catch (err: any) {
      console.error(`[Just-Memory] Error during shutdown: ${err.message}`);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });
}

// Global safety nets — prevent unhandled errors from silently crashing the MCP server
process.on('unhandledRejection', (reason: any) => {
  console.error('[Just-Memory] Unhandled promise rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[Just-Memory] Uncaught exception:', err.message);
  console.error('[Just-Memory] Process is in undefined state after uncaught exception — shutting down cleanly.');
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch { /* best-effort cleanup */ }
  process.exit(1);
});

main().catch(console.error);
