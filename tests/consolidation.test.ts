/**
 * Tests for src/consolidation.ts
 * Memory decay, strengthening, similarity detection, scratchpad cleanup.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import {
  findSimilarMemories,
  strengthenActiveMemories,
  applyMemoryDecay,
  cleanExpiredScratchpad,
  pruneToolLogs,
} from '../src/consolidation.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

before(() => { db = createTestDb(); });
after(() => { db.close(); });

describe('findSimilarMemories', () => {
  it('should find similar memories', () => {
    const project = `similar-${Date.now()}`;
    // Two nearly identical memories
    insertTestMemory(db, { project_id: project, content: 'The quick brown fox jumps over the lazy dog' });
    insertTestMemory(db, { project_id: project, content: 'The quick brown fox leaps over the lazy dog' });
    // One different memory
    insertTestMemory(db, { project_id: project, content: 'Python is a great programming language' });

    const similar = findSimilarMemories(db, project, 0.5, 20);
    assert.ok(similar.length >= 1, `Expected >= 1 similar pair, got ${similar.length}`);
    assert.ok(similar[0].similarity >= 0.5);
  });

  it('should return empty for no similar memories', () => {
    const project = `no-similar-${Date.now()}`;
    insertTestMemory(db, { project_id: project, content: 'Alpha beta gamma delta' });
    insertTestMemory(db, { project_id: project, content: 'Completely different topic about automobiles' });

    const similar = findSimilarMemories(db, project, 0.85, 20);
    assert.strictEqual(similar.length, 0, 'Should find no highly similar pairs');
  });
});

describe('strengthenActiveMemories', () => {
  it('should strengthen frequently accessed memories', () => {
    const project = `strengthen-${Date.now()}`;
    // Create a memory with high access count and room for confidence boost
    insertTestMemory(db, {
      project_id: project,
      content: 'Frequently accessed memory',
      access_count: 10,
      confidence: 0.6,
    });
    // Create a memory with low access count
    insertTestMemory(db, {
      project_id: project,
      content: 'Rarely accessed memory',
      access_count: 0,
      confidence: 0.6,
    });

    const strengthened = strengthenActiveMemories(db, project);
    // The frequently accessed memory should be strengthened
    assert.ok(strengthened >= 1, `Expected >= 1 strengthened, got ${strengthened}`);
  });
});

describe('applyMemoryDecay', () => {
  it('should decay old, low-importance memories', () => {
    const project = `decay-${Date.now()}`;
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    insertTestMemory(db, {
      project_id: project,
      content: 'Old low importance memory',
      last_accessed: old,
      strength: 0.8,
      importance: 0.3,
    });

    const decayed = applyMemoryDecay(db, project);
    assert.ok(decayed >= 1, `Expected >= 1 decayed, got ${decayed}`);

    // Verify strength was reduced
    const mem = db.prepare(`SELECT strength FROM memories WHERE project_id = ? AND content = ?`)
      .get(project, 'Old low importance memory') as any;
    assert.ok(mem.strength < 0.8, `Strength should be reduced from 0.8, got ${mem.strength}`);
  });

  it('should not decay high-importance memories', () => {
    const project = `no-decay-${Date.now()}`;
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    insertTestMemory(db, {
      project_id: project,
      content: 'Old high importance memory',
      last_accessed: old,
      strength: 0.8,
      importance: 0.9, // >= 0.8 threshold — should not decay
    });

    const decayed = applyMemoryDecay(db, project);
    assert.strictEqual(decayed, 0, 'Should not decay high-importance memory');
  });

  it('should not decay recently accessed memories', () => {
    const project = `recent-${Date.now()}`;
    insertTestMemory(db, {
      project_id: project,
      content: 'Recently accessed memory',
      last_accessed: new Date().toISOString(),
      strength: 0.8,
      importance: 0.3,
    });

    const decayed = applyMemoryDecay(db, project);
    assert.strictEqual(decayed, 0, 'Should not decay recently accessed memory');
  });
});

describe('cleanExpiredScratchpad', () => {
  it('should clean expired scratchpad entries', () => {
    const project = `clean-scratch-${Date.now()}`;
    // Insert an expired entry directly
    db.prepare(`
      INSERT INTO scratchpad (key, project_id, value, expires_at)
      VALUES (?, ?, ?, datetime('now', '-1 hour'))
    `).run('expired-clean', project, 'old value');
    // Insert a non-expired entry
    db.prepare(`
      INSERT INTO scratchpad (key, project_id, value, expires_at)
      VALUES (?, ?, ?, datetime('now', '+1 hour'))
    `).run('valid-clean', project, 'fresh value');

    const cleaned = cleanExpiredScratchpad(db, project);
    assert.ok(cleaned >= 1, 'Should clean at least 1 entry');

    // The valid entry should still exist
    const valid = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get('valid-clean', project) as any;
    assert.ok(valid, 'Valid entry should still exist');
  });
});

describe('pruneToolLogs', () => {
  it('should prune old tool call logs', () => {
    // Insert an old tool call
    db.prepare(`
      INSERT INTO tool_calls (id, tool_name, arguments, success, project_id, timestamp)
      VALUES (?, ?, ?, 1, 'global', datetime('now', '-30 days'))
    `).run('old-tool-call', 'memory_store', '{}');
    // Insert a recent tool call
    db.prepare(`
      INSERT INTO tool_calls (id, tool_name, arguments, success, project_id, timestamp)
      VALUES (?, ?, ?, 1, 'global', datetime('now'))
    `).run('recent-tool-call', 'memory_recall', '{}');

    const pruned = pruneToolLogs(db, 7);
    assert.ok(pruned >= 1, 'Should prune at least 1 old log');

    // Recent call should still exist
    const recent = db.prepare('SELECT id FROM tool_calls WHERE id = ?').get('recent-tool-call');
    assert.ok(recent, 'Recent tool call should still exist');
  });
});
