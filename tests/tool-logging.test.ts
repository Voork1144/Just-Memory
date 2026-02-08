/**
 * Tests for src/tool-logging.ts
 * Log truncation, tool call logging, stats aggregation, history queries.
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from './helpers/test-db.js';
import { truncateForLog, logToolCall, getToolStats, getToolHistory } from '../src/tool-logging.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const projectId = 'test-project';

beforeEach(() => {
  db?.close();
  db = createTestDb();
});

after(() => { db?.close(); });

// ============================================================================
// truncateForLog
// ============================================================================

describe('truncateForLog', () => {
  it('should return short strings unchanged', () => {
    assert.strictEqual(truncateForLog('hello'), 'hello');
  });

  it('should truncate strings over maxLen', () => {
    const long = 'x'.repeat(200);
    const result = truncateForLog(long, 50);
    assert.ok(result.length < 200);
    assert.ok(result.includes('[truncated'));
    assert.ok(result.includes('150 chars omitted'));
  });

  it('should handle empty string', () => {
    assert.strictEqual(truncateForLog(''), '');
  });

  it('should handle null/undefined input', () => {
    assert.strictEqual(truncateForLog(null as any), null);
    assert.strictEqual(truncateForLog(undefined as any), undefined);
  });

  it('should use default maxLen from config', () => {
    // Default TOOL_LOG_MAX_OUTPUT is much larger than our test string
    const short = 'short string';
    assert.strictEqual(truncateForLog(short), short);
  });
});

// ============================================================================
// logToolCall
// ============================================================================

describe('logToolCall', () => {
  it('should insert a tool call record and return ID', () => {
    const id = logToolCall(db, 'memory_store', { content: 'test' }, { ok: true }, true, null, 150, projectId);
    assert.ok(id, 'Should return an ID');

    const row = db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as any;
    assert.ok(row);
    assert.strictEqual(row.tool_name, 'memory_store');
    assert.strictEqual(row.success, 1);
    assert.strictEqual(row.duration_ms, 150);
    assert.strictEqual(row.project_id, projectId);
  });

  it('should log failed calls with error message', () => {
    const id = logToolCall(db, 'memory_recall', { id: 'bad' }, null, false, 'Not found', 10, projectId);
    const row = db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as any;
    assert.strictEqual(row.success, 0);
    assert.strictEqual(row.error, 'Not found');
  });

  it('should call sessionUpdater callback when provided', () => {
    let updaterCalled = false;
    let capturedTool = '';
    const updater = (toolName: string, _args: any) => {
      updaterCalled = true;
      capturedTool = toolName;
    };

    logToolCall(db, 'memory_search', { query: 'test' }, { results: [] }, true, null, 50, projectId, updater);
    assert.ok(updaterCalled, 'Session updater should be called');
    assert.strictEqual(capturedTool, 'memory_search');
  });

  it('should handle null args gracefully', () => {
    const id = logToolCall(db, 'memory_list', null, { items: [] }, true, null, 5, projectId);
    const row = db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as any;
    assert.strictEqual(row.arguments, '{}');
  });
});

// ============================================================================
// getToolStats
// ============================================================================

describe('getToolStats', () => {
  it('should aggregate stats by tool name', () => {
    logToolCall(db, 'memory_store', {}, {}, true, null, 100, projectId);
    logToolCall(db, 'memory_store', {}, {}, true, null, 200, projectId);
    logToolCall(db, 'memory_store', {}, {}, false, 'error', 50, projectId);
    logToolCall(db, 'memory_search', {}, {}, true, null, 30, projectId);

    const result = getToolStats(db, projectId);
    assert.strictEqual(result.summary.total_calls, 4);
    assert.strictEqual(result.summary.successful, 3);
    assert.strictEqual(result.summary.failed, 1);

    const storeStat = result.by_tool.find((t: any) => t.tool === 'memory_store');
    assert.ok(storeStat);
    assert.strictEqual(storeStat.calls, 3);
    assert.strictEqual(storeStat.successful, 2);
    assert.strictEqual(storeStat.failed, 1);
  });

  it('should return global stats without projectId', () => {
    logToolCall(db, 'memory_store', {}, {}, true, null, 100, 'proj-a');
    logToolCall(db, 'memory_store', {}, {}, true, null, 200, 'proj-b');

    const result = getToolStats(db);
    assert.strictEqual(result.summary.total_calls, 2);
    assert.strictEqual(result.project_id, 'all');
  });

  it('should return empty stats for no tool calls', () => {
    const result = getToolStats(db, projectId);
    assert.strictEqual(result.summary.total_calls, 0);
    assert.deepStrictEqual(result.by_tool, []);
    assert.strictEqual(result.summary.success_rate, 'N/A');
  });
});

// ============================================================================
// getToolHistory
// ============================================================================

describe('getToolHistory', () => {
  it('should return tool call history', () => {
    logToolCall(db, 'memory_store', { content: 'a' }, { id: '1' }, true, null, 100, projectId);
    logToolCall(db, 'memory_search', { query: 'b' }, { results: [] }, true, null, 50, projectId);

    const result = getToolHistory(db, undefined, undefined, undefined, 50, projectId);
    assert.strictEqual(result.length, 2);
    assert.ok(result[0].tool);
    assert.ok(result[0].timestamp);
  });

  it('should filter by toolName', () => {
    logToolCall(db, 'memory_store', {}, {}, true, null, 100, projectId);
    logToolCall(db, 'memory_search', {}, {}, true, null, 50, projectId);

    const result = getToolHistory(db, 'memory_store', undefined, undefined, 50, projectId);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].tool, 'memory_store');
  });

  it('should filter by success flag', () => {
    logToolCall(db, 'memory_store', {}, {}, true, null, 100, projectId);
    logToolCall(db, 'memory_store', {}, {}, false, 'err', 50, projectId);

    const failures = getToolHistory(db, undefined, false, undefined, 50, projectId);
    assert.strictEqual(failures.length, 1);
    assert.strictEqual(failures[0].success, false);
  });

  it('should respect limit parameter (capped at 200)', () => {
    for (let i = 0; i < 10; i++) {
      logToolCall(db, 'memory_store', {}, {}, true, null, 10, projectId);
    }

    const result = getToolHistory(db, undefined, undefined, undefined, 5, projectId);
    assert.strictEqual(result.length, 5);
  });

  it('should filter by projectId', () => {
    logToolCall(db, 'memory_store', {}, {}, true, null, 100, 'proj-a');
    logToolCall(db, 'memory_store', {}, {}, true, null, 100, 'proj-b');

    const result = getToolHistory(db, undefined, undefined, undefined, 50, 'proj-a');
    assert.strictEqual(result.length, 1);
  });
});
