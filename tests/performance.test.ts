/**
 * Tests for Just-Memory Performance Optimization
 * 
 * Tests caching, profiling, optimization utilities, and batch operations.
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  initDatabase,
  closeDatabase,
  storeMemory,
} from '../src/memory/index.js';
import {
  generateSearchCacheKey,
  getCachedSearch,
  cacheSearchResults,
  getCachedMemory,
  cacheMemory,
  invalidateOnWrite,
  invalidateAllCaches,
  getCacheStats,
  profileQuery,
  profileQueryAsync,
  getQueryProfiles,
  resetQueryProfiles,
  getIndexStats,
  optimizeDatabase,
  createRecommendedIndexes,
  createMemoryBatchInserter,
  runBenchmark,
  getPerformanceRecommendations,
  getDatabasePerformanceStats,
  LRUCache,
} from '../src/memory/performance.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

const TEST_DIR = join(tmpdir(), 'just-memory-perf-test-' + Date.now());
const TEST_DB = join(TEST_DIR, 'test.db');

describe('Performance Optimization', () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    await initDatabase({ dbPath: TEST_DB });
  });

  afterAll(async () => {
    await closeDatabase();
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  });

  beforeEach(() => {
    invalidateAllCaches();
    resetQueryProfiles();
  });

  describe('LRU Cache', () => {
    test('should store and retrieve values', () => {
      const cache = new LRUCache<string, number>(10, 60000);
      
      cache.set('key1', 100);
      cache.set('key2', 200);
      
      expect(cache.get('key1')).toBe(100);
      expect(cache.get('key2')).toBe(200);
    });

    test('should evict LRU entries when at capacity', () => {
      const cache = new LRUCache<string, number>(3, 60000);
      
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // Should evict 'a'
      
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    test('should expire entries after TTL', async () => {
      const cache = new LRUCache<string, number>(10, 50); // 50ms TTL
      
      cache.set('key', 42);
      expect(cache.get('key')).toBe(42);
      
      await new Promise(r => setTimeout(r, 100));
      
      expect(cache.get('key')).toBeUndefined();
    });

    test('should track cache statistics', () => {
      const cache = new LRUCache<string, number>(10, 60000);
      
      cache.set('key', 1);
      cache.get('key'); // hit
      cache.get('key'); // hit
      cache.get('nonexistent'); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.entries).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2/3);
    });

    test('should invalidate by pattern', () => {
      const cache = new LRUCache<string, number>(10, 60000);
      
      cache.set('search:query1', 1);
      cache.set('search:query2', 2);
      cache.set('memory:id1', 3);
      
      const invalidated = cache.invalidatePattern(k => k.startsWith('search:'));
      
      expect(invalidated).toBe(2);
      expect(cache.get('search:query1')).toBeUndefined();
      expect(cache.get('memory:id1')).toBe(3);
    });
  });

  describe('Search Cache', () => {
    test('should generate consistent cache keys', () => {
      const key1 = generateSearchCacheKey('hello world', { limit: 10, type: 'fact' });
      const key2 = generateSearchCacheKey('HELLO WORLD', { type: 'fact', limit: 10 });
      
      expect(key1).toBe(key2); // Same normalized query and options
    });

    test('should cache and retrieve search results', () => {
      const key = generateSearchCacheKey('test query', {});
      const results = [{ id: '1', content: 'test' }];
      
      cacheSearchResults(key, results);
      expect(getCachedSearch(key)).toEqual(results);
    });

    test('should invalidate on write', () => {
      const key = generateSearchCacheKey('test', {});
      cacheSearchResults(key, [{ id: '1' }]);
      
      expect(getCachedSearch(key)).toBeDefined();
      invalidateOnWrite();
      expect(getCachedSearch(key)).toBeUndefined();
    });
  });

  describe('Memory Cache', () => {
    test('should cache individual memories', () => {
      const memory = { id: 'mem1', content: 'Test memory content' };
      
      cacheMemory('mem1', memory);
      expect(getCachedMemory('mem1')).toEqual(memory);
    });

    test('should invalidate specific memory on write', () => {
      cacheMemory('mem1', { id: 'mem1' });
      cacheMemory('mem2', { id: 'mem2' });
      
      invalidateOnWrite('mem1');
      
      expect(getCachedMemory('mem1')).toBeUndefined();
      // mem2 might still exist (search cache is cleared, not memory cache for other IDs)
    });
  });

  describe('Query Profiling', () => {
    test('should profile synchronous queries', () => {
      const result = profileQuery('test_query', () => {
        // Simulate work
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += i;
        return sum;
      });
      
      expect(result).toBe(499500);
      
      const profiles = getQueryProfiles();
      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles[0].query).toBe('test_query');
      expect(profiles[0].calls).toBe(1);
    });

    test('should profile async queries', async () => {
      const result = await profileQueryAsync('async_query', async () => {
        await new Promise(r => setTimeout(r, 10));
        return 'done';
      });
      
      expect(result).toBe('done');
      
      const profiles = getQueryProfiles();
      const asyncProfile = profiles.find(p => p.query === 'async_query');
      expect(asyncProfile).toBeDefined();
      expect(asyncProfile!.avgMs).toBeGreaterThanOrEqual(10);
    });

    test('should accumulate profile statistics', () => {
      for (let i = 0; i < 5; i++) {
        profileQuery('repeated_query', () => null);
      }
      
      const profiles = getQueryProfiles();
      const repeated = profiles.find(p => p.query === 'repeated_query');
      expect(repeated?.calls).toBe(5);
    });
  });

  describe('Cache Statistics', () => {
    test('should aggregate cache stats', () => {
      // Generate some cache activity
      cacheSearchResults('key1', []);
      getCachedSearch('key1'); // hit
      getCachedSearch('missing'); // miss
      cacheMemory('mem1', {});
      getCachedMemory('mem1'); // hit
      
      const stats = getCacheStats();
      expect(stats.total.hits).toBeGreaterThanOrEqual(2);
      expect(stats.total.misses).toBeGreaterThanOrEqual(1);
      expect(stats.total.entries).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Index Optimization', () => {
    test('should get index stats', () => {
      const stats = getIndexStats();
      expect(Array.isArray(stats)).toBe(true);
      // Should have at least some indexes from schema
    });

    test('should create recommended indexes', () => {
      const created = createRecommendedIndexes();
      expect(Array.isArray(created)).toBe(true);
      // Some indexes should be created
    });
  });

  describe('Database Optimization', () => {
    test('should optimize database', () => {
      const result = optimizeDatabase();
      expect(result.analyzed).toBe(true);
    });

    test('should get database performance stats', () => {
      const stats = getDatabasePerformanceStats();
      expect(stats.pageSize).toBeGreaterThan(0);
      expect(typeof stats.pageCount).toBe('number');
    });
  });

  describe('Batch Operations', () => {
    test('should batch insert memories', async () => {
      const batch = createMemoryBatchInserter(10);
      
      for (let i = 0; i < 5; i++) {
        batch.add({
          id: `batch_${Date.now()}_${i}`,
          content: `Batch test memory ${i}`,
          type: 'fact',
          tags: ['batch', 'test'],
          projectId: 'test-project',
        });
      }
      
      await batch.flush();
      
      const stats = batch.getStats();
      expect(stats.flushed).toBe(5);
      expect(stats.errors).toBe(0);
    });
  });

  describe('Benchmarking', () => {
    test('should run benchmarks', async () => {
      const result = await runBenchmark(
        'simple_op',
        () => {
          let x = 0;
          for (let i = 0; i < 100; i++) x += i;
        },
        10
      );
      
      expect(result.name).toBe('simple_op');
      expect(result.iterations).toBe(10);
      expect(result.avgMs).toBeGreaterThan(0);
      expect(result.opsPerSecond).toBeGreaterThan(0);
    });
  });

  describe('Recommendations', () => {
    test('should generate performance recommendations', () => {
      const recommendations = getPerformanceRecommendations();
      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeGreaterThan(0);
    });
  });
});
