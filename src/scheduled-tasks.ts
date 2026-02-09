/**
 * Just-Memory v5.0 — Scheduled Tasks
 * Task scheduling with cron expressions and natural language time parsing.
 * Extracted from monolith — pure functions with db parameter injection.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { safeParse } from './config.js';
import { validateTaskTitle } from './validation.js';

// ============================================================================
// Natural Language Time Patterns
// ============================================================================

const TIME_PATTERNS: { pattern: RegExp; handler: (match: RegExpMatchArray) => Date }[] = [
  // "in X minutes/hours/days"
  {
    pattern: /in\s+(\d+)\s+(minute|minutes|min|mins?|hour|hours|hr|hrs?|day|days?|week|weeks?)/i,
    handler: (match) => {
      const amount = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      const now = new Date();
      if (unit.startsWith('min')) now.setMinutes(now.getMinutes() + amount);
      else if (unit.startsWith('hour') || unit.startsWith('hr')) now.setHours(now.getHours() + amount);
      else if (unit.startsWith('day')) now.setDate(now.getDate() + amount);
      else if (unit.startsWith('week')) now.setDate(now.getDate() + amount * 7);
      return now;
    }
  },
  // "tomorrow at HH:MM" or "tomorrow at H pm/am"
  {
    pattern: /tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    handler: (match) => {
      const now = new Date();
      now.setDate(now.getDate() + 1);
      let hour = parseInt(match[1]);
      const minute = match[2] ? parseInt(match[2]) : 0;
      const ampm = match[3]?.toLowerCase();
      if (ampm === 'pm' && hour !== 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      now.setHours(hour, minute, 0, 0);
      return now;
    }
  },
  // "at HH:MM" or "at H pm/am" (same day or next day if past)
  {
    pattern: /(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    handler: (match) => {
      const now = new Date();
      let hour = parseInt(match[1]);
      const minute = match[2] ? parseInt(match[2]) : 0;
      const ampm = match[3].toLowerCase();
      if (ampm === 'pm' && hour !== 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      now.setHours(hour, minute, 0, 0);
      if (now <= new Date()) now.setDate(now.getDate() + 1);
      return now;
    }
  },
  // "next monday/tuesday/etc"
  {
    pattern: /next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    handler: (match) => {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = days.indexOf(match[1].toLowerCase());
      const now = new Date();
      const currentDay = now.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      now.setDate(now.getDate() + daysUntil);
      now.setHours(9, 0, 0, 0); // Default to 9 AM
      return now;
    }
  },
  // "end of day" / "tonight"
  {
    pattern: /(end of day|tonight|eod)/i,
    handler: () => {
      const now = new Date();
      now.setHours(18, 0, 0, 0);
      if (now <= new Date()) now.setDate(now.getDate() + 1);
      return now;
    }
  },
  // "end of week"
  {
    pattern: /end of week|eow/i,
    handler: () => {
      const now = new Date();
      const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
      now.setDate(now.getDate() + daysUntilFriday);
      now.setHours(17, 0, 0, 0);
      return now;
    }
  }
];

// ============================================================================
// Time Parsing (pure)
// ============================================================================

/**
 * Parse natural language time expression
 */
export function parseNaturalTime(expression: string): Date | null {
  for (const { pattern, handler } of TIME_PATTERNS) {
    const match = expression.match(pattern);
    if (match) {
      return handler(match);
    }
  }

  // Try parsing as ISO date
  const parsed = new Date(expression);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

/**
 * Parse cron expression to get next run time
 * Simplified cron: minute hour day month dayOfWeek
 * Optimized to skip hours/days that can't match
 */
export function getNextCronRun(cronExpr: string, from = new Date()): Date | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteExpr, hourExpr, dayExpr, monthExpr, dowExpr] = parts;

  const parseRange = (expr: string, min: number, max: number): number[] => {
    const [lo, hi] = expr.split('-').map(Number);
    if (isNaN(lo) || isNaN(hi)) return [min];
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(n => n >= min && n <= max);
  };

  const parseField = (expr: string, min: number, max: number): number[] => {
    if (expr === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    if (expr.includes('/')) {
      const [base, step] = expr.split('/');
      const stepNum = parseInt(step);
      if (isNaN(stepNum) || stepNum <= 0) return [min];
      const start = base === '*' ? min : parseInt(base);
      return Array.from({ length: Math.ceil((max - start + 1) / stepNum) }, (_, i) => start + i * stepNum).filter(n => n <= max);
    }
    if (expr.includes(',')) return expr.split(',').flatMap(part => {
      if (part.includes('-')) return parseRange(part, min, max);
      const n = parseInt(part);
      return isNaN(n) ? [] : [n];
    }).filter(n => n >= min && n <= max);
    if (expr.includes('-')) return parseRange(expr, min, max);
    const num = parseInt(expr);
    return isNaN(num) ? [min] : [num];
  };

  const minutes = parseField(minuteExpr, 0, 59);
  const hours = parseField(hourExpr, 0, 23);
  const days = parseField(dayExpr, 1, 31);
  const months = parseField(monthExpr, 1, 12);
  const dows = parseField(dowExpr, 0, 6);

  // Convert arrays to Sets for O(1) lookup instead of O(n) includes()
  const minuteSet = new Set(minutes);
  const hourSet = new Set(hours);
  const daySet = new Set(days);
  const monthSet = new Set(months);
  const dowSet = new Set(dows);

  // Find next matching time with smart skipping
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxIterations = 525600; // 1 year of minutes
  const oneYearLater = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);

  for (let i = 0; i < maxIterations && candidate < oneYearLater; i++) {
    // Check month first (biggest skip potential)
    if (monthExpr !== '*' && !monthSet.has(candidate.getMonth() + 1)) {
      // Skip to next month
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    // Check day of month and day of week
    const dayMatches = dayExpr === '*' || daySet.has(candidate.getDate());
    const dowMatches = dowExpr === '*' || dowSet.has(candidate.getDay());
    if (!dayMatches || !dowMatches) {
      // Skip to next day
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    // Check hour
    if (hourExpr !== '*' && !hourSet.has(candidate.getHours())) {
      // Skip to next hour
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }

    // Check minute
    if (minuteSet.has(candidate.getMinutes())) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

// ============================================================================
// Task CRUD (db-injected)
// ============================================================================

/**
 * Create a scheduled task
 */
export function createScheduledTask(
  db: Database.Database,
  title: string,
  scheduleExpr: string,
  description?: string,
  recurring = false,
  projectId?: string,
  actionType = 'reminder',
  actionData?: any,
  memoryId?: string,
) {
  validateTaskTitle(title);
  const id = `task_${randomUUID().slice(0, 8)}`;

  // Determine if it's a cron expression or natural language
  let nextRun: Date | null = null;
  let cronExpression: string | null = null;

  if (/^\d|\*/.test(scheduleExpr.trim()) && scheduleExpr.split(/\s+/).length === 5) {
    // Looks like a cron expression
    cronExpression = scheduleExpr;
    nextRun = getNextCronRun(scheduleExpr);
  } else {
    // Try natural language
    nextRun = parseNaturalTime(scheduleExpr);
  }

  if (!nextRun) {
    return { error: 'Could not parse schedule expression', scheduleExpr, hint: 'Try "in 30 minutes", "tomorrow at 3pm", or cron format "0 9 * * 1-5"' };
  }

  db.prepare(`
    INSERT INTO scheduled_tasks (id, project_id, title, description, cron_expression, next_run, recurring, action_type, action_data, memory_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, title, description || null, cronExpression, nextRun.toISOString(), recurring ? 1 : 0, actionType, JSON.stringify(actionData || {}), memoryId || null);

  return {
    id,
    title,
    description,
    schedule: cronExpression || scheduleExpr,
    nextRun: nextRun.toISOString(),
    recurring,
    actionType
  };
}

/**
 * List scheduled tasks
 */
export function listScheduledTasks(db: Database.Database, status?: string, projectId?: string, limit = 50) {
  let sql = `SELECT * FROM scheduled_tasks WHERE (project_id = ? OR project_id = 'global')`;
  const params: any[] = [projectId];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY next_run ASC LIMIT ?`;
  params.push(limit);

  const tasks = db.prepare(sql).all(...params) as any[];

  return {
    count: tasks.length,
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      cronExpression: t.cron_expression,
      nextRun: t.next_run,
      lastRun: t.last_run,
      status: t.status,
      recurring: t.recurring === 1,
      actionType: t.action_type,
      memoryId: t.memory_id
    }))
  };
}

/**
 * Check and trigger due tasks
 */
export function checkDueTasks(db: Database.Database, projectId?: string) {
  const now = new Date().toISOString();

  // Find due tasks
  const dueTasks = db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE (project_id = ? OR project_id = 'global')
      AND status = 'pending'
      AND next_run <= ?
  `).all(projectId, now) as any[];

  const triggered: any[] = [];

  for (const task of dueTasks) {
    // Update status
    if (task.recurring && task.cron_expression) {
      // Recurring task - calculate next run
      const nextRun = getNextCronRun(task.cron_expression, new Date());
      db.prepare(`
        UPDATE scheduled_tasks
        SET status = 'pending', last_run = ?, next_run = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(now, nextRun?.toISOString(), task.id);
    } else {
      // One-time task - mark as triggered
      db.prepare(`
        UPDATE scheduled_tasks
        SET status = 'triggered', last_run = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(now, task.id);
    }

    triggered.push({
      id: task.id,
      title: task.title,
      description: task.description,
      actionType: task.action_type,
      actionData: safeParse(task.action_data, {}),
      memoryId: task.memory_id,
      wasRecurring: task.recurring === 1
    });
  }

  return {
    checked_at: now,
    triggered_count: triggered.length,
    triggered
  };
}

/**
 * Complete a triggered task
 */
export function completeScheduledTask(db: Database.Database, taskId: string) {
  const task = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(taskId) as any;
  if (!task) return { error: 'Task not found', taskId };

  if (task.status !== 'triggered') {
    return { error: 'Task is not in triggered state', taskId, currentStatus: task.status };
  }

  db.prepare(`
    UPDATE scheduled_tasks
    SET status = 'completed', updated_at = datetime('now')
    WHERE id = ?
  `).run(taskId);

  return {
    taskId,
    title: task.title,
    status: 'completed',
    completedAt: new Date().toISOString()
  };
}

/**
 * Cancel a scheduled task
 */
export function cancelScheduledTask(db: Database.Database, taskId: string) {
  const task = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(taskId) as any;
  if (!task) return { error: 'Task not found', taskId };

  db.prepare(`
    UPDATE scheduled_tasks
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE id = ?
  `).run(taskId);

  return {
    taskId,
    title: task.title,
    status: 'cancelled',
    cancelledAt: new Date().toISOString()
  };
}
