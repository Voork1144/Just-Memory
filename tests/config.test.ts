/**
 * Tests for src/config.ts
 * Constants, thresholds, safeParse utility.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MAX_CONTENT_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_COUNT,
  EMBEDDING_DIM, GLOBAL_PROJECT,
  CONTRADICTION_CONFIG,
  safeParse,
} from '../src/config.js';

describe('Constants', () => {
  it('should have sane max content length', () => {
    assert.ok(MAX_CONTENT_LENGTH > 0);
    assert.ok(MAX_CONTENT_LENGTH <= 1_000_000);
  });

  it('should have sane tag limits', () => {
    assert.ok(MAX_TAG_LENGTH > 0);
    assert.ok(MAX_TAGS_COUNT > 0 && MAX_TAGS_COUNT <= 100);
  });

  it('should have correct embedding dimension', () => {
    assert.strictEqual(EMBEDDING_DIM, 1024);
  });

  it('should have global project constant', () => {
    assert.strictEqual(GLOBAL_PROJECT, 'global');
  });

  it('should have contradiction config with valid thresholds', () => {
    assert.ok(CONTRADICTION_CONFIG.SEMANTIC_SIMILARITY_THRESHOLD > 0);
    assert.ok(CONTRADICTION_CONFIG.SEMANTIC_SIMILARITY_THRESHOLD <= 1);
    assert.ok(CONTRADICTION_CONFIG.NLI_CONFIDENCE_THRESHOLD > 0);
    assert.ok(CONTRADICTION_CONFIG.NLI_CONFIDENCE_THRESHOLD <= 1);
    assert.ok(CONTRADICTION_CONFIG.MAX_RESULTS > 0);
  });
});

describe('safeParse', () => {
  it('should parse valid JSON', () => {
    assert.deepStrictEqual(safeParse('{"a":1}', {}), { a: 1 });
    assert.deepStrictEqual(safeParse('[1,2,3]', []), [1, 2, 3]);
    assert.deepStrictEqual(safeParse('"hello"', ''), 'hello');
  });

  it('should return fallback for invalid JSON', () => {
    assert.deepStrictEqual(safeParse('not json', {}), {});
    assert.deepStrictEqual(safeParse(undefined as any, []), []);
    assert.deepStrictEqual(safeParse(null as any, 'default'), 'default');
  });

  it('should return fallback for empty string', () => {
    assert.deepStrictEqual(safeParse('', []), []);
  });
});
