/**
 * Tests for src/scheduled-tasks.ts
 * Natural language time parsing, cron expressions, task CRUD lifecycle.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from './helpers/test-db.js';
import {
  parseNaturalTime,
  getNextCronRun,
  createScheduledTask,
  listScheduledTasks,
  checkDueTasks,
  completeScheduledTask,
  cancelScheduledTask,
} from '../src/scheduled-tasks.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const projectId = 'test-project';

beforeEach(() => {
  db?.close();
  db = createTestDb();
});

after(() => { db?.close(); });

// ============================================================================
// parseNaturalTime
// ============================================================================

describe('parseNaturalTime', () => {
  it('should parse "in X minutes"', () => {
    const before = Date.now();
    const result = parseNaturalTime('in 30 minutes');
    assert.ok(result);
    const diff = result!.getTime() - before;
    // Should be ~30 minutes in the future (allow 5s tolerance)
    assert.ok(diff >= 29 * 60 * 1000 && diff <= 31 * 60 * 1000, `Diff was ${diff}ms`);
  });

  it('should parse "in X hours"', () => {
    const before = Date.now();
    const result = parseNaturalTime('in 2 hours');
    assert.ok(result);
    const diff = result!.getTime() - before;
    assert.ok(diff >= 119 * 60 * 1000 && diff <= 121 * 60 * 1000);
  });

  it('should parse "in X days"', () => {
    const before = Date.now();
    const result = parseNaturalTime('in 3 days');
    assert.ok(result);
    const diff = result!.getTime() - before;
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    assert.ok(diff >= threeDays - 60000 && diff <= threeDays + 60000);
  });

  it('should parse "in X weeks"', () => {
    const result = parseNaturalTime('in 2 weeks');
    assert.ok(result);
    const diff = result!.getTime() - Date.now();
    const twoWeeks = 14 * 24 * 60 * 60 * 1000;
    assert.ok(diff >= twoWeeks - 60000 && diff <= twoWeeks + 60000);
  });

  it('should parse "tomorrow at 3pm"', () => {
    const result = parseNaturalTime('tomorrow at 3pm');
    assert.ok(result);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.strictEqual(result!.getDate(), tomorrow.getDate());
    assert.strictEqual(result!.getHours(), 15);
    assert.strictEqual(result!.getMinutes(), 0);
  });

  it('should parse "tomorrow at 9:30 am"', () => {
    const result = parseNaturalTime('tomorrow at 9:30 am');
    assert.ok(result);
    assert.strictEqual(result!.getHours(), 9);
    assert.strictEqual(result!.getMinutes(), 30);
  });

  it('should parse "end of day" / "eod"', () => {
    const result = parseNaturalTime('eod');
    assert.ok(result);
    assert.strictEqual(result!.getHours(), 18);
    assert.strictEqual(result!.getMinutes(), 0);
  });

  it('should parse "end of week"', () => {
    const result = parseNaturalTime('end of week');
    assert.ok(result);
    // Should be a Friday at 17:00
    assert.strictEqual(result!.getDay(), 5); // Friday
    assert.strictEqual(result!.getHours(), 17);
  });

  it('should parse "next monday"', () => {
    const result = parseNaturalTime('next monday');
    assert.ok(result);
    assert.strictEqual(result!.getDay(), 1); // Monday
    assert.strictEqual(result!.getHours(), 9); // Default 9 AM
    assert.ok(result!.getTime() > Date.now());
  });

  it('should parse ISO date strings', () => {
    const result = parseNaturalTime('2025-12-25T10:00:00Z');
    assert.ok(result);
    assert.strictEqual(result!.getUTCMonth(), 11); // December
    assert.strictEqual(result!.getUTCDate(), 25);
  });

  it('should return null for unparseable input', () => {
    const result = parseNaturalTime('gibberish nonsense');
    assert.strictEqual(result, null);
  });
});

// ============================================================================
// getNextCronRun
// ============================================================================

describe('getNextCronRun', () => {
  it('should find next minute for "* * * * *"', () => {
    const from = new Date();
    from.setMinutes(30, 0, 0);
    const result = getNextCronRun('* * * * *', from);
    assert.ok(result);
    assert.strictEqual(result!.getMinutes(), 31);
  });

  it('should find next run for "0 9 * * *" (daily at 9am)', () => {
    // Use local time since cron parser operates in local time
    const from = new Date();
    from.setHours(10, 30, 0, 0);
    const result = getNextCronRun('0 9 * * *', from);
    assert.ok(result);
    assert.strictEqual(result!.getHours(), 9);
    assert.strictEqual(result!.getMinutes(), 0);
    // Should be next day since 10:30 > 9:00
    assert.strictEqual(result!.getDate(), from.getDate() + 1);
  });

  it('should handle step expressions "*/15 * * * *"', () => {
    const from = new Date();
    from.setHours(10, 1, 0, 0);
    const result = getNextCronRun('*/15 * * * *', from);
    assert.ok(result);
    assert.strictEqual(result!.getMinutes(), 15);
  });

  it('should handle day-of-week "0 9 * * 1-5" (weekdays at 9am)', () => {
    // Find the next Saturday from today
    const from = new Date();
    // Set to a Saturday: advance to Saturday if not already
    while (from.getDay() !== 6) from.setDate(from.getDate() + 1);
    from.setHours(10, 0, 0, 0);

    const result = getNextCronRun('0 9 * * 1-5', from);
    assert.ok(result);
    assert.strictEqual(result!.getDay(), 1); // Monday
    assert.strictEqual(result!.getHours(), 9);
  });

  it('should handle comma-separated values "0 9,17 * * *"', () => {
    const from = new Date();
    from.setHours(10, 0, 0, 0);
    const result = getNextCronRun('0 9,17 * * *', from);
    assert.ok(result);
    assert.strictEqual(result!.getHours(), 17);
    assert.strictEqual(result!.getMinutes(), 0);
  });

  it('should return null for invalid cron expression', () => {
    assert.strictEqual(getNextCronRun('invalid', new Date()), null);
    assert.strictEqual(getNextCronRun('* *', new Date()), null); // too few fields
  });

  it('should handle Feb 29 cron within leap year (v4.3.2)', () => {
    // Start just before a leap year Feb 29 — within the 366-day search bound
    const from = new Date(2027, 11, 1, 0, 0, 0, 0); // Dec 1, 2027 (2028 is leap)
    const result = getNextCronRun('0 0 29 2 *', from);
    assert.ok(result, 'Should find Feb 29 within 366-day bound');
    assert.strictEqual(result!.getMonth(), 1); // February (0-indexed)
    assert.strictEqual(result!.getDate(), 29);
    assert.strictEqual(result!.getFullYear(), 2028);
  });
});

// ============================================================================
// Task CRUD Lifecycle
// ============================================================================

describe('createScheduledTask', () => {
  it('should create a task with natural language schedule', () => {
    const result = createScheduledTask(db, 'Test Task', 'in 30 minutes', 'A description', false, projectId);
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.ok(result.id);
    assert.strictEqual(result.title, 'Test Task');
    assert.strictEqual(result.recurring, false);
    assert.ok(result.nextRun);
  });

  it('should create a recurring task with cron expression', () => {
    const result = createScheduledTask(db, 'Daily Check', '0 9 * * *', 'Every morning', true, projectId);
    assert.ok(!result.error);
    assert.strictEqual(result.recurring, true);
    assert.strictEqual(result.schedule, '0 9 * * *');
  });

  it('should return error for unparseable schedule', () => {
    const result = createScheduledTask(db, 'Bad Task', 'gibberish nonsense xyz', undefined, false, projectId);
    assert.ok(result.error);
    assert.match(result.error, /Could not parse/i);
  });
});

describe('listScheduledTasks', () => {
  it('should list tasks for a project', () => {
    createScheduledTask(db, 'Task A', 'in 1 hour', undefined, false, projectId);
    createScheduledTask(db, 'Task B', 'in 2 hours', undefined, false, projectId);

    const result = listScheduledTasks(db, undefined, projectId);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.tasks.length, 2);
  });

  it('should filter by status', () => {
    createScheduledTask(db, 'Pending Task', 'in 1 hour', undefined, false, projectId);

    const pending = listScheduledTasks(db, 'pending', projectId);
    assert.strictEqual(pending.count, 1);

    const completed = listScheduledTasks(db, 'completed', projectId);
    assert.strictEqual(completed.count, 0);
  });
});

describe('checkDueTasks', () => {
  it('should trigger tasks whose next_run is past', () => {
    // Insert a task directly with past next_run
    db.prepare(`
      INSERT INTO scheduled_tasks (id, project_id, title, next_run, status, recurring, action_type, action_data)
      VALUES (?, ?, ?, ?, 'pending', 0, 'reminder', '{}')
    `).run('due1', projectId, 'Due Task', new Date(Date.now() - 60000).toISOString());

    const result = checkDueTasks(db, projectId);
    assert.strictEqual(result.triggered_count, 1);
    assert.strictEqual(result.triggered[0].id, 'due1');

    // Task should now be 'triggered'
    const task = db.prepare('SELECT status FROM scheduled_tasks WHERE id = ?').get('due1') as any;
    assert.strictEqual(task.status, 'triggered');
  });

  it('should not trigger future tasks', () => {
    db.prepare(`
      INSERT INTO scheduled_tasks (id, project_id, title, next_run, status, recurring, action_type, action_data)
      VALUES (?, ?, ?, ?, 'pending', 0, 'reminder', '{}')
    `).run('future1', projectId, 'Future Task', new Date(Date.now() + 3600000).toISOString());

    const result = checkDueTasks(db, projectId);
    assert.strictEqual(result.triggered_count, 0);
  });

  it('should reschedule recurring tasks with cron expression', () => {
    db.prepare(`
      INSERT INTO scheduled_tasks (id, project_id, title, cron_expression, next_run, status, recurring, action_type, action_data)
      VALUES (?, ?, ?, ?, ?, 'pending', 1, 'reminder', '{}')
    `).run('recur1', projectId, 'Recurring', '0 9 * * *', new Date(Date.now() - 60000).toISOString());

    const result = checkDueTasks(db, projectId);
    assert.strictEqual(result.triggered_count, 1);

    // Task should still be 'pending' (rescheduled) with a new next_run
    const task = db.prepare('SELECT status, next_run FROM scheduled_tasks WHERE id = ?').get('recur1') as any;
    assert.strictEqual(task.status, 'pending');
    assert.ok(new Date(task.next_run).getTime() > Date.now(), 'Next run should be in the future');
  });
});

describe('completeScheduledTask', () => {
  it('should complete a triggered task', () => {
    db.prepare(`
      INSERT INTO scheduled_tasks (id, project_id, title, next_run, status, recurring, action_type, action_data)
      VALUES (?, ?, ?, ?, 'triggered', 0, 'reminder', '{}')
    `).run('comp1', projectId, 'To Complete', new Date().toISOString());

    const result = completeScheduledTask(db, 'comp1');
    assert.ok(!result.error);
    assert.strictEqual(result.status, 'completed');
  });

  it('should error when task is not triggered', () => {
    db.prepare(`
      INSERT INTO scheduled_tasks (id, project_id, title, next_run, status, recurring, action_type, action_data)
      VALUES (?, ?, ?, ?, 'pending', 0, 'reminder', '{}')
    `).run('pend1', projectId, 'Pending', new Date().toISOString());

    const result = completeScheduledTask(db, 'pend1');
    assert.ok(result.error);
    assert.match(result.error, /not in triggered state/i);
  });

  it('should error for nonexistent task', () => {
    const result = completeScheduledTask(db, 'nonexistent');
    assert.ok(result.error);
    assert.match(result.error, /not found/i);
  });
});

describe('cancelScheduledTask', () => {
  it('should cancel a task', () => {
    db.prepare(`
      INSERT INTO scheduled_tasks (id, project_id, title, next_run, status, recurring, action_type, action_data)
      VALUES (?, ?, ?, ?, 'pending', 0, 'reminder', '{}')
    `).run('cancel1', projectId, 'To Cancel', new Date().toISOString());

    const result = cancelScheduledTask(db, 'cancel1');
    assert.ok(!result.error);
    assert.strictEqual(result.status, 'cancelled');

    const task = db.prepare('SELECT status FROM scheduled_tasks WHERE id = ?').get('cancel1') as any;
    assert.strictEqual(task.status, 'cancelled');
  });

  it('should error for nonexistent task', () => {
    const result = cancelScheduledTask(db, 'nonexistent');
    assert.ok(result.error);
    assert.match(result.error, /not found/i);
  });
});
