/**
 * Tests for src/contradiction.ts
 * Fact extraction, negation detection, antonym detection, contradiction finding.
 * These tests focus on the pure logic functions (no models needed).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from './helpers/test-db.js';
import {
  extractFacts,
  hasNegation,
  findAntonymConflict,
  factsContradict,
  isValidEmbedding,
  cosineSimilarity,
} from '../src/contradiction.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

before(() => { db = createTestDb(); });
after(() => { db.close(); });

describe('extractFacts', () => {
  it('should extract factual claims matching patterns', () => {
    // "The sky is blue" matches pattern: (.+?) is/are (.+)
    const facts = extractFacts('The sky is blue. Python is a great language.');
    assert.ok(facts.length >= 1, `Expected >= 1 fact, got ${facts.length}`);
    assert.ok(facts.some(f => f.subject.includes('sky')), 'Should extract sky fact');
  });

  it('should extract facts with "has" pattern', () => {
    const facts = extractFacts('The project has a database.');
    assert.ok(facts.length >= 1, `Expected >= 1 fact, got ${facts.length}`);
  });

  it('should handle empty input', () => {
    const facts = extractFacts('');
    assert.strictEqual(facts.length, 0, 'Empty input should return no facts');
  });

  it('should return ExtractedFact shape', () => {
    const facts = extractFacts('TypeScript is a typed language.');
    if (facts.length > 0) {
      assert.ok('subject' in facts[0], 'Should have subject');
      assert.ok('predicate' in facts[0], 'Should have predicate');
      assert.ok('object' in facts[0], 'Should have object');
      assert.ok('raw' in facts[0], 'Should have raw');
    }
  });
});

describe('hasNegation', () => {
  it('should detect explicit negation patterns', () => {
    assert.ok(hasNegation('This is not true').has, 'Should detect "not"');
    assert.ok(hasNegation('I never said that').has, 'Should detect "never"');
  });

  it('should detect "no" as word boundary match', () => {
    const result = hasNegation('There is no way');
    assert.ok(result.has, 'Should detect "no"');
    assert.strictEqual(result.type, 'explicit');
  });

  it('should not false-positive on words containing negation substrings', () => {
    // "note" contains "no" but word-level matching should prevent false positive
    const result = hasNegation('I took a note about the project');
    assert.ok(!result.has, 'Should not detect "no" inside "note"');
  });

  it('should return correct shape', () => {
    const result = hasNegation('Some text');
    assert.ok('has' in result, 'Should have "has" property');
    assert.ok('type' in result, 'Should have "type" property');
  });
});

describe('findAntonymConflict', () => {
  it('should detect antonym pairs with shared context', () => {
    const result = findAntonymConflict(
      'The system processing speed is fast and efficient',
      'The system processing speed is slow and problematic'
    );
    assert.ok(result.found, 'Should detect fast/slow antonym pair');
    assert.ok(result.pair, 'Should return the antonym pair');
  });

  it('should not flag texts without shared context', () => {
    const result = findAntonymConflict('The sky is blue', 'The car is red');
    assert.ok(!result.found, 'Should not find antonyms without shared context');
  });

  it('should return {found: false} shape when no match', () => {
    const result = findAntonymConflict('Hello world', 'Goodbye moon');
    assert.strictEqual(result.found, false);
  });
});

describe('factsContradict', () => {
  it('should detect contradicting facts with same subject, different numeric object', () => {
    const result = factsContradict(
      { subject: 'the project default port', predicate: 'is', object: '3000', raw: 'The project default port is 3000' },
      { subject: 'the project default port', predicate: 'is', object: '8080', raw: 'The project default port is 8080' }
    );
    assert.ok(result, 'Should detect numeric contradiction');
  });

  it('should not flag facts with different subjects', () => {
    const result = factsContradict(
      { subject: 'the sky', predicate: 'is', object: 'blue', raw: 'The sky is blue' },
      { subject: 'the ocean', predicate: 'is', object: 'green', raw: 'The ocean is green' }
    );
    assert.ok(!result, 'Different subjects should not contradict');
  });

  it('should not flag facts with same subject and same object', () => {
    const result = factsContradict(
      { subject: 'the project database', predicate: 'is', object: 'sqlite', raw: 'The project database is sqlite' },
      { subject: 'the project database', predicate: 'is', object: 'sqlite', raw: 'The project database is sqlite' }
    );
    assert.ok(!result, 'Same facts should not contradict');
  });

  it('should detect contradiction with short single-word subjects (v4.3.1)', () => {
    const result = factsContradict(
      { subject: 'python', predicate: 'is', object: 'fast', raw: 'Python is fast' },
      { subject: 'python', predicate: 'is', object: 'slow', raw: 'Python is slow' }
    );
    assert.ok(result, 'Same single-word subject with different objects should contradict');
  });

  it('should not flag short subjects that are different', () => {
    const result = factsContradict(
      { subject: 'python', predicate: 'is', object: 'fast', raw: 'Python is fast' },
      { subject: 'rust', predicate: 'is', object: 'slow', raw: 'Rust is slow' }
    );
    assert.ok(!result, 'Different single-word subjects should not contradict');
  });
});

describe('isValidEmbedding', () => {
  // isValidEmbedding checks Buffer.length === EMBEDDING_DIM * 4 (1024 * 4 = 4096 bytes)
  it('should accept valid 1024-dim embedding buffer', () => {
    const arr = new Float32Array(1024);
    arr[0] = 0.1; arr[1] = 0.2;
    const valid = Buffer.from(arr.buffer);
    assert.ok(isValidEmbedding(valid), 'Should accept valid 1024-dim embedding');
  });

  it('should reject null/undefined', () => {
    assert.ok(!isValidEmbedding(null as any), 'Should reject null');
    assert.ok(!isValidEmbedding(undefined as any), 'Should reject undefined');
  });

  it('should reject wrong-dimension buffer', () => {
    const small = Buffer.from(new Float32Array(10).buffer);
    assert.ok(!isValidEmbedding(small), 'Should reject wrong-dimension buffer');
  });
});

describe('cosineSimilarity', () => {
  // cosineSimilarity expects Buffer with EMBEDDING_DIM (1024) float32 values
  function makeEmbeddingBuffer(firstValue: number, rest = 0): Buffer {
    const arr = new Float32Array(1024);
    arr[0] = firstValue;
    for (let i = 1; i < 1024; i++) arr[i] = rest;
    return Buffer.from(arr.buffer);
  }

  it('should return 1.0 for identical vectors', () => {
    const a = makeEmbeddingBuffer(1, 0);
    const b = makeEmbeddingBuffer(1, 0);
    const sim = cosineSimilarity(a, b);
    assert.ok(Math.abs(sim - 1.0) < 0.001, `Expected ~1.0, got ${sim}`);
  });

  it('should return 0.0 for orthogonal vectors', () => {
    const a = new Float32Array(1024); a[0] = 1;
    const b = new Float32Array(1024); b[1] = 1;
    const sim = cosineSimilarity(Buffer.from(a.buffer), Buffer.from(b.buffer));
    assert.ok(Math.abs(sim) < 0.001, `Expected ~0.0, got ${sim}`);
  });

  it('should return -1.0 for opposite vectors', () => {
    const a = makeEmbeddingBuffer(1, 0);
    const b = makeEmbeddingBuffer(-1, 0);
    const sim = cosineSimilarity(a, b);
    assert.ok(Math.abs(sim + 1.0) < 0.001, `Expected ~-1.0, got ${sim}`);
  });

  it('should handle zero vectors gracefully', () => {
    const a = makeEmbeddingBuffer(0, 0);
    const b = makeEmbeddingBuffer(1, 0);
    const sim = cosineSimilarity(a, b);
    assert.strictEqual(sim, 0, 'Should return 0 for zero vector');
  });
});

// v4.2: Version update contradiction detection (inline logic test)
describe('version update contradiction detection (v4.2)', () => {
  // Replicate the isVersionUpdateContradiction logic for testing
  function isVersionUpdateContradiction(content1: string, content2: string): boolean {
    const versionRegex = /v?(\d+\.\d+(?:\.\d+)?)/g;
    const versions1 = [...content1.matchAll(versionRegex)].map(m => m[1]);
    const versions2 = [...content2.matchAll(versionRegex)].map(m => m[1]);
    if (versions1.length === 0 || versions2.length === 0) return false;
    const words1 = new Set(content1.toLowerCase().replace(/v?\d+\.\d+/g, '').split(/\W+/).filter(w => w.length > 3));
    const words2 = new Set(content2.toLowerCase().replace(/v?\d+\.\d+/g, '').split(/\W+/).filter(w => w.length > 3));
    const overlap = [...words1].filter(w => words2.has(w)).length;
    return overlap >= 3 && versions1.some(v1 => versions2.some(v2 => v1 !== v2));
  }

  it('should detect version update patterns', () => {
    assert.strictEqual(
      isVersionUpdateContradiction(
        'Just-Memory v3.13 has 23 tools and 160 tests passing',
        'Just-Memory v4.0 has 23 tools and 167 tests passing'
      ), true);
  });

  it('should not flag unrelated content as version update', () => {
    assert.strictEqual(
      isVersionUpdateContradiction('The sky is blue today', 'The ocean is deep and vast'),
      false);
  });

  it('should not flag same-version memories', () => {
    assert.strictEqual(
      isVersionUpdateContradiction(
        'Just-Memory v4.0 has 23 tools',
        'Just-Memory v4.0 has 160 tests passing'
      ), false);
  });
});

describe('temporal supersession detection (v4.2)', () => {
  function isTemporalSupersession(createdAt1: string, createdAt2: string): 'first_newer' | 'second_newer' | false {
    const d1 = new Date(createdAt1).getTime();
    const d2 = new Date(createdAt2).getTime();
    const daysDiff = Math.abs(d1 - d2) / 86400000;
    if (daysDiff < 30) return false;
    return d1 > d2 ? 'first_newer' : 'second_newer';
  }

  it('should detect temporal supersession with 30+ day gap', () => {
    assert.strictEqual(isTemporalSupersession('2026-01-01', '2026-02-07'), 'second_newer');
    assert.strictEqual(isTemporalSupersession('2026-02-07', '2026-01-01'), 'first_newer');
  });

  it('should not flag close timestamps', () => {
    assert.strictEqual(isTemporalSupersession('2026-02-06', '2026-02-07'), false);
    assert.strictEqual(isTemporalSupersession('2026-01-20', '2026-02-07'), false);
  });
});
