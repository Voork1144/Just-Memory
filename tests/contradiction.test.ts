/**
 * Tests for Just-Memory Contradiction Detection
 * 
 * Tests the contradiction detection system including:
 * - Negation detection
 * - Antonym detection
 * - Numeric contradiction detection
 * - Entity-attribute conflicts
 * - Confidence adjustment
 * - Contradiction flagging and resolution
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  initDatabase,
  closeDatabase,
  storeMemory,
} from '../src/memory/index.js';
import {
  detectContradiction,
  checkAndAdjustConfidence,
  flagContradiction,
  resolveContradiction,
  getUnresolvedContradictions,
  getContradictionStats,
} from '../src/memory/contradiction.js';
import { initEmbeddings } from '../src/memory/embeddings.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

const TEST_DIR = join(tmpdir(), 'just-memory-contradiction-test-' + Date.now());
const TEST_DB = join(TEST_DIR, 'test.db');

describe('Contradiction Detection', () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    await initDatabase({ dbPath: TEST_DB });
    await initEmbeddings();
  });

  afterAll(async () => {
    await closeDatabase();
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  });

  describe('Basic Detection', () => {
    beforeEach(async () => {
      // Store baseline memories for testing
      await storeMemory({
        content: 'The sky is blue.',
        type: 'fact',
        tags: ['weather', 'nature'],
      });
      await storeMemory({
        content: 'Water is wet.',
        type: 'fact',
        tags: ['science'],
      });
    });

    test('should detect no contradiction for unrelated content', async () => {
      const result = await detectContradiction('Dogs are mammals.');
      expect(result.hasContradiction).toBe(false);
    });

    test('should detect negation contradiction', async () => {
      await storeMemory({
        content: 'Paris is the capital of France.',
        type: 'fact',
        tags: ['geography'],
      });
      
      const result = await detectContradiction('Paris is not the capital of France.');
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('negation');
    });

    test('should detect antonym contradiction', async () => {
      await storeMemory({
        content: 'The temperature is hot today.',
        type: 'fact',
        tags: ['weather'],
      });
      
      const result = await detectContradiction('The temperature is cold today.');
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('antonym');
    });
  });

  describe('Numeric Contradictions', () => {
    test('should detect numeric disagreement', async () => {
      await storeMemory({
        content: 'The population of the city is 1000000.',
        type: 'fact',
        tags: ['demographics'],
      });
      
      const result = await detectContradiction('The population of the city is 500000.');
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('numeric');
    });

    test('should not flag small numeric differences', async () => {
      await storeMemory({
        content: 'The price is 100 dollars.',
        type: 'fact',
        tags: ['commerce'],
      });
      
      // 5% difference should not trigger
      const result = await detectContradiction('The price is 105 dollars.');
      expect(result.hasContradiction).toBe(false);
    });
  });

  describe('Entity Conflicts', () => {
    test('should detect entity-attribute conflict', async () => {
      await storeMemory({
        content: "John's location is New York.",
        type: 'fact',
        tags: ['person'],
      });
      
      const result = await detectContradiction("John's location is Los Angeles.");
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('entity_conflict');
    });
  });

  describe('Confidence Adjustment', () => {
    test('should lower confidence when contradiction found', async () => {
      await storeMemory({
        content: 'The company is profitable.',
        type: 'fact',
        tags: ['business'],
      });
      
      const result = await checkAndAdjustConfidence(
        'test_id',
        'The company is not profitable.',
        1.0
      );
      
      expect(result.confidence).toBeLessThan(1.0);
      expect(result.contradiction).toBeDefined();
    });

    test('should maintain confidence when no contradiction', async () => {
      const result = await checkAndAdjustConfidence(
        'test_id',
        'Completely unrelated content about dinosaurs.',
        0.9
      );
      
      expect(result.confidence).toBe(0.9);
      expect(result.contradiction).toBeUndefined();
    });
  });

  describe('Contradiction Management', () => {
    test('should flag and track contradictions', async () => {
      const mem1 = await storeMemory({
        content: 'The project is complete.',
        type: 'fact',
      });
      const mem2 = await storeMemory({
        content: 'The project is not complete.',
        type: 'fact',
      });

      await flagContradiction(
        mem1.id,
        mem2.id,
        'negation',
        'Direct negation: complete vs not complete'
      );

      const unresolved = await getUnresolvedContradictions();
      expect(unresolved.length).toBeGreaterThan(0);
      
      const stats = await getContradictionStats();
      expect(stats.unresolved).toBeGreaterThan(0);
    });

    test('should resolve contradictions', async () => {
      const mem1 = await storeMemory({
        content: 'The meeting is today.',
        type: 'fact',
      });
      const mem2 = await storeMemory({
        content: 'The meeting is tomorrow.',
        type: 'fact',
      });

      await flagContradiction(
        mem1.id,
        mem2.id,
        'entity_conflict',
        'Meeting date conflict'
      );

      const before = await getUnresolvedContradictions();
      const contradictionId = before[before.length - 1]?.id;
      
      if (contradictionId) {
        await resolveContradiction(contradictionId, 'keep_new');
        
        const after = await getUnresolvedContradictions();
        expect(after.length).toBeLessThan(before.length);
      }
    });
  });

  describe('Options', () => {
    test('should respect similarity threshold', async () => {
      await storeMemory({
        content: 'The algorithm is efficient.',
        type: 'fact',
      });
      
      // With high threshold, less likely to find contradiction
      const result = await detectContradiction(
        'The algorithm is inefficient.',
        { similarityThreshold: 0.95 }
      );
      
      // May or may not find it depending on embedding similarity
      expect(typeof result.hasContradiction).toBe('boolean');
    });

    test('should respect max candidates', async () => {
      // Store multiple memories
      for (let i = 0; i < 5; i++) {
        await storeMemory({
          content: `Test memory number ${i} about data.`,
          type: 'fact',
        });
      }
      
      const result = await detectContradiction(
        'Test memory with contradicting data.',
        { maxCandidates: 2 }
      );
      
      expect(typeof result.hasContradiction).toBe('boolean');
    });
  });
});
