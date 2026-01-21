/**
 * Terminal Session Manager
 * 
 * Manages PTY sessions with output buffering and timeout enforcement.
 * Implements D16: Claude Desktop 5000ms timeout cap.
 */

import { spawn, ChildProcess } from 'child_process';
import { 
  TerminalSession,
  TerminalSecurityConfig,
  DEFAULT_TERMINAL_SECURITY,
} from './types.js';
import { isClaudeDesktopMode } from '../utils/index.js';

// ============================================================================
// Session Storage
// ============================================================================

const sessions: Map<number, TerminalSession & { process: ChildProcess }> = new Map();
let securityConfig: TerminalSecurityConfig = { ...DEFAULT_TERMINAL_SECURITY };

// Maximum concurrent sessions
const MAX_SESSIONS = 10;

// ============================================================================
// Security Configuration
// ============================================================================

export function updateTerminalSecurityConfig(config: Partial<TerminalSecurityConfig>): void {
  securityConfig = { ...securityConfig, ...config };
}

export function getTerminalSecurityConfig(): TerminalSecurityConfig {
  return { ...securityConfig };
}

/**
 * Check if a command is allowed
 */
export function isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
  const normalizedCmd = command.toLowerCase().trim();
  
  // Check blocked commands
  for (const blocked of securityConfig.blockedCommands) {
    if (normalizedCmd.includes(blocked.toLowerCase())) {
      return { allowed: false, reason: `Command contains blocked pattern: ${blocked}` };
    }
  }
  
  // Check blocked patterns
  for (const pattern of securityConfig.blockedPatterns) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `Command matches blocked pattern` };
    }
  }
  
  // Check allowed commands (whitelist mode)
  if (securityConfig.allowedCommands && securityConfig.allowedCommands.length > 0) {
    const baseCmd = normalizedCmd.split(/\s+/)[0];
    if (!securityConfig.allowedCommands.includes(baseCmd)) {
      return { allowed: false, reason: `Command not in allowed list: ${baseCmd}` };
    }
  }
  
  return { allowed: true };
}

/**
 * Get effective timeout (respects Claude Desktop mode cap)
 */
export function getEffectiveTimeout(requested?: number): number {
  const maxAllowed = isClaudeDesktopMode() 
    ? securityConfig.defaultTimeout  // 5000ms in Desktop mode
    : securityConfig.maxTimeout;     // 30000ms otherwise
  
  const timeout = requested ?? securityConfig.defaultTimeout;
  return Math.min(timeout, maxAllowed);
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new terminal session
 */
export function createSession(
  command: string,
  args: string[] = [],
  cwd: string = process.cwd()
): TerminalSession & { process: ChildProcess } {
  // Check session limit
  if (sessions.size >= MAX_SESSIONS) {
    // Clean up dead sessions first
    cleanupDeadSessions();
    
    if (sessions.size >= MAX_SESSIONS) {
      throw new Error(`MAX_SESSIONS_REACHED: Cannot create more than ${MAX_SESSIONS} sessions`);
    }
  }
  
  // Check command is allowed
  const fullCommand = [command, ...args].join(' ');
  const { allowed, reason } = isCommandAllowed(fullCommand);
  if (!allowed) {
    throw new Error(`COMMAND_BLOCKED: ${reason}`);
  }
  
  // Spawn process
  const proc = spawn(command, args, {
    cwd,
    shell: securityConfig.defaultShell,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  
  if (!proc.pid) {
    throw new Error('SPAWN_FAILED: Failed to spawn process');
  }
  
  const session: TerminalSession & { process: ChildProcess } = {
    pid: proc.pid,
    command,
    args,
    cwd,
    startedAt: new Date(),
    status: 'running',
    outputBuffer: [],
    maxOutputLines: securityConfig.maxOutputLines,
    process: proc,
  };
  
  // Capture stdout
  proc.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.length > 0) {
        session.outputBuffer.push(line);
        // Trim buffer if too large
        if (session.outputBuffer.length > session.maxOutputLines) {
          session.outputBuffer.shift();
        }
      }
    }
  });
  
  // Capture stderr (merge with stdout)
  proc.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.length > 0) {
        session.outputBuffer.push(`[stderr] ${line}`);
        if (session.outputBuffer.length > session.maxOutputLines) {
          session.outputBuffer.shift();
        }
      }
    }
  });
  
  // Handle exit
  proc.on('exit', (code, signal) => {
    session.status = signal ? 'killed' : 'exited';
    session.exitCode = code ?? undefined;
  });
  
  // Handle error
  proc.on('error', (err) => {
    session.status = 'error';
    session.outputBuffer.push(`[error] ${err.message}`);
  });
  
  sessions.set(proc.pid, session);
  return session;
}

/**
 * Get a session by PID
 */
export function getSession(pid: number): (TerminalSession & { process: ChildProcess }) | null {
  return sessions.get(pid) ?? null;
}

/**
 * Get all sessions
 */
export function getAllSessions(): TerminalSession[] {
  return Array.from(sessions.values()).map(({ process, ...session }) => session);
}

/**
 * Remove a session
 */
export function removeSession(pid: number): boolean {
  return sessions.delete(pid);
}

/**
 * Clean up dead sessions
 */
export function cleanupDeadSessions(): number {
  let removed = 0;
  for (const [pid, session] of sessions) {
    if (session.status !== 'running') {
      sessions.delete(pid);
      removed++;
    }
  }
  return removed;
}

/**
 * Write input to a session
 */
export function writeToSession(pid: number, input: string): boolean {
  const session = sessions.get(pid);
  if (!session) {
    throw new Error(`PROCESS_NOT_FOUND: No session with PID ${pid}`);
  }
  
  if (session.status !== 'running') {
    throw new Error(`PROCESS_ALREADY_EXITED: Process ${pid} has ${session.status}`);
  }
  
  const written = session.process.stdin?.write(input + '\n');
  return written ?? false;
}

/**
 * Kill a session
 */
export function killSession(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): boolean {
  const session = sessions.get(pid);
  if (!session) {
    throw new Error(`PROCESS_NOT_FOUND: No session with PID ${pid}`);
  }
  
  const wasRunning = session.status === 'running';
  
  if (wasRunning) {
    session.process.kill(signal);
    session.status = 'killed';
  }
  
  return wasRunning;
}

/**
 * Get session output
 */
export function getSessionOutput(
  pid: number,
  offset: number = 0,
  length?: number
): { lines: string[]; totalLines: number } {
  const session = sessions.get(pid);
  if (!session) {
    throw new Error(`PROCESS_NOT_FOUND: No session with PID ${pid}`);
  }
  
  const totalLines = session.outputBuffer.length;
  const maxLength = length ?? securityConfig.maxOutputLines;
  
  const startIndex = Math.max(0, offset);
  const endIndex = Math.min(startIndex + maxLength, totalLines);
  
  return {
    lines: session.outputBuffer.slice(startIndex, endIndex),
    totalLines,
  };
}

/**
 * Wait for output with timeout
 */
export function waitForOutput(
  pid: number,
  timeout: number,
  predicate?: (output: string) => boolean
): Promise<string> {
  return new Promise((resolve, reject) => {
    const session = sessions.get(pid);
    if (!session) {
      reject(new Error(`PROCESS_NOT_FOUND: No session with PID ${pid}`));
      return;
    }
    
    const effectiveTimeout = getEffectiveTimeout(timeout);
    const startTime = Date.now();
    const initialLines = session.outputBuffer.length;
    
    const checkOutput = () => {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= effectiveTimeout) {
        // Timeout - return what we have
        const newLines = session.outputBuffer.slice(initialLines);
        resolve(newLines.join('\n') || '[No output within timeout]');
        return;
      }
      
      if (session.status !== 'running') {
        // Process ended - return remaining output
        const newLines = session.outputBuffer.slice(initialLines);
        resolve(newLines.join('\n'));
        return;
      }
      
      // Check predicate if provided
      if (predicate) {
        const newOutput = session.outputBuffer.slice(initialLines).join('\n');
        if (predicate(newOutput)) {
          resolve(newOutput);
          return;
        }
      }
      
      // Keep checking
      setTimeout(checkOutput, 50);
    };
    
    checkOutput();
  });
}
