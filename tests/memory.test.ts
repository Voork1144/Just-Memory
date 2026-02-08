/**
 * Tests for src/memory.ts
 * Core CRUD, confidence management, retention calculations.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import {
  calculateRetention,
  updateStrength,
  calculateEffectiveConfidence,
  assessConfidence,
  toConfidentMemory,
  storeMemory,
  recallMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  confirmMemory,
  contradictMemory,
  findContradictionsProactive,
  recalibrateContradictionCounts,
  type ContradictionFinder,
} from '../src/memory.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

// Stub contradiction finder that always returns no contradictions
const noContradictions: ContradictionFinder = async () => [];

before(() => { db = createTestDb(); });
after(() => { db.close(); });

describe('calculateRetention', () => {
  it('should return 1.0 for recently accessed memory', () => {
    const now = new Date().toISOString();
    const retention = calculateRetention(now, 1.0);
    assert.ok(retention > 0.99, `Expected ~1.0, got ${retention}`);
  });

  it('should decay over time', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const retention = calculateRetention(old, 1.0);
    assert.ok(retention < 1.0, 'Should decay over 30 days');
    assert.ok(retention > 0, 'Should not reach 0');
  });

  it('should decay faster with lower strength', () => {
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const highStrength = calculateRetention(old, 1.0);
    const lowStrength = calculateRetention(old, 0.3);
    assert.ok(lowStrength < highStrength, 'Lower strength should decay faster');
  });
});

describe('calculateEffectiveConfidence', () => {
  const now = new Date().toISOString();

  it('should return base confidence for new memory', () => {
    const mem = { confidence: 0.7, source_count: 1, contradiction_count: 0, last_accessed: now, importance: 0.5 };
    const effective = calculateEffectiveConfidence(mem);
    assert.ok(effective >= 0.6, `Expected >= 0.6, got ${effective}`);
  });

  it('should boost confidence for multi-source memories', () => {
    const single = calculateEffectiveConfidence({ confidence: 0.5, source_count: 1, contradiction_count: 0, last_accessed: now, importance: 0.5 });
    const multi = calculateEffectiveConfidence({ confidence: 0.5, source_count: 5, contradiction_count: 0, last_accessed: now, importance: 0.5 });
    assert.ok(multi > single, 'More sources should increase effective confidence');
  });

  it('should penalize contradicted memories', () => {
    const clean = calculateEffectiveConfidence({ confidence: 0.5, source_count: 1, contradiction_count: 0, last_accessed: now, importance: 0.5 });
    const contradicted = calculateEffectiveConfidence({ confidence: 0.5, source_count: 1, contradiction_count: 3, last_accessed: now, importance: 0.5 });
    assert.ok(contradicted < clean, 'Contradictions should reduce effective confidence');
  });

  it('should clamp between 0 and 1', () => {
    const result = calculateEffectiveConfidence({ confidence: 0.99, source_count: 100, contradiction_count: 0, last_accessed: now, importance: 0.9 });
    assert.ok(result <= 1.0, 'Should not exceed 1.0');
    const low = calculateEffectiveConfidence({ confidence: 0.01, source_count: 1, contradiction_count: 100, last_accessed: now, importance: 0.1 });
    assert.ok(low >= 0, 'Should not go below 0');
  });
});

describe('assessConfidence', () => {
  const now = new Date().toISOString();

  it('should assess high confidence correctly', () => {
    const result = assessConfidence({ confidence: 0.9, source_count: 3, contradiction_count: 0, last_accessed: now, importance: 0.9 });
    assert.ok(result.level === 'high', `Expected high, got ${result.level}`);
  });

  it('should assess low confidence correctly', () => {
    const result = assessConfidence({ confidence: 0.2, source_count: 1, contradiction_count: 2, last_accessed: now, importance: 0.1 });
    assert.ok(result.level === 'low' || result.level === 'uncertain', `Expected low/uncertain, got ${result.level}`);
  });
});

describe('storeMemory', () => {
  it('should store a basic memory', async () => {
    const result = await storeMemory(db, noContradictions, 'Hello world', 'note', [], 0.5, 0.5, 'test-project');
    assert.ok(result.id, 'Should return an ID');
    assert.strictEqual(result.content, 'Hello world');
    assert.strictEqual(result.type, 'note');
  });

  it('should store with tags and importance', async () => {
    const result = await storeMemory(db, noContradictions, 'Tagged memory', 'fact', ['tag1', 'tag2'], 0.9, 0.8, 'test-project');
    assert.ok(result.id);
    assert.strictEqual(result.importance, 0.9);
    assert.deepStrictEqual(result.tags, ['tag1', 'tag2']);
  });

  it('should reject empty content', async () => {
    await assert.rejects(
      () => storeMemory(db, noContradictions, '', 'note', [], 0.5, 0.5, 'test-project'),
      /content/i,
    );
  });

  it('should reject content exceeding max length', async () => {
    const huge = 'x'.repeat(200_000);
    await assert.rejects(
      () => storeMemory(db, noContradictions, huge, 'note', [], 0.5, 0.5, 'test-project'),
      /content/i,
    );
  });
});

describe('recallMemory', () => {
  it('should recall a stored memory and increment access count', async () => {
    const stored = await storeMemory(db, noContradictions, 'Recall test', 'note', [], 0.5, 0.5, 'test-project');
    const recalled = recallMemory(db, stored.id);
    assert.ok(recalled, 'Should return the memory');
    assert.strictEqual(recalled.id, stored.id);
    assert.strictEqual(recalled.content, 'Recall test');
    assert.ok(recalled.access_count >= 1, 'Access count should be incremented');
  });

  it('should return error for non-existent ID', () => {
    const result = recallMemory(db, 'nonexistent');
    assert.ok(result.error, 'Should return error');
  });
});

describe('updateMemory', () => {
  it('should update content', async () => {
    const stored = await storeMemory(db, noContradictions, 'Original', 'note', [], 0.5, 0.5, 'test-project');
    const updated = await updateMemory(db, noContradictions, stored.id, { content: 'Updated' });
    assert.strictEqual(updated.content, 'Updated');
  });

  it('should update importance and tags', async () => {
    const stored = await storeMemory(db, noContradictions, 'Meta test', 'note', ['old'], 0.3, 0.5, 'test-project');
    const updated = await updateMemory(db, noContradictions, stored.id, { importance: 0.9, tags: ['new'] });
    assert.strictEqual(updated.importance, 0.9);
    assert.deepStrictEqual(updated.tags, ['new']);
  });

  it('should return error for non-existent memory', async () => {
    const result = await updateMemory(db, noContradictions, 'nonexistent', { content: 'x' });
    assert.ok(result.error, 'Should return error');
  });
});

describe('deleteMemory', () => {
  it('should soft-delete a memory', async () => {
    const stored = await storeMemory(db, noContradictions, 'Delete me', 'note', [], 0.5, 0.5, 'test-project');
    const result = deleteMemory(db, stored.id, false);
    assert.ok(result.deleted, 'Should be marked deleted');
    // Should not appear in normal recall
    const recalled = recallMemory(db, stored.id);
    assert.ok(recalled.error || recalled.deleted_at, 'Should not be recallable after soft delete');
  });

  it('should permanently delete a memory', async () => {
    const stored = await storeMemory(db, noContradictions, 'Perm delete', 'note', [], 0.5, 0.5, 'test-project');
    const result = deleteMemory(db, stored.id, true);
    assert.ok(result.deleted, 'Should be deleted');
    const recalled = recallMemory(db, stored.id);
    assert.ok(recalled.error, 'Should not exist after permanent delete');
  });
});

describe('listMemories', () => {
  it('should list recent memories for a project', async () => {
    const projectId = `list-test-${Date.now()}`;
    await storeMemory(db, noContradictions, 'List item 1', 'note', [], 0.5, 0.5, projectId);
    await storeMemory(db, noContradictions, 'List item 2', 'fact', [], 0.5, 0.5, projectId);
    const result = listMemories(db, projectId, 10, false);
    // listMemories returns an array directly
    assert.ok(Array.isArray(result), 'Should return array');
    assert.ok(result.length >= 2, `Expected >= 2, got ${result.length}`);
  });

  it('should respect limit', async () => {
    const projectId = `limit-test-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await storeMemory(db, noContradictions, `Limit item ${i}`, 'note', [], 0.5, 0.5, projectId);
    }
    const result = listMemories(db, projectId, 3, false);
    assert.ok(result.length <= 3, `Expected <= 3, got ${result.length}`);
  });
});

describe('confirmMemory / contradictMemory', () => {
  it('should boost confidence on confirm', async () => {
    const stored = await storeMemory(db, noContradictions, 'Confirm test', 'fact', [], 0.5, 0.5, 'test-project');
    const before = stored.confidence;
    const result = confirmMemory(db, stored.id);
    assert.ok(!result.error, 'Should succeed');
    assert.ok(result.confidence > before, `Confidence should increase: ${result.confidence} > ${before}`);
  });

  it('should reduce confidence on contradict', async () => {
    const stored = await storeMemory(db, noContradictions, 'Contradict test', 'fact', [], 0.5, 0.8, 'test-project');
    const result = contradictMemory(db, stored.id);
    assert.ok(!result.error, 'Should succeed');
    assert.ok(result.confidence < 0.8, `Confidence should decrease: ${result.confidence} < 0.8`);
  });
});

describe('findContradictionsProactive', () => {
  it('should return empty array when no contradictions exist', async () => {
    const result = await findContradictionsProactive(noContradictions, 'Some unique content', 'test-project', 10);
    assert.ok(Array.isArray(result.contradictions), 'Should return array');
    assert.strictEqual(result.contradictions.length, 0, 'Should be empty');
  });

  it('should return contradictions when finder produces results', async () => {
    const withContradictions: ContradictionFinder = async () => [
      { id: 'mem1', content: 'The sky is green', confidence: 0.9, contradictionType: 'factual', explanation: 'Color mismatch' },
    ];
    const result = await findContradictionsProactive(withContradictions, 'The sky is blue', 'test-project', 10);
    assert.ok(Array.isArray(result.contradictions), 'Should return array');
    assert.strictEqual(result.contradictions.length, 1, 'Should have 1 contradiction');
    assert.strictEqual(result.contradictions[0].id, 'mem1');
    assert.strictEqual(result.contradictions[0].type, 'factual');
  });
});

// v4.2: Confidence recalibration tests
describe('calculateEffectiveConfidence v4.2 enhancements', () => {
  const now = new Date().toISOString();

  it('should apply importance-based floor for high importance (>= 0.8)', () => {
    const mem = { confidence: 0.01, source_count: 1, contradiction_count: 10, last_accessed: now, importance: 0.9 };
    const effective = calculateEffectiveConfidence(mem);
    assert.ok(effective >= 0.4, `High importance floor should be 0.4, got ${effective}`);
  });

  it('should apply importance-based floor for medium importance (>= 0.5)', () => {
    const mem = { confidence: 0.01, source_count: 1, contradiction_count: 10, last_accessed: now, importance: 0.6 };
    const effective = calculateEffectiveConfidence(mem);
    assert.ok(effective >= 0.2, `Medium importance floor should be 0.2, got ${effective}`);
  });

  it('should apply importance-based floor for low importance (< 0.5)', () => {
    const mem = { confidence: 0.01, source_count: 1, contradiction_count: 10, last_accessed: now, importance: 0.2 };
    const effective = calculateEffectiveConfidence(mem);
    assert.ok(effective >= 0.1, `Low importance floor should be 0.1, got ${effective}`);
  });

  it('should cap contradiction penalty at MAX_CONTRADICTION_COUNT (3)', () => {
    const mem3 = { confidence: 0.7, source_count: 1, contradiction_count: 3, last_accessed: now, importance: 0.5 };
    const mem10 = { confidence: 0.7, source_count: 1, contradiction_count: 10, last_accessed: now, importance: 0.5 };
    const eff3 = calculateEffectiveConfidence(mem3);
    const eff10 = calculateEffectiveConfidence(mem10);
    assert.strictEqual(eff3, eff10, `3 and 10 contradictions should yield same penalty, got ${eff3} vs ${eff10}`);
  });
});

describe('recalibrateContradictionCounts', () => {
  it('should reset contradiction_count to match actual unresolved edges', () => {
    const testDb = createTestDb();
    const project = 'recal-test-' + Date.now();

    // Insert a memory with inflated contradiction_count
    const memId = 'recal-mem-' + Date.now();
    testDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, contradiction_count, embedding)
      VALUES (?, ?, 'Test memory for recalibration', 'fact', '[]', 0.5, 0.7, 5, NULL)
    `).run(memId, project);

    // Insert only 1 actual contradiction edge (no resolution)
    const otherId = 'recal-other-' + Date.now();
    testDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding)
      VALUES (?, ?, 'Contradicting memory', 'fact', '[]', 0.5, 0.7, NULL)
    `).run(otherId, project);

    testDb.prepare(`
      INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence)
      VALUES (?, ?, ?, ?, 'contradiction_factual', 0.9)
    `).run('edge-' + Date.now(), project, memId, otherId);

    const result = recalibrateContradictionCounts(testDb, project);
    assert.ok(result.recalibrated >= 1, 'Should recalibrate at least 1 memory');

    // Verify the count was corrected
    const mem = testDb.prepare('SELECT contradiction_count FROM memories WHERE id = ?').get(memId) as any;
    assert.strictEqual(mem.contradiction_count, 1, 'Should be 1 (matching actual edge count)');

    testDb.close();
  });

  it('should not change correctly-counted memories', () => {
    const testDb = createTestDb();
    const project = 'recal-correct-' + Date.now();

    // Insert a memory with correct contradiction_count of 0
    const memId = 'recal-correct-' + Date.now();
    testDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, contradiction_count, embedding)
      VALUES (?, ?, 'Correct count memory', 'fact', '[]', 0.5, 0.7, 0, NULL)
    `).run(memId, project);

    const result = recalibrateContradictionCounts(testDb, project);
    assert.strictEqual(result.recalibrated, 0, 'Should not recalibrate anything');

    testDb.close();
  });

  it('should exclude resolved contradictions from count', () => {
    const testDb = createTestDb();
    const project = 'recal-resolved-' + Date.now();

    const memId1 = 'recal-r1-' + Date.now();
    const memId2 = 'recal-r2-' + Date.now();

    testDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, contradiction_count, embedding)
      VALUES (?, ?, 'Memory one', 'fact', '[]', 0.5, 0.7, 2, NULL)
    `).run(memId1, project);

    testDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding)
      VALUES (?, ?, 'Memory two', 'fact', '[]', 0.5, 0.7, NULL)
    `).run(memId2, project);

    // Create a contradiction edge
    testDb.prepare(`
      INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence)
      VALUES (?, ?, ?, ?, 'contradiction_factual', 0.9)
    `).run('edge-res-' + Date.now(), project, memId1, memId2);

    // Resolve it (not pending)
    testDb.prepare(`
      INSERT INTO contradiction_resolutions (id, memory_id_1, memory_id_2, resolution_type, resolution_note)
      VALUES (?, ?, ?, 'keep_both', 'Resolved')
    `).run('res-' + Date.now(), memId1, memId2);

    const result = recalibrateContradictionCounts(testDb, project);
    assert.ok(result.recalibrated >= 1, 'Should recalibrate');

    const mem = testDb.prepare('SELECT contradiction_count FROM memories WHERE id = ?').get(memId1) as any;
    assert.strictEqual(mem.contradiction_count, 0, 'Should be 0 after resolution excludes the edge');

    testDb.close();
  });
});
