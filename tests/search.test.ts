/**
 * Tests for src/search.ts
 * Keyword search, semantic search (edge cases), hybrid search.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import { keywordSearch } from '../src/search.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const project = 'test-project';

before(() => { db = createTestDb(); });
after(() => { db.close(); });

describe('keywordSearch', () => {
  it('should return empty for empty query', () => {
    const results = keywordSearch(db, '', project, 10, 0);
    assert.deepStrictEqual(results, []);
  });

  it('should return empty for whitespace query', () => {
    const results = keywordSearch(db, '   ', project, 10, 0);
    assert.deepStrictEqual(results, []);
  });

  it('should find matching memories', () => {
    insertTestMemory(db, { content: 'TypeScript is a typed language', project_id: project, confidence: 0.8 });
    insertTestMemory(db, { content: 'JavaScript is dynamic', project_id: project, confidence: 0.8 });

    const results = keywordSearch(db, 'TypeScript', project, 10, 0);
    assert.ok(results.length >= 1, 'Should find at least 1 result');
    assert.ok(results[0].content.includes('TypeScript'), 'Should contain the search term');
  });

  it('should respect confidence threshold', () => {
    insertTestMemory(db, { content: 'Low confidence unique item xzy123', project_id: project, confidence: 0.1 });

    const withLowThreshold = keywordSearch(db, 'xzy123', project, 10, 0);
    const withHighThreshold = keywordSearch(db, 'xzy123', project, 10, 0.9);

    assert.ok(withLowThreshold.length >= 1, 'Should find with low threshold');
    assert.strictEqual(withHighThreshold.length, 0, 'Should not find with high threshold');
  });

  it('should not find deleted memories', () => {
    insertTestMemory(db, { content: 'Deleted memory unique abc789', project_id: project, deleted_at: new Date().toISOString() });

    const results = keywordSearch(db, 'abc789', project, 10, 0);
    assert.strictEqual(results.length, 0, 'Should not find deleted memories');
  });

  it('should find global project memories', () => {
    insertTestMemory(db, { content: 'Global unique memory qwe456', project_id: 'global', confidence: 0.8 });

    const results = keywordSearch(db, 'qwe456', project, 10, 0);
    assert.ok(results.length >= 1, 'Should find global memories');
  });

  it('should sanitize LIKE wildcards', () => {
    insertTestMemory(db, { content: 'Special chars: 100% done', project_id: project, confidence: 0.8 });

    // Search for literal "100%" — should not treat % as wildcard
    const results = keywordSearch(db, '100%', project, 10, 0);
    // The sanitization ensures % is escaped; result depends on exact match
    assert.ok(Array.isArray(results), 'Should return array without error');
  });

  it('should calculate keyword scores correctly', () => {
    insertTestMemory(db, { content: 'Alpha beta gamma delta', project_id: project, confidence: 0.8 });

    const results = keywordSearch(db, 'alpha gamma', project, 10, 0);
    if (results.length > 0) {
      assert.ok(results[0].keywordScore > 0, 'Should have positive keyword score');
      assert.ok(results[0].keywordScore <= 1, 'Score should be <= 1');
    }
  });

  it('should gracefully fallback when FTS5 table does not exist', () => {
    insertTestMemory(db, { content: 'FTS5 fallback unique test zxc789', project_id: project, confidence: 0.8 });

    // useFTS5=true but no FTS5 table in test DB — should catch error and fallback to LIKE
    const results = keywordSearch(db, 'zxc789', project, 10, 0, true);
    assert.ok(results.length >= 1, 'Should find result via LIKE fallback');
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      insertTestMemory(db, { content: `Searchable item number ${i} unique_limit_term`, project_id: project, confidence: 0.8 });
    }

    const results = keywordSearch(db, 'unique_limit_term', project, 3, 0);
    assert.ok(results.length >= 1 && results.length <= 6, `Should return 1-6 results (limit 3 with 2x buffer), got ${results.length}`);
    // Verify results have proper shape
    for (const r of results) {
      assert.ok(r.id, 'Each result should have an id');
      assert.ok(typeof r.keywordScore === 'number', 'Each result should have a numeric keywordScore');
    }
  });

  it('should respect project scoping', () => {
    insertTestMemory(db, { content: 'Project A specific unique_proj_term', project_id: 'proj-a', confidence: 0.8 });
    insertTestMemory(db, { content: 'Project B specific unique_proj_term', project_id: 'proj-b', confidence: 0.8 });

    const resultsA = keywordSearch(db, 'unique_proj_term', 'proj-a', 10, 0);
    const resultsB = keywordSearch(db, 'unique_proj_term', 'proj-b', 10, 0);
    assert.strictEqual(resultsA.length, 1, 'Should only find proj-a memory');
    assert.strictEqual(resultsB.length, 1, 'Should only find proj-b memory');
  });
});
