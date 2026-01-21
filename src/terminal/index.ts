/**
 * Terminal Module - Public Exports
 * 
 * Provides 5 terminal tools for Just-Command MCP server:
 * - start_process: Launch with timeout enforcement
 * - interact_with_process: Send input, get output
 * - read_process_output: Paginated output reading
 * - list_sessions: Active terminal sessions
 * - force_terminate: Kill process
 */

// Type exports
export * from './types.js';

// Session management exports
export {
  updateTerminalSecurityConfig,
  getTerminalSecurityConfig,
  isCommandAllowed,
  getEffectiveTimeout,
  createSession,
  getSession,
  getAllSessions,
  removeSession,
  cleanupDeadSessions,
  writeToSession,
  killSession,
  getSessionOutput,
  waitForOutput,
} from './sessions.js';

// PTY operations exports
export {
  startProcess,
  interactWithProcess,
  readProcessOutput,
  listSessions,
  forceTerminate,
} from './pty.js';
