/**
 * Just-Memory Semantic Search Tests
 * 
 * Tests for BM25, Vector, and Hybrid search modes
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import memory module (tsx will handle TypeScript)
import {
  initDatabase,
  closeDatabase,
  initEmbeddings,
  getEmbeddingsStatus,
  storeMemory,
  searchMemories,
} from '../../src/memory/index.js';

// Test database path
const TEST_DB_PATH = join(tmpdir(), `just-memory-search-test-${Date.now()}.db`);

describe('Semantic Search', () => {
  before(async () => {
    // Initialize test database
    process.env.JUST_MEMORY_DB_PATH = TEST_DB_PATH;
    initDatabase({ dbPath: TEST_DB_PATH });
    
    // Initialize embeddings
    await initEmbeddings();
    
    // Store test memories
    await storeMemory({ content: 'The quick brown fox jumps over the lazy dog', type: 'fact' });
    await storeMemory({ content: 'Python is a popular programming language for machine learning', type: 'fact' });
    await storeMemory({ content: 'JavaScript runs in web browsers and Node.js servers', type: 'fact' });
    await storeMemory({ content: 'Cats are furry animals that love to sleep all day', type: 'fact' });
    await storeMemory({ content: 'TypeScript adds static type checking to JavaScript', type: 'fact' });
    await storeMemory({ content: 'Redis is an in-memory data structure store', type: 'fact' });
  });

  after(async () => {
    // Cleanup
    closeDatabase();
    try {
      rmSync(TEST_DB_PATH, { force: true });
      rmSync(`${TEST_DB_PATH}-wal`, { force: true });
      rmSync(`${TEST_DB_PATH}-shm`, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Embeddings', () => {
    it('should have embeddings ready', () => {
      const status = getEmbeddingsStatus();
      assert.strictEqual(status.ready, true);
      assert.strictEqual(status.loading, false);
      assert.strictEqual(status.error, null);
    });

    it('should use correct model', () => {
      const status = getEmbeddingsStatus();
      assert.strictEqual(status.modelName, 'Xenova/all-MiniLM-L6-v2');
      assert.strictEqual(status.dimensions, 384);
    });
  });

  describe('BM25 Search', () => {
    it('should find exact keyword matches', async () => {
      const results = await searchMemories('programming language', { mode: 'bm25' });
      assert.ok(results.length >= 1, 'Should find at least 1 result');
      assert.ok(
        results[0].memory.content.includes('programming'),
        'Top result should contain "programming"'
      );
    });

    it('should highlight matches in snippets', async () => {
      const results = await searchMemories('Python', { mode: 'bm25' });
      assert.ok(results.length >= 1, 'Should find at least 1 result');
      // FTS5 uses >>> and <<< markers converted to ** in snippets
      assert.ok(
        results[0].snippet.includes('Python') || results[0].snippet.includes('**'),
        'Snippet should highlight matches'
      );
    });

    it('should return empty for non-matching query', async () => {
      const results = await searchMemories('xyznonexistent123', { mode: 'bm25' });
      assert.strictEqual(results.length, 0, 'Should return no results for garbage query');
    });
  });

  describe('Vector Search (Semantic)', () => {
    it('should find semantically similar content', async () => {
      // Search for related concept not using exact words
      const results = await searchMemories('coding software development', { mode: 'vector' });
      assert.ok(results.length >= 1, 'Should find at least 1 result');
      // Should find programming-related content
      const hasRelevant = results.some(r => 
        r.memory.content.includes('programming') || 
        r.memory.content.includes('JavaScript') ||
        r.memory.content.includes('TypeScript')
      );
      assert.ok(hasRelevant, 'Should find programming-related content semantically');
    });

    it('should rank by similarity score', async () => {
      const results = await searchMemories('database storage', { mode: 'vector' });
      assert.ok(results.length >= 1, 'Should find at least 1 result');
      // Results should be ordered by score (descending)
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].score >= results[i].score,
          'Results should be ordered by descending score'
        );
      }
    });

    it('should find animal-related content for pet query', async () => {
      const results = await searchMemories('pets domestic animals', { mode: 'vector' });
      assert.ok(results.length >= 1, 'Should find at least 1 result');
      const hasCats = results.some(r => r.memory.content.includes('Cats'));
      assert.ok(hasCats, 'Should find cat content for pets query');
    });
  });

  describe('Hybrid Search', () => {
    it('should combine BM25 and vector results', async () => {
      const results = await searchMemories('JavaScript types', { mode: 'hybrid' });
      assert.ok(results.length >= 1, 'Should find at least 1 result');
      assert.strictEqual(results[0].source, 'hybrid', 'Source should be hybrid');
    });

    it('should respect bm25Weight parameter', async () => {
      // Heavy BM25 weight should favor exact matches
      const heavyBM25 = await searchMemories('JavaScript', { 
        mode: 'hybrid', 
        bm25Weight: 0.9 
      });
      // Heavy vector weight should favor semantic matches
      const heavyVector = await searchMemories('JavaScript', { 
        mode: 'hybrid', 
        bm25Weight: 0.1 
      });
      
      // Both should return results
      assert.ok(heavyBM25.length >= 1, 'Heavy BM25 should find results');
      assert.ok(heavyVector.length >= 1, 'Heavy vector should find results');
    });

    it('should filter by minScore', async () => {
      const results = await searchMemories('random query', { 
        mode: 'hybrid',
        minScore: 0.9  // Very high threshold
      });
      // High threshold should filter out low-confidence results
      for (const r of results) {
        assert.ok(r.score >= 0.9, 'All results should meet minScore threshold');
      }
    });

    it('should respect limit parameter', async () => {
      const results = await searchMemories('language', { mode: 'hybrid', limit: 2 });
      assert.ok(results.length <= 2, 'Should respect limit parameter');
    });
  });

  describe('Search Options', () => {
    it('should filter by memory type', async () => {
      // Store a note type
      await storeMemory({ content: 'This is a note about searching', type: 'note' });
      
      const results = await searchMemories('searching', { type: 'note' });
      for (const r of results) {
        assert.strictEqual(r.memory.type, 'note', 'Should only return notes');
      }
    });

    it('should support all three modes', async () => {
      const modes: Array<'bm25' | 'vector' | 'hybrid'> = ['bm25', 'vector', 'hybrid'];
      for (const mode of modes) {
        const results = await searchMemories('test', { mode });
        assert.ok(Array.isArray(results), `Mode ${mode} should return array`);
      }
    });

    it('should default to hybrid mode', async () => {
      const results = await searchMemories('JavaScript', {});
      assert.ok(results.length >= 1, 'Default search should work');
      assert.strictEqual(results[0].source, 'hybrid', 'Default should be hybrid');
    });
  });
});
