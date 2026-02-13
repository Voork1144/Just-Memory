/**
 * Tests for src/validation.ts
 * Input validation helpers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateContent, validateTags, validateEntityName,
  validateObservations, sanitizeLikePattern, getEffectiveProject,
  sanitizeProjectId,
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

  it('should escape backslashes before % and _', () => {
    const result = sanitizeLikePattern('path\\to\\file%name');
    assert.strictEqual(result, 'path\\\\to\\\\file\\%name');
  });

  it('should escape lone backslashes', () => {
    const result = sanitizeLikePattern('back\\slash');
    assert.strictEqual(result, 'back\\\\slash');
  });
});

describe('sanitizeProjectId', () => {
  it('should accept valid project IDs', () => {
    assert.strictEqual(sanitizeProjectId('my-project'), 'my-project');
    assert.strictEqual(sanitizeProjectId('test_123'), 'test_123');
  });

  it('should reject reserved project IDs', () => {
    assert.throws(() => sanitizeProjectId('system'), /reserved/i);
    assert.throws(() => sanitizeProjectId('admin'), /reserved/i);
    assert.throws(() => sanitizeProjectId('default'), /reserved/i);
  });

  it('should accept "global" as the default fallback project ID', () => {
    assert.strictEqual(sanitizeProjectId('global'), 'global');
    assert.strictEqual(sanitizeProjectId('GLOBAL'), 'global');
  });

  it('should reject reserved IDs case-insensitively', () => {
    assert.throws(() => sanitizeProjectId('System'), /reserved/i);
    assert.throws(() => sanitizeProjectId('ADMIN'), /reserved/i);
  });

  it('should reject invalid patterns', () => {
    assert.throws(() => sanitizeProjectId('has spaces'), /invalid/i);
    assert.throws(() => sanitizeProjectId('../traversal'), /invalid/i);
    assert.throws(() => sanitizeProjectId(''), /invalid/i);
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
