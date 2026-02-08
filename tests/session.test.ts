/**
 * Tests for src/session.ts
 * Session state, crash detection, task tracking.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from './helpers/test-db.js';
import {
  updateSessionHeartbeat,
  updateSessionState,
  markSessionStart,
  setCurrentTask,
  updateTaskProgress,
  getCurrentTask,
  clearCurrentTask,
  incrementBriefingSeq,
  clearSessionState,
  detectCrashStateForBriefing,
  SESSION_STATE_KEYS,
  CURRENT_SESSION_ID,
} from '../src/session.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const projectId = 'test-project';

before(() => { db = createTestDb(); });
after(() => { db.close(); });

describe('Session Heartbeat', () => {
  it('should update heartbeat in scratchpad', () => {
    updateSessionHeartbeat(db, projectId);
    const row = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.LAST_HEARTBEAT, projectId) as any;
    assert.ok(row, 'Heartbeat should be stored');
    const parsed = JSON.parse(row.value);
    assert.ok(parsed.session_id, 'Should contain session_id');
    assert.ok(parsed.timestamp, 'Should contain timestamp');
  });
});

describe('Session State', () => {
  it('should track tool calls', () => {
    updateSessionState(db, projectId, 'Edit', { file_path: '/test/file.ts' });
    const lastTool = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.LAST_TOOL, projectId) as any;
    assert.ok(lastTool, 'Last tool should be stored');
    const parsed = JSON.parse(lastTool.value);
    assert.strictEqual(parsed.tool, 'Edit');
  });

  it('should track working files for file-related tools', () => {
    updateSessionState(db, projectId, 'Write', { file_path: '/test/new-file.ts' });
    const files = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.WORKING_FILES, projectId) as any;
    assert.ok(files, 'Working files should be stored');
    const parsed = JSON.parse(files.value);
    assert.ok(parsed.includes('/test/new-file.ts'), 'Should include the written file');
  });

  it('should not track working files for non-file tools', () => {
    // Clear working files first
    db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?')
      .run(SESSION_STATE_KEYS.WORKING_FILES, projectId);
    updateSessionState(db, projectId, 'memory_store', { content: 'test' });
    const files = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.WORKING_FILES, projectId) as any;
    // Should not have created working files entry for memory_store
    assert.ok(!files, 'Should not track working files for non-file tools');
  });
});

describe('Mark Session Start', () => {
  it('should record session start time', () => {
    markSessionStart(db, projectId);
    const row = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.SESSION_START, projectId) as any;
    assert.ok(row, 'Session start should be stored');
    assert.ok(!isNaN(new Date(row.value).getTime()), 'Should be valid ISO timestamp');
  });
});

describe('Task Tracking', () => {
  it('should set a current task', () => {
    setCurrentTask(db, projectId, 'Implementing feature X', 5);
    const task = getCurrentTask(db, projectId);
    assert.ok(task, 'Task should be set');
    assert.strictEqual(task!.description, 'Implementing feature X');
    assert.strictEqual(task!.totalSteps, 5);
    assert.strictEqual(task!.currentStep, 0);
  });

  it('should update task progress', () => {
    setCurrentTask(db, projectId, 'Multi-step task', 3);
    updateTaskProgress(db, projectId, 1, 'Completed step 1');
    updateTaskProgress(db, projectId, 2, 'Completed step 2');

    const task = getCurrentTask(db, projectId);
    assert.ok(task, 'Task should exist');
    assert.strictEqual(task!.currentStep, 2);
    assert.ok(task!.steps.length >= 2, `Expected >= 2 steps, got ${task!.steps.length}`);
    assert.strictEqual(task!.steps[0].description, 'Completed step 1');
  });

  it('should clear current task', () => {
    setCurrentTask(db, projectId, 'Temporary task');
    clearCurrentTask(db, projectId);
    const task = getCurrentTask(db, projectId);
    assert.strictEqual(task, null, 'Task should be cleared');
  });

  it('should return null when no task set', () => {
    clearCurrentTask(db, projectId);
    const task = getCurrentTask(db, projectId);
    assert.strictEqual(task, null);
  });
});

describe('Briefing Sequence', () => {
  it('should increment briefing seq', () => {
    // Clear any existing seq
    db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?')
      .run(SESSION_STATE_KEYS.BRIEFING_SEQ, projectId);
    const seq1 = incrementBriefingSeq(db, projectId);
    assert.strictEqual(seq1, 1);
    const seq2 = incrementBriefingSeq(db, projectId);
    assert.strictEqual(seq2, 2);
    const seq3 = incrementBriefingSeq(db, projectId);
    assert.strictEqual(seq3, 3);
  });
});

describe('Clear Session State', () => {
  it('should clear all session keys', () => {
    // Set some state
    updateSessionHeartbeat(db, projectId);
    markSessionStart(db, projectId);
    setCurrentTask(db, projectId, 'Test task');

    clearSessionState(db, projectId);

    // Verify all keys are cleared
    for (const key of Object.values(SESSION_STATE_KEYS)) {
      const row = db.prepare('SELECT value FROM scratchpad WHERE key = ? AND project_id = ?')
        .get(key, projectId);
      assert.strictEqual(row, undefined, `Key ${key} should be cleared`);
    }
  });
});

describe('detectCrashStateForBriefing', () => {
  it('should return no crash for clean state', () => {
    const result = detectCrashStateForBriefing(db, projectId);
    assert.strictEqual(result.crashed, false, 'Should not detect crash on clean state');
  });

  it('should return no crash when heartbeat is from current session', () => {
    // Write a heartbeat from the current session
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value) VALUES (?, ?, ?)`)
      .run(SESSION_STATE_KEYS.LAST_HEARTBEAT, projectId, JSON.stringify({
        session_id: CURRENT_SESSION_ID,
        timestamp: new Date().toISOString(),
      }));

    const result = detectCrashStateForBriefing(db, projectId);
    assert.strictEqual(result.crashed, false, 'Should not detect crash for current session');
  });

  it('should detect crash from stale heartbeat of different session', () => {
    // Write a heartbeat from a previous session that is stale (>1 minute old)
    const staleTime = new Date(Date.now() - 5 * 60000).toISOString(); // 5 minutes ago
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value) VALUES (?, ?, ?)`)
      .run(SESSION_STATE_KEYS.LAST_HEARTBEAT, projectId, JSON.stringify({
        session_id: 'old_session_id_12345',
        timestamp: staleTime,
      }));

    const result = detectCrashStateForBriefing(db, projectId);
    assert.strictEqual(result.crashed, true, 'Should detect crash from stale different-session heartbeat');
    assert.ok(result.lastHeartbeat, 'Should include last heartbeat time');
  });

  it('should handle corrupted JSON in heartbeat gracefully', () => {
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value) VALUES (?, ?, ?)`)
      .run(SESSION_STATE_KEYS.LAST_HEARTBEAT, projectId, 'not-valid-json{{{');

    // Should not throw
    const result = detectCrashStateForBriefing(db, projectId);
    assert.ok(typeof result.crashed === 'boolean', 'Should return a valid result');
  });
});
