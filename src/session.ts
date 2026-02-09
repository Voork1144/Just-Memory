/**
 * Just-Memory — Session & Crash Recovery
 * Tracks session state for recovery after crashes, compaction, or session loss.
 */
import Database from 'better-sqlite3';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { BACKUP_DIR } from './config.js';
import type { CrashState } from './types.js';

export const SESSION_STATE_KEYS = {
  LAST_HEARTBEAT: '_jm_last_heartbeat',
  CURRENT_TASK: '_jm_current_task',
  TASK_STEPS: '_jm_task_steps',
  WORKING_FILES: '_jm_working_files',
  LAST_TOOL: '_jm_last_tool',
  SESSION_START: '_jm_session_start',
  BRIEFING_SESSION_ID: '_jm_briefing_session_id',
  BRIEFING_SEQ: '_jm_briefing_seq',
};

export const CURRENT_SESSION_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

let crashAlreadyReported = false;

export function updateSessionHeartbeat(db: Database.Database, projectId: string): void {
  try {
    const heartbeatData = JSON.stringify({
      session_id: CURRENT_SESSION_ID,
      timestamp: new Date().toISOString()
    });
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
      .run(SESSION_STATE_KEYS.LAST_HEARTBEAT, projectId, heartbeatData);
  } catch (e) { console.error('[Just-Memory] session state write error:', e); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP args are untyped JSON
export function updateSessionState(db: Database.Database, projectId: string, toolName: string, args: any): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
      .run(SESSION_STATE_KEYS.LAST_TOOL, projectId, JSON.stringify({ tool: toolName, timestamp: new Date().toISOString() }));

    if (['Edit', 'Write', 'Read'].includes(toolName) && args?.file_path) {
      const existingFiles = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
        .get(SESSION_STATE_KEYS.WORKING_FILES, projectId) as { value: string } | undefined;

      let files: string[] = [];
      try { files = existingFiles ? JSON.parse(existingFiles.value) : []; } catch { files = []; }

      if (!files.includes(args.file_path)) {
        files.unshift(args.file_path);
        files = files.slice(0, 10);
      }

      db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
        .run(SESSION_STATE_KEYS.WORKING_FILES, projectId, JSON.stringify(files));
    }

    updateSessionHeartbeat(db, projectId);
  } catch (e) { console.error('[Just-Memory] session state write error:', e); }
}

export function detectCrashStateForBriefing(db: Database.Database, projectId: string): CrashState {
  try {
    if (crashAlreadyReported) return { crashed: false };

    const storedSessionId = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.BRIEFING_SESSION_ID, projectId) as { value: string } | undefined;

    const heartbeatRaw = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.LAST_HEARTBEAT, projectId) as { value: string } | undefined;

    const lastTool = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.LAST_TOOL, projectId) as { value: string } | undefined;

    const workingFiles = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.WORKING_FILES, projectId) as { value: string } | undefined;

    const sessionStart = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.SESSION_START, projectId) as { value: string } | undefined;

    if (!heartbeatRaw && !storedSessionId) return { crashed: false };
    if (storedSessionId?.value === CURRENT_SESSION_ID) return { crashed: false };

    let heartbeatSessionId: string | undefined;
    let heartbeatTimestamp: string | undefined;

    if (heartbeatRaw?.value) {
      try {
        const parsed = JSON.parse(heartbeatRaw.value);
        if (parsed.session_id && parsed.timestamp) {
          heartbeatSessionId = parsed.session_id;
          heartbeatTimestamp = parsed.timestamp;
        } else {
          heartbeatTimestamp = heartbeatRaw.value;
        }
      } catch {
        heartbeatTimestamp = heartbeatRaw.value;
      }
    }

    if (heartbeatSessionId === CURRENT_SESSION_ID) return { crashed: false };

    if (heartbeatSessionId && heartbeatSessionId !== storedSessionId?.value && heartbeatSessionId !== CURRENT_SESSION_ID) {
      const heartbeatTime = heartbeatTimestamp ? new Date(heartbeatTimestamp).getTime() : 0;
      const minutesSinceHeartbeat = (Date.now() - heartbeatTime) / 60000;
      if (minutesSinceHeartbeat < 1) return { crashed: false };
    }

    const lastHeartbeatTime = heartbeatTimestamp ? new Date(heartbeatTimestamp).getTime() : 0;
    const minutesSinceHeartbeat = heartbeatTimestamp ? (Date.now() - lastHeartbeatTime) / 60000 : 999;
    const hasRecoveryData = minutesSinceHeartbeat > 1 && minutesSinceHeartbeat < (7 * 24 * 60);

    if (hasRecoveryData) {
      return {
        crashed: true,
        lastHeartbeat: heartbeatTimestamp,
        lastTool: lastTool ? JSON.parse(lastTool.value) : undefined,
        workingFiles: workingFiles ? JSON.parse(workingFiles.value) : undefined,
        sessionStart: sessionStart?.value,
        previousSessionId: heartbeatSessionId || storedSessionId?.value,
      };
    }

    return { crashed: false };
  } catch (e) {
    console.error('[Just-Memory] Crash detection error:', e);
    return { crashed: false };
  }
}

export function markCrashReported(): void {
  crashAlreadyReported = true;
}

export function updateStoredSessionId(db: Database.Database, projectId: string): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
      .run(SESSION_STATE_KEYS.BRIEFING_SESSION_ID, projectId, CURRENT_SESSION_ID);
  } catch (e) { console.error('[Just-Memory] session state write error:', e); }
}

export function clearSessionState(db: Database.Database, projectId: string): void {
  try {
    for (const key of Object.values(SESSION_STATE_KEYS)) {
      db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?').run(key, projectId);
    }
  } catch (e) { console.error('[Just-Memory] session state write error:', e); }
}

export function markSessionStart(db: Database.Database, projectId: string): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
      .run(SESSION_STATE_KEYS.SESSION_START, projectId, new Date().toISOString());
  } catch (e) { console.error('[Just-Memory] session state write error:', e); }
}

export function setCurrentTask(db: Database.Database, projectId: string, description: string, totalSteps?: number): void {
  try {
    const taskData = JSON.stringify({
      description,
      totalSteps: totalSteps || null,
      currentStep: 0,
      startedAt: new Date().toISOString(),
      session_id: CURRENT_SESSION_ID,
    });
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
      .run(SESSION_STATE_KEYS.CURRENT_TASK, projectId, taskData);
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
      .run(SESSION_STATE_KEYS.TASK_STEPS, projectId, JSON.stringify([]));
  } catch (e) { console.error('[Just-Memory] session state write error:', e); }
}

export function updateTaskProgress(db: Database.Database, projectId: string, stepNumber: number, stepDescription: string): void {
  try {
    const taskRaw = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.CURRENT_TASK, projectId) as { value: string } | undefined;

    if (taskRaw?.value) {
      const task = JSON.parse(taskRaw.value);
      task.currentStep = stepNumber;
      task.lastUpdated = new Date().toISOString();
      db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
        .run(SESSION_STATE_KEYS.CURRENT_TASK, projectId, JSON.stringify(task));
    }

    const stepsRaw = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.TASK_STEPS, projectId) as { value: string } | undefined;

    let steps: Array<{step: number, description: string, timestamp: string}> = [];
    if (stepsRaw?.value) {
      try { steps = JSON.parse(stepsRaw.value); } catch { steps = []; }
    }

    steps.push({ step: stepNumber, description: stepDescription.slice(0, 2000), timestamp: new Date().toISOString() });
    if (steps.length > 20) steps = steps.slice(-20);

    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
      .run(SESSION_STATE_KEYS.TASK_STEPS, projectId, JSON.stringify(steps));
  } catch (e) { console.error('[Just-Memory] session state write error:', e); }
}

export function clearCurrentTask(db: Database.Database, projectId: string): void {
  try {
    db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?').run(SESSION_STATE_KEYS.CURRENT_TASK, projectId);
    db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?').run(SESSION_STATE_KEYS.TASK_STEPS, projectId);
  } catch (e) { console.error('[Just-Memory] session state write error:', e); }
}

export function getCurrentTask(db: Database.Database, projectId: string): {
  description: string; totalSteps: number | null; currentStep: number;
  startedAt: string; lastUpdated?: string;
  steps: Array<{step: number, description: string, timestamp: string}>;
} | null {
  try {
    const taskRaw = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.CURRENT_TASK, projectId) as { value: string } | undefined;
    if (!taskRaw?.value) return null;

    const task = JSON.parse(taskRaw.value);
    const stepsRaw = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.TASK_STEPS, projectId) as { value: string } | undefined;

    let steps: Array<{step: number, description: string, timestamp: string}> = [];
    if (stepsRaw?.value) {
      try { steps = JSON.parse(stepsRaw.value); } catch { steps = []; }
    }

    return {
      description: task.description,
      totalSteps: task.totalSteps,
      currentStep: task.currentStep,
      startedAt: task.startedAt,
      lastUpdated: task.lastUpdated,
      steps,
    };
  } catch {
    return null;
  }
}

export function incrementBriefingSeq(db: Database.Database, projectId: string): number {
  try {
    const seqRaw = db.prepare(`SELECT value FROM scratchpad WHERE key = ? AND project_id = ?`)
      .get(SESSION_STATE_KEYS.BRIEFING_SEQ, projectId) as { value: string } | undefined;

    let seq = 1;
    if (seqRaw?.value) {
      try { seq = parseInt(seqRaw.value, 10) + 1; } catch { seq = 1; }
    }

    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, NULL)`)
      .run(SESSION_STATE_KEYS.BRIEFING_SEQ, projectId, String(seq));
    return seq;
  } catch {
    return 0;
  }
}

export function needsAutoBackup(): boolean {
  try {
    if (!existsSync(BACKUP_DIR)) return true;
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json') && f.startsWith('backup_'))
      .map(f => statSync(join(BACKUP_DIR, f)).mtime.getTime())
      .sort((a, b) => b - a);
    if (files.length === 0) return true;
    return (Date.now() - files[0]) / 3600000 > 24;
  } catch {
    return false;
  }
}
