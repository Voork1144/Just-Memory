/**
 * Terminal Module Types
 * 
 * Type definitions for terminal/process operations in Just-Command MCP server.
 */

// ============================================================================
// Process Management
// ============================================================================

export interface StartProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;      // Max timeout in ms (capped by Claude Desktop mode)
  shell?: boolean | string;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
  status: 'running' | 'exited' | 'killed' | 'error';
  exitCode?: number;
}

export interface StartProcessResult {
  success: boolean;
  process: ProcessInfo;
  initialOutput?: string;
}

// ============================================================================
// Process Interaction
// ============================================================================

export interface InteractProcessOptions {
  pid: number;
  input: string;
  timeout?: number;
  waitForPrompt?: boolean;
}

export interface InteractProcessResult {
  success: boolean;
  pid: number;
  output: string;
  exitCode?: number;
  timedOut: boolean;
}

// ============================================================================
// Output Reading
// ============================================================================

export interface ReadOutputOptions {
  pid: number;
  offset?: number;      // Line offset
  length?: number;      // Number of lines
  timeout?: number;     // Wait timeout for new output
}

export interface ReadOutputResult {
  pid: number;
  output: string;
  lineCount: number;
  totalLines: number;
  offset: number;
  truncated: boolean;
  status: 'running' | 'exited' | 'killed' | 'error';
  exitCode?: number;
}

// ============================================================================
// Session Management
// ============================================================================

export interface TerminalSession {
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  startedAt: Date;
  status: 'running' | 'exited' | 'killed' | 'error';
  exitCode?: number;
  outputBuffer: string[];
  maxOutputLines: number;
}

export interface ListSessionsResult {
  sessions: Array<{
    pid: number;
    command: string;
    cwd: string;
    startedAt: string;
    status: string;
    runtime: string;
    outputLines: number;
  }>;
  totalCount: number;
}

export interface ForceTerminateOptions {
  pid: number;
  signal?: 'SIGTERM' | 'SIGKILL';
}

export interface ForceTerminateResult {
  success: boolean;
  pid: number;
  signal: string;
  wasRunning: boolean;
}

// ============================================================================
// Security Configuration
// ============================================================================

export interface TerminalSecurityConfig {
  blockedCommands: string[];
  blockedPatterns: RegExp[];
  allowedCommands?: string[];    // If set, only these are allowed
  maxOutputLines: number;
  defaultTimeout: number;
  maxTimeout: number;
  defaultShell: string;
}

export const DEFAULT_TERMINAL_SECURITY: TerminalSecurityConfig = {
  blockedCommands: [
    'rm -rf /',
    'rm -rf ~',
    'format',
    'del /f /s /q',
    'shutdown',
    'reboot',
    'init 0',
    'init 6',
    ':(){:|:&};:',  // Fork bomb
  ],
  blockedPatterns: [
    /rm\s+-rf\s+\/(?!tmp)/i,           // Dangerous recursive delete
    /dd\s+if=.*of=\/dev\/sd/i,         // Disk overwrite
    /mkfs/i,                            // Filesystem format
    />\s*\/dev\/sd/i,                   // Write to disk device
    /curl.*\|\s*(?:ba)?sh/i,           // Curl pipe to shell
    /wget.*\|\s*(?:ba)?sh/i,           // Wget pipe to shell
  ],
  maxOutputLines: 1000,
  defaultTimeout: 5000,   // 5 seconds (Claude Desktop safe)
  maxTimeout: 30000,      // 30 seconds (non-Desktop mode)
  defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
};

// ============================================================================
// Error Types
// ============================================================================

export type TerminalErrorCode =
  | 'PROCESS_NOT_FOUND'
  | 'PROCESS_ALREADY_EXITED'
  | 'COMMAND_BLOCKED'
  | 'TIMEOUT_EXCEEDED'
  | 'SPAWN_FAILED'
  | 'WRITE_FAILED'
  | 'INVALID_PID'
  | 'MAX_SESSIONS_REACHED'
  | 'UNKNOWN_ERROR';

export interface TerminalError {
  code: TerminalErrorCode;
  message: string;
  pid?: number;
}
