/**
 * Tests for src/stats.ts
 * Context suggestions, memory statistics, project listing.
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import { suggestFromContext, getStats, listProjects } from '../src/stats.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const projectId = 'test-project';

beforeEach(() => {
  db?.close();
  db = createTestDb();
});

after(() => { db?.close(); });

// ============================================================================
// suggestFromContext
// ============================================================================

describe('suggestFromContext', () => {
  it('should return suggestions matching context keywords', () => {
    insertTestMemory(db, { id: 'ctx1', project_id: projectId, content: 'TypeScript compiler configuration for strict mode', importance: 0.8 });
    insertTestMemory(db, { id: 'ctx2', project_id: projectId, content: 'Python virtual environment setup guide', importance: 0.6 });

    const result = suggestFromContext(db, 'How to configure TypeScript compiler', projectId);
    assert.ok(result.suggestions.length >= 1);
    assert.ok(result.keywords.length > 0);
    // TypeScript config memory should be suggested
    assert.ok(result.suggestions.some(s => s.id === 'ctx1'), 'Should find TypeScript memory');
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 15; i++) {
      insertTestMemory(db, { id: `limit_${i}`, project_id: projectId, content: `Database configuration option number ${i}` });
    }

    const result = suggestFromContext(db, 'database configuration options', projectId, 5);
    assert.ok(result.suggestions.length <= 5);
  });

  it('should return empty for short words only', () => {
    insertTestMemory(db, { id: 'short1', project_id: projectId, content: 'something here' });
    const result = suggestFromContext(db, 'a b c do it');
    assert.deepStrictEqual(result.suggestions, []);
    assert.ok(result.reason);
  });

  it('should return empty when no matches found', () => {
    insertTestMemory(db, { id: 'nomatch1', project_id: projectId, content: 'Completely unrelated content about cooking' });
    const result = suggestFromContext(db, 'quantum physics equations', projectId);
    assert.strictEqual(result.suggestions.length, 0);
  });

  it('should truncate long context in response', () => {
    insertTestMemory(db, { id: 'trunc1', project_id: projectId, content: 'Database optimization techniques for production' });
    const longContext = 'Database optimization '.repeat(20);
    const result = suggestFromContext(db, longContext, projectId);
    assert.ok(result.context.length <= 104); // 100 + "..."
  });
});

// ============================================================================
// getStats
// ============================================================================

describe('getStats', () => {
  it('should return correct counts with projectId filter', () => {
    insertTestMemory(db, { id: 'st1', project_id: projectId, content: 'Memory 1', type: 'fact' });
    insertTestMemory(db, { id: 'st2', project_id: projectId, content: 'Memory 2', type: 'note' });
    insertTestMemory(db, { id: 'st3', project_id: projectId, content: 'Deleted', deleted_at: new Date().toISOString() });

    db.prepare(`INSERT INTO entities (id, project_id, name, entity_type) VALUES (?, ?, ?, ?)`).run('ent1', projectId, 'TestEntity', 'concept');
    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type) VALUES (?, ?, ?, ?, ?)`).run('edge1', projectId, 'st1', 'st2', 'related');

    const result = getStats(db, projectId);
    assert.strictEqual(result.memories.total, 3);
    assert.strictEqual(result.memories.active, 2);
    assert.strictEqual(result.entities, 1);
    assert.strictEqual(result.edges.total, 1);
    assert.ok(result.typeBreakdown.length > 0);
  });

  it('should return global stats without projectId', () => {
    insertTestMemory(db, { id: 'g1', project_id: 'proj-a', content: 'A' });
    insertTestMemory(db, { id: 'g2', project_id: 'proj-b', content: 'B' });

    const result = getStats(db);
    assert.strictEqual(result.project_id, 'all');
    assert.strictEqual(result.memories.total, 2);
  });

  it('should return zeros/nulls for empty database', () => {
    const result = getStats(db, projectId);
    assert.strictEqual(result.memories.total, 0);
    // SUM returns null on empty table, active may be null or 0
    assert.ok(result.memories.active === 0 || result.memories.active === null);
    assert.strictEqual(result.entities, 0);
    assert.strictEqual(result.edges.total, 0);
    assert.strictEqual(result.memories.avgConfidence, 0);
  });

  it('should count contradiction edges separately', () => {
    const id1 = insertTestMemory(db, { id: 'ce1', project_id: projectId });
    const id2 = insertTestMemory(db, { id: 'ce2', project_id: projectId });
    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type) VALUES (?, ?, ?, ?, ?)`).run('ce_edge1', projectId, id1, id2, 'related');
    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type) VALUES (?, ?, ?, ?, ?)`).run('ce_edge2', projectId, id1, id2, 'contradiction_factual');

    const result = getStats(db, projectId);
    assert.strictEqual(result.edges.total, 2);
    assert.strictEqual(result.edges.contradictions, 1);
  });

  it('should calculate average confidence', () => {
    insertTestMemory(db, { id: 'conf1', project_id: projectId, confidence: 0.8 });
    insertTestMemory(db, { id: 'conf2', project_id: projectId, confidence: 0.6 });

    const result = getStats(db, projectId);
    assert.strictEqual(result.memories.avgConfidence, 0.7);
  });
});

// ============================================================================
// listProjects
// ============================================================================

describe('listProjects', () => {
  it('should list all projects with counts', () => {
    insertTestMemory(db, { id: 'lp1', project_id: 'proj-alpha', content: 'A' });
    insertTestMemory(db, { id: 'lp2', project_id: 'proj-alpha', content: 'B' });
    insertTestMemory(db, { id: 'lp3', project_id: 'proj-beta', content: 'C' });

    db.prepare(`INSERT INTO entities (id, project_id, name, entity_type) VALUES (?, ?, ?, ?)`).run('lp_ent', 'proj-alpha', 'Entity', 'concept');

    const result = listProjects(db, 'proj-alpha');
    assert.strictEqual(result.current, 'proj-alpha');
    assert.ok(result.projects.length >= 2);

    const alpha = result.projects.find((p: any) => p.id === 'proj-alpha');
    assert.ok(alpha);
    assert.strictEqual(alpha.memoryCount, 2);
    assert.strictEqual(alpha.entityCount, 1);

    const beta = result.projects.find((p: any) => p.id === 'proj-beta');
    assert.ok(beta);
    assert.strictEqual(beta.memoryCount, 1);
    assert.strictEqual(beta.entityCount, 0);
  });

  it('should return empty for database with no memories', () => {
    const result = listProjects(db, 'any-project');
    assert.strictEqual(result.current, 'any-project');
    assert.deepStrictEqual(result.projects, []);
  });

  it('should exclude soft-deleted memories from counts', () => {
    insertTestMemory(db, { id: 'del1', project_id: 'proj-x', content: 'Active' });
    insertTestMemory(db, { id: 'del2', project_id: 'proj-x', content: 'Deleted', deleted_at: new Date().toISOString() });

    const result = listProjects(db, 'proj-x');
    const projX = result.projects.find((p: any) => p.id === 'proj-x');
    assert.ok(projX);
    assert.strictEqual(projX.memoryCount, 1);
  });
});
