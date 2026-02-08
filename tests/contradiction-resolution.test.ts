/**
 * Tests for src/contradiction-resolution.ts
 * Version update detection, temporal supersession, resolution CRUD, scanning.
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import {
  isVersionUpdateContradiction,
  isTemporalSupersession,
  getPendingResolutions,
  resolveContradiction,
  scanContradictions,
} from '../src/contradiction-resolution.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const projectId = 'test-project';

beforeEach(() => {
  db?.close();
  db = createTestDb();
});

after(() => { db?.close(); });

// ============================================================================
// isVersionUpdateContradiction
// ============================================================================

describe('isVersionUpdateContradiction', () => {
  it('should detect version update between similar topics', () => {
    const content1 = 'Just-Memory project uses version v4.2.0 with sqlite backend and embedding support';
    const content2 = 'Just-Memory project uses version v4.3.1 with sqlite backend and embedding support';
    assert.strictEqual(isVersionUpdateContradiction(content1, content2), true);
  });

  it('should return false when no versions present', () => {
    assert.strictEqual(isVersionUpdateContradiction('hello world', 'goodbye world'), false);
  });

  it('should return false when only one has a version', () => {
    assert.strictEqual(isVersionUpdateContradiction('project v1.0', 'project is great'), false);
  });

  it('should return false when versions are the same', () => {
    const content1 = 'Just-Memory project uses version v4.3.1 with sqlite backend and embedding support';
    const content2 = 'Just-Memory project uses version v4.3.1 with sqlite backend and different features';
    assert.strictEqual(isVersionUpdateContradiction(content1, content2), false);
  });

  it('should return false when topics are unrelated', () => {
    const content1 = 'React framework uses version v18.2.0';
    const content2 = 'Python language uses version v3.12.0';
    assert.strictEqual(isVersionUpdateContradiction(content1, content2), false);
  });

  it('should detect version without v prefix', () => {
    const content1 = 'Just-Memory project upgraded from 4.2.0 with sqlite backend and embedding support';
    const content2 = 'Just-Memory project upgraded from 4.3.1 with sqlite backend and embedding support';
    assert.strictEqual(isVersionUpdateContradiction(content1, content2), true);
  });
});

// ============================================================================
// isTemporalSupersession
// ============================================================================

describe('isTemporalSupersession', () => {
  it('should detect first_newer when first date is 30+ days later', () => {
    const old = '2024-01-01T00:00:00Z';
    const newer = '2024-03-01T00:00:00Z';
    assert.strictEqual(isTemporalSupersession(newer, old), 'first_newer');
  });

  it('should detect second_newer when second date is 30+ days later', () => {
    const old = '2024-01-01T00:00:00Z';
    const newer = '2024-03-01T00:00:00Z';
    assert.strictEqual(isTemporalSupersession(old, newer), 'second_newer');
  });

  it('should return false when dates are within 30 days', () => {
    const d1 = '2024-06-01T00:00:00Z';
    const d2 = '2024-06-15T00:00:00Z';
    assert.strictEqual(isTemporalSupersession(d1, d2), false);
  });

  it('should return false for same timestamp', () => {
    const d = '2024-06-01T00:00:00Z';
    assert.strictEqual(isTemporalSupersession(d, d), false);
  });

  it('should handle invalid date strings without throwing', () => {
    // NaN dates produce NaN comparisons — function should not throw
    const result = isTemporalSupersession('not-a-date', '2024-01-01T00:00:00Z');
    assert.ok(typeof result === 'string' || result === false, 'Should return string or false without throwing');
  });
});

// ============================================================================
// getPendingResolutions
// ============================================================================

describe('getPendingResolutions', () => {
  it('should return pending resolutions with memory content', () => {
    const id1 = insertTestMemory(db, { id: 'mem1', project_id: projectId, content: 'Memory one' });
    const id2 = insertTestMemory(db, { id: 'mem2', project_id: projectId, content: 'Memory two' });

    db.prepare(`INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type)
      VALUES (?, ?, ?, ?, 'pending')`).run('res1', projectId, id1, id2);

    const result = getPendingResolutions(db, projectId);
    assert.strictEqual(result.pending_count, 1);
    assert.strictEqual(result.resolutions[0].id, 'res1');
    assert.strictEqual(result.resolutions[0].memory1.id, 'mem1');
    assert.strictEqual(result.resolutions[0].memory2.id, 'mem2');
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      const id1 = insertTestMemory(db, { id: `lim_m1_${i}`, project_id: projectId });
      const id2 = insertTestMemory(db, { id: `lim_m2_${i}`, project_id: projectId });
      db.prepare(`INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type)
        VALUES (?, ?, ?, ?, 'pending')`).run(`res_lim_${i}`, projectId, id1, id2);
    }

    const result = getPendingResolutions(db, projectId, 3);
    assert.strictEqual(result.pending_count, 3);
  });

  it('should return empty for no pending resolutions', () => {
    const result = getPendingResolutions(db, projectId);
    assert.strictEqual(result.pending_count, 0);
    assert.deepStrictEqual(result.resolutions, []);
  });

  it('should not include resolved resolutions', () => {
    const id1 = insertTestMemory(db, { id: 'resolved_m1', project_id: projectId });
    const id2 = insertTestMemory(db, { id: 'resolved_m2', project_id: projectId });
    db.prepare(`INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type, resolved_at)
      VALUES (?, ?, ?, ?, 'keep_first', datetime('now'))`).run('resolved_res', projectId, id1, id2);

    const result = getPendingResolutions(db, projectId);
    assert.strictEqual(result.pending_count, 0);
  });
});

// ============================================================================
// resolveContradiction
// ============================================================================

describe('resolveContradiction', () => {
  function setupResolution(): { resId: string; memId1: string; memId2: string } {
    const memId1 = insertTestMemory(db, { id: 'rc_m1', project_id: projectId, content: 'First memory' });
    const memId2 = insertTestMemory(db, { id: 'rc_m2', project_id: projectId, content: 'Second memory' });
    db.prepare(`INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type)
      VALUES (?, ?, ?, ?, 'pending')`).run('rc_res', projectId, memId1, memId2);
    return { resId: 'rc_res', memId1, memId2 };
  }

  it('should keep_first and soft-delete second', () => {
    const { resId, memId2 } = setupResolution();
    const result = resolveContradiction(db, resId, 'keep_first', 'Test note');
    assert.ok(!result.error);
    assert.strictEqual(result.resolutionType, 'keep_first');
    assert.strictEqual(result.chosenMemory, 'rc_m1');

    const deleted = db.prepare('SELECT deleted_at FROM memories WHERE id = ?').get(memId2) as any;
    assert.ok(deleted.deleted_at, 'Second memory should be soft-deleted');
  });

  it('should keep_second and soft-delete first', () => {
    const { resId, memId1 } = setupResolution();
    const result = resolveContradiction(db, resId, 'keep_second');
    assert.ok(!result.error);
    assert.strictEqual(result.chosenMemory, 'rc_m2');

    const deleted = db.prepare('SELECT deleted_at FROM memories WHERE id = ?').get(memId1) as any;
    assert.ok(deleted.deleted_at, 'First memory should be soft-deleted');
  });

  it('should keep_both without deleting anything', () => {
    const { resId, memId1, memId2 } = setupResolution();
    const result = resolveContradiction(db, resId, 'keep_both');
    assert.ok(!result.error);

    const m1 = db.prepare('SELECT deleted_at FROM memories WHERE id = ?').get(memId1) as any;
    const m2 = db.prepare('SELECT deleted_at FROM memories WHERE id = ?').get(memId2) as any;
    assert.strictEqual(m1.deleted_at, null);
    assert.strictEqual(m2.deleted_at, null);
  });

  it('should merge: create new memory and delete both originals', () => {
    const { resId } = setupResolution();
    const result = resolveContradiction(db, resId, 'merge', 'Merge note', 'Merged content from both');
    assert.ok(!result.error);
    assert.ok(result.chosenMemory, 'Should return merged memory ID');

    // Both originals soft-deleted
    const m1 = db.prepare('SELECT deleted_at FROM memories WHERE id = ?').get('rc_m1') as any;
    const m2 = db.prepare('SELECT deleted_at FROM memories WHERE id = ?').get('rc_m2') as any;
    assert.ok(m1.deleted_at);
    assert.ok(m2.deleted_at);

    // New merged memory exists
    const merged = db.prepare('SELECT content FROM memories WHERE id = ?').get(result.chosenMemory) as any;
    assert.strictEqual(merged.content, 'Merged content from both');
  });

  it('should require mergedContent for merge resolution', () => {
    const { resId } = setupResolution();
    const result = resolveContradiction(db, resId, 'merge');
    assert.ok(result.error);
    assert.match(result.error!, /merged content required/i);
  });

  it('should delete_both and soft-delete both memories', () => {
    const { resId } = setupResolution();
    const result = resolveContradiction(db, resId, 'delete_both');
    assert.ok(!result.error);

    const m1 = db.prepare('SELECT deleted_at FROM memories WHERE id = ?').get('rc_m1') as any;
    const m2 = db.prepare('SELECT deleted_at FROM memories WHERE id = ?').get('rc_m2') as any;
    assert.ok(m1.deleted_at);
    assert.ok(m2.deleted_at);
  });

  it('should return error for nonexistent resolution ID', () => {
    const result = resolveContradiction(db, 'nonexistent', 'keep_first');
    assert.ok(result.error);
    assert.match(result.error!, /not found/i);
  });

  it('should return error when referenced memories are deleted', () => {
    // Use a separate DB to insert a resolution referencing a nonexistent memory
    // (can't hard-delete memories with FK constraints in the main DB)
    const db2 = createTestDb();
    db2.pragma('foreign_keys = OFF');
    db2.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`).run('gone_m2_only', projectId, 'exists');
    db2.prepare(`INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type)
      VALUES (?, ?, ?, ?, 'pending')`).run('gone_res', projectId, 'nonexistent_id', 'gone_m2_only');

    const result = resolveContradiction(db2, 'gone_res', 'keep_first');
    assert.ok(result.error);
    assert.match(result.error!, /no longer exist/i);
    db2.close();
  });
});

// ============================================================================
// scanContradictions
// ============================================================================

describe('scanContradictions', () => {
  it('should find unresolved contradiction edges and create pending resolutions', () => {
    const id1 = insertTestMemory(db, { id: 'scan_m1', project_id: projectId, content: 'First claim' });
    const id2 = insertTestMemory(db, { id: 'scan_m2', project_id: projectId, content: 'Second claim' });

    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence)
      VALUES (?, ?, ?, ?, 'contradiction_factual', 0.8)`).run('scan_edge1', projectId, id1, id2);

    const result = scanContradictions(db, projectId, true);
    assert.strictEqual(result.unresolved_count, 1);
    assert.strictEqual(result.new_resolutions_created, 1);
    assert.strictEqual(result.contradictions.length, 1);
    assert.strictEqual(result.contradictions[0].type, 'factual');
  });

  it('should auto-resolve version update contradictions', () => {
    const id1 = insertTestMemory(db, { id: 'ver_m1', project_id: projectId, content: 'Just-Memory project uses version v4.2.0 with sqlite backend and embedding support' });
    const id2 = insertTestMemory(db, { id: 'ver_m2', project_id: projectId, content: 'Just-Memory project uses version v4.3.1 with sqlite backend and embedding support' });

    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence)
      VALUES (?, ?, ?, ?, 'contradiction_factual', 0.7)`).run('ver_edge', projectId, id1, id2);

    const result = scanContradictions(db, projectId, true);
    assert.strictEqual(result.auto_resolved, 1);
    assert.strictEqual(result.new_resolutions[0].auto_resolved, 'version_update');
  });

  it('should auto-resolve temporal supersession contradictions', () => {
    const oldDate = '2023-01-01T00:00:00Z';
    const newDate = '2024-06-01T00:00:00Z';

    // Need 3+ overlapping topic words for temporal auto-resolution
    const id1 = insertTestMemory(db, { id: 'ts_m1', project_id: projectId, content: 'Project backend database configuration settings updated', created_at: oldDate });
    const id2 = insertTestMemory(db, { id: 'ts_m2', project_id: projectId, content: 'Project backend database configuration settings changed', created_at: newDate });

    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence)
      VALUES (?, ?, ?, ?, 'contradiction_factual', 0.7)`).run('ts_edge', projectId, id1, id2);

    const result = scanContradictions(db, projectId, true);
    assert.strictEqual(result.auto_resolved, 1);
    assert.strictEqual(result.new_resolutions[0].auto_resolved, 'temporal_supersession');
  });

  it('should handle no contradictions gracefully', () => {
    const result = scanContradictions(db, projectId, true);
    assert.strictEqual(result.unresolved_count, 0);
    assert.strictEqual(result.new_resolutions_created, 0);
    assert.deepStrictEqual(result.contradictions, []);
  });

  it('should skip already-resolved edges', () => {
    const id1 = insertTestMemory(db, { id: 'skip_m1', project_id: projectId });
    const id2 = insertTestMemory(db, { id: 'skip_m2', project_id: projectId });

    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type)
      VALUES (?, ?, ?, ?, 'contradiction_factual')`).run('skip_edge', projectId, id1, id2);
    db.prepare(`INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type, resolved_at)
      VALUES (?, ?, ?, ?, 'keep_first', datetime('now'))`).run('skip_res', projectId, id1, id2);

    const result = scanContradictions(db, projectId, true);
    assert.strictEqual(result.unresolved_count, 0);
  });

  it('should not create resolutions when autoCreateResolutions is false', () => {
    const id1 = insertTestMemory(db, { id: 'noauto_m1', project_id: projectId });
    const id2 = insertTestMemory(db, { id: 'noauto_m2', project_id: projectId });

    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type)
      VALUES (?, ?, ?, ?, 'contradiction_factual')`).run('noauto_edge', projectId, id1, id2);

    const result = scanContradictions(db, projectId, false);
    assert.strictEqual(result.unresolved_count, 1);
    assert.strictEqual(result.new_resolutions_created, 0);
  });
});
