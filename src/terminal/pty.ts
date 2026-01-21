/**
 * Terminal PTY Operations
 * 
 * Implements the 5 terminal tools:
 * - start_process: Launch with timeout enforcement
 * - interact_with_process: Send input, get output
 * - read_process_output: Paginated output reading
 * - list_sessions: Active terminal sessions
 * - force_terminate: Kill process
 */

import * as path from 'path';
import {
  StartProcessOptions,
  StartProcessResult,
  InteractProcessOptions,
  InteractProcessResult,
  ReadOutputOptions,
  ReadOutputResult,
  ListSessionsResult,
  ForceTerminateOptions,
  ForceTerminateResult,
} from './types.js';
import {
  createSession,
  getSession,
  getAllSessions,
  killSession,
  writeToSession,
  getSessionOutput,
  waitForOutput,
  getEffectiveTimeout,
  getTerminalSecurityConfig,
} from './sessions.js';
import { sanitizeForJson } from '../utils/sanitize.js';

// ============================================================================
// start_process Implementation
// ============================================================================

/**
 * Start a new process with timeout enforcement
 */
export async function startProcess(
  options: StartProcessOptions
): Promise<StartProcessResult> {
  const {
    command,
    args = [],
    cwd = process.cwd(),
    timeout,
  } = options;
  
  // Create session
  const session = createSession(command, args, cwd);
  
  // Wait for initial output with timeout
  const effectiveTimeout = getEffectiveTimeout(timeout);
  const initialOutput = await waitForOutput(
    session.pid,
    Math.min(effectiveTimeout, 1000), // Max 1s for initial output
    // Stop waiting if we see a prompt or significant output
    (output) => output.length > 100 || /[$#>]\s*$/.test(output)
  );
  
  return {
    success: true,
    process: {
      pid: session.pid,
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      startedAt: session.startedAt.toISOString(),
      status: session.status,
      exitCode: session.exitCode,
    },
    initialOutput: sanitizeForJson(initialOutput),
  };
}

// ============================================================================
// interact_with_process Implementation
// ============================================================================

/**
 * Send input to a process and get output
 */
export async function interactWithProcess(
  options: InteractProcessOptions
): Promise<InteractProcessResult> {
  const {
    pid,
    input,
    timeout,
    waitForPrompt = true,
  } = options;
  
  const session = getSession(pid);
  if (!session) {
    throw new Error(`PROCESS_NOT_FOUND: No session with PID ${pid}`);
  }
  
  if (session.status !== 'running') {
    throw new Error(
      `PROCESS_ALREADY_EXITED: Process ${pid} has ${session.status}` +
      (session.exitCode !== undefined ? ` with code ${session.exitCode}` : '')
    );
  }
  
  // Write input
  writeToSession(pid, input);
  
  // Wait for output
  const effectiveTimeout = getEffectiveTimeout(timeout);
  
  let output: string;
  let timedOut = false;
  
  try {
    if (waitForPrompt) {
      // Wait for prompt or timeout
      output = await waitForOutput(
        pid,
        effectiveTimeout,
        (out) => /[$#>]\s*$/.test(out) || out.includes('\n')
      );
    } else {
      // Just wait for any output
      output = await waitForOutput(pid, effectiveTimeout);
    }
  } catch (error) {
    timedOut = true;
    output = session.outputBuffer.slice(-100).join('\n');
  }
  
  // Get current session state
  const currentSession = getSession(pid);
  
  return {
    success: !timedOut,
    pid,
    output: sanitizeForJson(output),
    exitCode: currentSession?.exitCode,
    timedOut,
  };
}

// ============================================================================
// read_process_output Implementation
// ============================================================================

/**
 * Read process output with pagination
 */
export async function readProcessOutput(
  options: ReadOutputOptions
): Promise<ReadOutputResult> {
  const {
    pid,
    offset = 0,
    length,
    timeout = 0,
  } = options;
  
  const session = getSession(pid);
  if (!session) {
    throw new Error(`PROCESS_NOT_FOUND: No session with PID ${pid}`);
  }
  
  // Wait for new output if requested
  if (timeout > 0 && session.status === 'running') {
    await waitForOutput(pid, getEffectiveTimeout(timeout));
  }
  
  // Get output with pagination
  const config = getTerminalSecurityConfig();
  const maxLength = length ?? config.maxOutputLines;
  const { lines, totalLines } = getSessionOutput(pid, offset, maxLength);
  
  return {
    pid,
    output: sanitizeForJson(lines.join('\n')),
    lineCount: lines.length,
    totalLines,
    offset,
    truncated: offset + lines.length < totalLines,
    status: session.status,
    exitCode: session.exitCode,
  };
}

// ============================================================================
// list_sessions Implementation
// ============================================================================

/**
 * List all active terminal sessions
 */
export async function listSessions(): Promise<ListSessionsResult> {
  const sessions = getAllSessions();
  
  const sessionList = sessions.map((session) => {
    const runtime = Date.now() - session.startedAt.getTime();
    const minutes = Math.floor(runtime / 60000);
    const seconds = Math.floor((runtime % 60000) / 1000);
    
    return {
      pid: session.pid,
      command: session.command,
      cwd: session.cwd,
      startedAt: session.startedAt.toISOString(),
      status: session.status,
      runtime: `${minutes}m ${seconds}s`,
      outputLines: session.outputBuffer.length,
    };
  });
  
  return {
    sessions: sessionList,
    totalCount: sessionList.length,
  };
}

// ============================================================================
// force_terminate Implementation
// ============================================================================

/**
 * Force terminate a process
 */
export async function forceTerminate(
  options: ForceTerminateOptions
): Promise<ForceTerminateResult> {
  const { pid, signal = 'SIGTERM' } = options;
  
  const session = getSession(pid);
  if (!session) {
    throw new Error(`PROCESS_NOT_FOUND: No session with PID ${pid}`);
  }
  
  const wasRunning = session.status === 'running';
  
  if (wasRunning) {
    killSession(pid, signal);
  }
  
  return {
    success: true,
    pid,
    signal,
    wasRunning,
  };
}
