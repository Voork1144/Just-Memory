/**
 * Just-Memory v5.0 — Tool Logging
 * Tool call logging, stats, and history queries.
 * Extracted from monolith — pure functions with db parameter injection.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { TOOL_LOG_MAX_OUTPUT, safeParse } from './config.js';
import type { ToolCallRow, ToolStatsRow, ToolSummaryRow, ToolStatsResult, ToolHistoryEntry } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

export function truncateForLog(str: string, maxLen: number = TOOL_LOG_MAX_OUTPUT): string {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `... [truncated, ${str.length - maxLen} chars omitted]`;
}

// ============================================================================
// Log a tool call
// ============================================================================

/**
 * Log a tool call to the database.
 * @param sessionUpdater Optional callback to update session state (injected by monolith)
 */
export function logToolCall(
  db: Database.Database,
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args/output are arbitrary JSON from MCP wire
  args: any,
  output: unknown,
  success: boolean,
  error: string | null,
  durationMs: number,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- session updater receives raw args
  sessionUpdater?: (toolName: string, args: any) => void,
): string {
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO tool_calls (id, tool_name, arguments, output, success, error, duration_ms, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      toolName,
      JSON.stringify(args || {}),
      truncateForLog(JSON.stringify(output)),
      success ? 1 : 0,
      error,
      durationMs,
      projectId
    );

    // Update session state for crash recovery
    if (sessionUpdater) sessionUpdater(toolName, args);
  } catch (e) {
    console.error('[Tool Logging] Failed to log tool call:', e);
  }
  return id;
}

// ============================================================================
// Stats
// ============================================================================

export function getToolStats(db: Database.Database, projectId?: string): ToolStatsResult {
  const effectiveProject = projectId ? projectId : null;

  // Get aggregate stats
  const statsQuery = effectiveProject
    ? `SELECT
         tool_name,
         COUNT(*) as total_calls,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
         AVG(duration_ms) as avg_duration_ms,
         MAX(duration_ms) as max_duration_ms,
         MIN(timestamp) as first_call,
         MAX(timestamp) as last_call
       FROM tool_calls
       WHERE project_id = ?
       GROUP BY tool_name
       ORDER BY total_calls DESC`
    : `SELECT
         tool_name,
         COUNT(*) as total_calls,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
         AVG(duration_ms) as avg_duration_ms,
         MAX(duration_ms) as max_duration_ms,
         MIN(timestamp) as first_call,
         MAX(timestamp) as last_call
       FROM tool_calls
       GROUP BY tool_name
       ORDER BY total_calls DESC`;

  const stats = effectiveProject
    ? db.prepare(statsQuery).all(effectiveProject)
    : db.prepare(statsQuery).all();

  // Get overall summary
  const summaryQuery = effectiveProject
    ? `SELECT
         COUNT(*) as total_calls,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
         AVG(duration_ms) as avg_duration_ms
       FROM tool_calls
       WHERE project_id = ?`
    : `SELECT
         COUNT(*) as total_calls,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
         AVG(duration_ms) as avg_duration_ms
       FROM tool_calls`;

  const summary = effectiveProject
    ? db.prepare(summaryQuery).get(effectiveProject) as ToolSummaryRow | undefined
    : db.prepare(summaryQuery).get() as ToolSummaryRow | undefined;

  return {
    summary: {
      total_calls: summary?.total_calls || 0,
      successful: summary?.successful || 0,
      failed: summary?.failed || 0,
      success_rate: summary?.total_calls ? ((summary.successful / summary.total_calls) * 100).toFixed(1) + '%' : 'N/A',
      avg_duration_ms: summary?.avg_duration_ms ? Math.round(summary.avg_duration_ms) : 0
    },
    by_tool: (stats as ToolStatsRow[]).map(s => ({
      tool: s.tool_name,
      calls: s.total_calls,
      successful: s.successful,
      failed: s.failed,
      success_rate: ((s.successful / s.total_calls) * 100).toFixed(1) + '%',
      avg_ms: Math.round(s.avg_duration_ms || 0),
      max_ms: s.max_duration_ms || 0,
      first_call: s.first_call,
      last_call: s.last_call
    })),
    project_id: projectId || 'all'
  };
}

// ============================================================================
// History
// ============================================================================

export function getToolHistory(
  db: Database.Database,
  toolName?: string,
  success?: boolean,
  since?: string,
  limit: number = 50,
  projectId?: string
): ToolHistoryEntry[] {
  let query = 'SELECT * FROM tool_calls WHERE 1=1';
  const params: (string | number)[] = [];

  if (toolName) {
    query += ' AND tool_name = ?';
    params.push(toolName);
  }
  if (typeof success === 'boolean') {
    query += ' AND success = ?';
    params.push(success ? 1 : 0);
  }
  if (since) {
    query += ' AND timestamp >= ?';
    params.push(since);
  }
  if (projectId) {
    query += ' AND project_id = ?';
    params.push(projectId);
  }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(Math.min(limit, 200));

  const rows = db.prepare(query).all(...params) as ToolCallRow[];

  return rows.map(r => ({
    id: r.id,
    tool: r.tool_name,
    args: safeParse(r.arguments, {}),
    output_preview: r.output ? (r.output.length > 200 ? r.output.slice(0, 200) + '...' : r.output) : null,
    success: r.success === 1,
    error: r.error,
    duration_ms: r.duration_ms,
    project_id: r.project_id,
    timestamp: r.timestamp
  }));
}
