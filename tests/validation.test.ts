/**
 * Tests for src/validation.ts
 * Input validation helpers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateContent, validateTags, validateEntityName,
  validateObservations, sanitizeLikePattern, getEffectiveProject,
} from '../src/validation.js';

describe('validateContent', () => {
  it('should accept valid content', () => {
    assert.doesNotThrow(() => validateContent('Hello world'));
  });

  it('should reject empty string', () => {
    assert.throws(() => validateContent(''), /content/i);
  });

  it('should reject non-string input', () => {
    assert.throws(() => validateContent(null as any), /content/i);
    assert.throws(() => validateContent(undefined as any), /content/i);
  });

  it('should accept whitespace-only content (not trimmed)', () => {
    // validateContent checks `!content` — whitespace is truthy
    assert.doesNotThrow(() => validateContent('   '));
  });

  it('should reject overly long content', () => {
    const huge = 'x'.repeat(200_000);
    assert.throws(() => validateContent(huge), /content/i);
  });
});

describe('validateTags', () => {
  it('should accept valid tags', () => {
    const result = validateTags(['tag1', 'tag2', 'tag3']);
    assert.deepStrictEqual(result, ['tag1', 'tag2', 'tag3']);
  });

  it('should filter empty-string tags but keep whitespace tags', () => {
    // validateTags does String(t).filter(t => t.length > 0) — no trim
    const result = validateTags(['tag1', '', 'tag2']);
    assert.deepStrictEqual(result, ['tag1', 'tag2']);
  });

  it('should truncate too many tags', () => {
    const manyTags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    const result = validateTags(manyTags);
    assert.ok(result.length <= 20, `Expected <= 20 tags, got ${result.length}`);
  });

  it('should handle non-array gracefully', () => {
    const result = validateTags(undefined as any);
    assert.deepStrictEqual(result, []);
  });
});

describe('validateEntityName', () => {
  it('should accept valid names', () => {
    assert.doesNotThrow(() => validateEntityName('MyEntity'));
  });

  it('should reject empty string', () => {
    assert.throws(() => validateEntityName(''), /name/i);
  });

  it('should reject null/undefined', () => {
    assert.throws(() => validateEntityName(null as any), /name/i);
    assert.throws(() => validateEntityName(undefined as any), /name/i);
  });
});

describe('validateObservations', () => {
  it('should accept valid observations', () => {
    const result = validateObservations(['obs1', 'obs2']);
    assert.deepStrictEqual(result, ['obs1', 'obs2']);
  });

  it('should filter empty-string observations', () => {
    const result = validateObservations(['obs1', '', 'obs2']);
    assert.deepStrictEqual(result, ['obs1', 'obs2']);
  });

  it('should handle non-array gracefully', () => {
    const result = validateObservations(null as any);
    assert.deepStrictEqual(result, []);
  });
});

describe('sanitizeLikePattern', () => {
  it('should escape % and _ characters', () => {
    const result = sanitizeLikePattern('test%value_here');
    assert.strictEqual(result, 'test\\%value\\_here');
  });

  it('should handle normal strings', () => {
    const result = sanitizeLikePattern('normal text');
    assert.strictEqual(result, 'normal text');
  });
});

describe('getEffectiveProject', () => {
  it('should return provided project ID when given', () => {
    const result = getEffectiveProject('my-project', 'fallback');
    assert.strictEqual(result, 'my-project');
  });

  it('should return fallback when project ID is undefined', () => {
    const result = getEffectiveProject(undefined, 'fallback');
    assert.strictEqual(result, 'fallback');
  });

  it('should return fallback when project ID is empty', () => {
    const result = getEffectiveProject('', 'fallback');
    assert.strictEqual(result, 'fallback');
  });

  it('should lowercase and trim the project ID', () => {
    const result = getEffectiveProject('  MyProject  ', 'fallback');
    assert.strictEqual(result, 'myproject');
  });
});
