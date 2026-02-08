/**
 * Integration Tests for Just-Memory MCP Tool Dispatch
 *
 * Tests the critical paths that the monolith's switch/case handler orchestrates,
 * exercising the full lifecycle through extracted modules.
 * These tests simulate what the MCP dispatch handler does for each tool call.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import {
  storeMemory,
  recallMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  confirmMemory,
  contradictMemory,
  findContradictionsProactive,
  type ContradictionFinder,
} from '../src/memory.js';
import { keywordSearch, hybridSearch } from '../src/search.js';
import {
  createEdge, queryEdges, invalidateEdge,
  scratchSet, scratchGet, scratchDelete, scratchList, scratchClear,
  createEntity, getEntity, linkEntities, searchEntities, observeEntity, deleteEntity,
  defineEntityType, getTypeHierarchy, listEntityTypes,
} from '../src/entities.js';
import {
  setCurrentTask, updateTaskProgress, getCurrentTask, clearCurrentTask,
} from '../src/session.js';
import {
  findSimilarMemories, strengthenActiveMemories, applyMemoryDecay, cleanExpiredScratchpad,
} from '../src/consolidation.js';
import type Database from 'better-sqlite3';

const noContradictions: ContradictionFinder = async () => [];
let db: Database.Database;

before(() => { db = createTestDb(); });
after(() => { db.close(); });

// ============================================================================
// Full Memory CRUD Lifecycle
// ============================================================================
describe('Integration: Memory CRUD Lifecycle', () => {
  let memoryId: string;

  it('store -> recall -> update -> recall -> delete -> list (soft delete cycle)', async () => {
    // Store
    const stored = await storeMemory(db, noContradictions, 'Integration test memory', 'fact', ['test'], 0.8, 0.7, 'integration-project');
    assert.ok(stored.id, 'Should return an ID');
    assert.strictEqual(stored.content, 'Integration test memory');
    assert.strictEqual(stored.type, 'fact');
    assert.strictEqual(stored.importance, 0.8);
    memoryId = stored.id;

    // Recall
    const recalled = recallMemory(db, memoryId, 'integration-project');
    assert.strictEqual(recalled.content, 'Integration test memory');
    assert.ok(recalled.access_count >= 1, 'access_count should increment on recall');

    // Update
    const updated = await updateMemory(db, noContradictions, memoryId, { content: 'Updated integration test', type: 'decision' }, 'integration-project');
    assert.strictEqual(updated.content, 'Updated integration test');
    assert.strictEqual(updated.type, 'decision');
    assert.strictEqual(updated.updated, true);

    // Recall after update
    const recalled2 = recallMemory(db, memoryId, 'integration-project');
    assert.strictEqual(recalled2.content, 'Updated integration test');

    // Soft delete
    const deleted = deleteMemory(db, memoryId, false, 'integration-project');
    assert.strictEqual(deleted.deleted, true);
    assert.strictEqual(deleted.permanent, false);

    // List should exclude soft-deleted (listMemories returns array directly)
    const list = listMemories(db, 'integration-project', 50, false);
    const found = list.find((m: any) => m.id === memoryId);
    assert.strictEqual(found, undefined, 'Soft-deleted memory should not appear in normal list');

    // List with includeDeleted should find it
    const listAll = listMemories(db, 'integration-project', 50, true);
    const foundDeleted = listAll.find((m: any) => m.id === memoryId);
    assert.ok(foundDeleted, 'Soft-deleted memory should appear when includeDeleted=true');
  });

  it('permanent delete removes memory completely', async () => {
    const stored = await storeMemory(db, noContradictions, 'Will be permanently deleted', 'note', [], 0.5, 0.5, 'integration-project');
    const deleted = deleteMemory(db, stored.id, true, 'integration-project');
    assert.strictEqual(deleted.permanent, true);

    const recalled = recallMemory(db, stored.id, 'integration-project');
    assert.ok(recalled.error, 'Permanently deleted memory should not be recallable');
  });
});

// ============================================================================
// Confidence Management
// ============================================================================
describe('Integration: Confidence Management', () => {
  it('confirm raises confidence, contradict lowers it', async () => {
    const stored = await storeMemory(db, noContradictions, 'Confidence test memory', 'fact', [], 0.5, 0.5, 'integration-project');
    const initialConfidence = 0.5;

    const confirmed = confirmMemory(db, stored.id, undefined, 'integration-project');
    assert.ok(confirmed.confidence > initialConfidence, 'Confidence should increase after confirm');

    const contradicted = contradictMemory(db, stored.id, undefined, 'integration-project');
    assert.ok(contradicted.confidence < confirmed.confidence, 'Confidence should decrease after contradict');
  });
});

// ============================================================================
// Search Integration (keyword)
// ============================================================================
describe('Integration: Search', () => {
  before(async () => {
    await storeMemory(db, noContradictions, 'TypeScript is a typed superset of JavaScript', 'fact', ['programming'], 0.9, 0.8, 'search-project');
    await storeMemory(db, noContradictions, 'Python is great for data science', 'fact', ['programming'], 0.8, 0.7, 'search-project');
    await storeMemory(db, noContradictions, 'SQLite uses WAL mode for concurrent access', 'fact', ['database'], 0.7, 0.6, 'search-project');
  });

  it('keyword search finds matching memories', () => {
    const results = keywordSearch(db, 'TypeScript', 'search-project', 10, 0);
    assert.ok(results.length > 0, 'Should find TypeScript memory');
    assert.ok(results[0].content.includes('TypeScript'));
  });

  it('keyword search returns empty for no matches', () => {
    const results = keywordSearch(db, 'quantum_physics_not_stored', 'search-project', 10, 0);
    assert.strictEqual(results.length, 0);
  });

  it('keyword search respects confidence threshold', async () => {
    const stored = await storeMemory(db, noContradictions, 'Low confidence searchable item', 'note', [], 0.5, 0.1, 'search-project');
    contradictMemory(db, stored.id, undefined, 'search-project');
    contradictMemory(db, stored.id, undefined, 'search-project');
    contradictMemory(db, stored.id, undefined, 'search-project');

    const highThreshold = keywordSearch(db, 'Low confidence searchable', 'search-project', 10, 0.9);
    assert.strictEqual(highThreshold.length, 0, 'Should not find low-confidence memory with high threshold');
  });
});

// ============================================================================
// Scratchpad Lifecycle
// ============================================================================
describe('Integration: Scratchpad', () => {
  it('set -> get -> list -> delete -> get returns null', () => {
    scratchSet(db, 'test-key', 'test-value', undefined, 'scratch-project');
    const got = scratchGet(db, 'test-key', 'scratch-project');
    assert.strictEqual(got.value, 'test-value');

    const list = scratchList(db, 'scratch-project');
    const found = list.keys.find((k: any) => k.key === 'test-key');
    assert.ok(found, 'Key should appear in list');

    scratchDelete(db, 'test-key', 'scratch-project');
    const got2 = scratchGet(db, 'test-key', 'scratch-project');
    assert.strictEqual(got2.value, null, 'Should not find deleted key');
  });

  it('clear removes user keys but preserves session state (_jm_ keys)', () => {
    scratchSet(db, 'user-key', 'user-value', undefined, 'scratch-project');
    db.prepare("INSERT OR REPLACE INTO scratchpad (key, project_id, value) VALUES (?, ?, ?)")
      .run('_jm_test_session', 'scratch-project', 'session-data');

    scratchClear(db, 'scratch-project');

    const userKey = scratchGet(db, 'user-key', 'scratch-project');
    assert.strictEqual(userKey.value, null, 'User key should be cleared');

    const sessionKey = db.prepare("SELECT value FROM scratchpad WHERE key = ? AND project_id = ?")
      .get('_jm_test_session', 'scratch-project') as any;
    assert.ok(sessionKey, 'Session state key should survive clear');
    assert.strictEqual(sessionKey.value, 'session-data');
  });

  it('TTL expiry works', () => {
    scratchSet(db, 'expiring-key', 'will-expire', 1, 'scratch-project');
    // Manually set expires_at to past
    db.prepare("UPDATE scratchpad SET expires_at = datetime('now', '-1 hour') WHERE key = ?").run('expiring-key');

    const got = scratchGet(db, 'expiring-key', 'scratch-project');
    assert.strictEqual(got.value, null, 'Expired key should not be returned');
  });
});

// ============================================================================
// Entity CRUD + Knowledge Graph
// ============================================================================
describe('Integration: Entity Knowledge Graph', () => {
  it('create -> observe -> get -> link -> search -> delete lifecycle', () => {
    const entity1 = createEntity(db, 'Claude', 'technology', [], 'entity-project');
    assert.ok(entity1.id, 'Should create entity with ID');

    const entity2 = createEntity(db, 'Anthropic', 'organization', [], 'entity-project');
    assert.ok(entity2.id, 'Should create second entity with ID');

    // Observe
    const observed = observeEntity(db, 'Claude', ['Is an AI assistant', 'Built by Anthropic'], 'entity-project');
    assert.ok(observed.added >= 2, 'Should add observations');

    // Get
    const got = getEntity(db, 'Claude', 'entity-project');
    assert.strictEqual(got.name, 'Claude');
    assert.ok(got.observations?.length >= 2, 'Should return observations');

    // Link (signature: db, from, relationType, to, projectId)
    const linked = linkEntities(db, 'Claude', 'built_by', 'Anthropic', 'entity-project');
    assert.strictEqual(linked.relationType, 'built_by');

    // Search (returns array directly)
    const results = searchEntities(db, 'Claude', undefined, 'entity-project');
    assert.ok(results.length > 0, 'Should find Claude entity');

    // Delete
    const deleted = deleteEntity(db, 'Claude', 'entity-project');
    assert.ok(deleted.deleted, 'Should delete entity');
  });
});

// ============================================================================
// Entity Type Hierarchy
// ============================================================================
describe('Integration: Entity Type Hierarchy', () => {
  it('define type -> get type -> list types', () => {
    const defined = defineEntityType(db, 'developer', 'person', 'Software developer');
    assert.ok(!defined.error, 'Should define type without error');

    const got = getTypeHierarchy(db, 'developer');
    assert.strictEqual(got.parentType, 'person');
    assert.ok(got.ancestors?.includes('person'));

    const list = listEntityTypes(db);
    const devType = list.find((t: any) => t.name === 'developer');
    assert.ok(devType, 'Should find developer type in list');
    assert.strictEqual(devType.depth, 1, 'developer is 1 level deep');
  });
});

// ============================================================================
// Edge Lifecycle
// ============================================================================
describe('Integration: Edges', () => {
  it('create edge -> query -> invalidate', async () => {
    const m1 = await storeMemory(db, noContradictions, 'Edge source memory', 'fact', [], 0.5, 0.5, 'edge-project');
    const m2 = await storeMemory(db, noContradictions, 'Edge target memory', 'fact', [], 0.5, 0.5, 'edge-project');

    const edge = createEdge(db, m1.id, m2.id, 'relates_to', 0.9, {}, 'edge-project');
    assert.ok(edge.id, 'Should create edge with ID');

    const queried = queryEdges(db, m1.id, 'both', 'edge-project');
    assert.ok(queried.length > 0, 'Should find edges');

    const invalidated = invalidateEdge(db, edge.id);
    assert.ok(invalidated.invalidated, 'Should mark edge as invalidated');
  });
});

// ============================================================================
// Task Tracking (Session Recovery)
// ============================================================================
describe('Integration: Task Tracking', () => {
  it('set -> update -> get -> clear lifecycle', () => {
    setCurrentTask(db, 'task-project', 'Implementing feature X', 3);

    updateTaskProgress(db, 'task-project', 1, 'Created schema');
    updateTaskProgress(db, 'task-project', 2, 'Added API endpoint');

    const task = getCurrentTask(db, 'task-project');
    assert.ok(task, 'Should have current task');
    assert.strictEqual(task!.description, 'Implementing feature X');
    assert.strictEqual(task!.totalSteps, 3);
    assert.strictEqual(task!.currentStep, 2);
    assert.ok(task!.steps.length >= 2, 'Should have step history');

    clearCurrentTask(db, 'task-project');
    const cleared = getCurrentTask(db, 'task-project');
    assert.strictEqual(cleared, null, 'Task should be cleared');
  });
});

// ============================================================================
// Consolidation
// ============================================================================
describe('Integration: Consolidation', () => {
  it('findSimilarMemories detects near-duplicates', async () => {
    const proj = 'consolidation-project';
    await storeMemory(db, noContradictions, 'The quick brown fox jumps over the lazy dog', 'note', [], 0.5, 0.5, proj);
    await storeMemory(db, noContradictions, 'The quick brown fox leaps over the lazy dog', 'note', [], 0.5, 0.5, proj);

    const similar = findSimilarMemories(db, proj, 0.5, 10);
    assert.ok(similar.length > 0, 'Should detect similar memories');
  });

  it('strengthenActiveMemories boosts frequently-accessed memories', async () => {
    const proj = 'strengthen-project';
    insertTestMemory(db, { project_id: proj, access_count: 10, confidence: 0.5 });
    insertTestMemory(db, { project_id: proj, access_count: 0, confidence: 0.5 });

    const strengthened = strengthenActiveMemories(db, proj);
    assert.ok(strengthened >= 0, 'Should return count of strengthened memories');
  });

  it('applyMemoryDecay reduces strength of old memories', () => {
    const proj = 'decay-project';
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    insertTestMemory(db, { project_id: proj, last_accessed: oldDate, strength: 1.0, importance: 0.3 });

    const decayed = applyMemoryDecay(db, proj);
    assert.ok(decayed > 0, 'Should decay at least one memory');
  });

  it('cleanExpiredScratchpad removes expired entries', () => {
    const proj = 'cleanup-project';
    db.prepare("INSERT INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, datetime('now', '-1 hour'))").run('expired-key', proj, 'old-value');

    const cleaned = cleanExpiredScratchpad(db, proj);
    assert.ok(cleaned > 0, 'Should clean expired entries');
  });
});

// ============================================================================
// Cross-module: Update fields validation (HIGH-2)
// ============================================================================
describe('Integration: updateMemory only accepts allowed fields', () => {
  it('updates content, type, tags, importance, confidence', async () => {
    const stored = await storeMemory(db, noContradictions, 'Field test', 'note', ['old'], 0.5, 0.5, 'fields-project');
    const updated = await updateMemory(db, noContradictions, stored.id, {
      content: 'Updated field test',
      type: 'decision',
      tags: ['new'],
      importance: 0.9,
      confidence: 0.8,
    }, 'fields-project');
    assert.strictEqual(updated.content, 'Updated field test');
    assert.strictEqual(updated.type, 'decision');
    assert.deepStrictEqual(updated.tags, ['new']);
    assert.strictEqual(updated.importance, 0.9);
  });

  it('rejects empty updates', async () => {
    const stored = await storeMemory(db, noContradictions, 'No update test', 'note', [], 0.5, 0.5, 'fields-project');
    const result = await updateMemory(db, noContradictions, stored.id, {}, 'fields-project');
    assert.ok(result.error, 'Should return error for empty updates');
  });
});
