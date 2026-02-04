/**
 * P0 Fix #1: CLAUDE_DESKTOP_MODE Timeout Protection
 * 
 * Bug #1 in CLAUDE_MCP_ANALYSIS.md: Claude Desktop crashes if MCP tool
 * execution exceeds ~5-10 seconds without response.
 * 
 * This module enforces timeout limits to prevent crashes.
 * 
 * Decision D16: CLAUDE_DESKTOP_MODE env enforces 5000ms timeout
 */

/** Maximum timeout in milliseconds for Claude Desktop mode */
export const CLAUDE_DESKTOP_MAX_TIMEOUT = 5000;

/** Maximum timeout in milliseconds for other environments */
export const DEFAULT_MAX_TIMEOUT = 30000;

/** Minimum timeout to prevent instant failures */
export const MIN_TIMEOUT = 100;

/**
 * Check if running in Claude Desktop mode
 */
export function isClaudeDesktopMode(): boolean {
  return process.env.CLAUDE_DESKTOP_MODE === 'true';
}

/**
 * Get the effective maximum timeout based on environment
 * 
 * @param requested - The requested timeout in milliseconds
 * @returns The effective timeout, clamped to safe limits
 * 
 * @example
 * // In Claude Desktop mode (CLAUDE_DESKTOP_MODE=true)
 * getEffectiveTimeout(10000) // Returns 5000
 * 
 * // In other environments
 * getEffectiveTimeout(10000) // Returns 10000
 */
export function getEffectiveTimeout(requested: number): number {
  const maxAllowed = isClaudeDesktopMode() 
    ? CLAUDE_DESKTOP_MAX_TIMEOUT 
    : DEFAULT_MAX_TIMEOUT;
  
  return Math.max(MIN_TIMEOUT, Math.min(requested, maxAllowed));
}

/**
 * Create a timeout-protected promise wrapper
 * 
 * @param promiseOrFn - The promise or async function to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Description for error messages
 * @returns Promise that rejects if timeout exceeded
 * 
 * @example
 * // With a promise
 * const result = await withTimeout(
 *   fetch('https://api.example.com'),
 *   5000,
 *   'API request'
 * );
 * 
 * // With a function (thunk)
 * const result = await withTimeout(
 *   () => someAsyncOperation(),
 *   5000,
 *   'Operation'
 * );
 * 
 * @throws {TimeoutError} If the operation exceeds the timeout
 */
export async function withTimeout<T>(
  promiseOrFn: Promise<T> | (() => T | Promise<T>),
  timeoutMs: number,
  operation: string = 'Operation'
): Promise<T> {
  const effectiveTimeout = getEffectiveTimeout(timeoutMs);
  
  // Convert function to promise if needed
  const promise: Promise<T> = typeof promiseOrFn === 'function' 
    ? Promise.resolve().then(() => promiseOrFn())
    : promiseOrFn;
  
  // FIX: Use settled flag to prevent memory leaks and ensure cleanup
  let timeoutId: NodeJS.Timeout | undefined;
  let settled = false;
  
  const cleanup = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError(
          `${operation} timed out after ${effectiveTimeout}ms`,
          effectiveTimeout
        ));
      }
    }, effectiveTimeout);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    settled = true;
    cleanup();
    return result;
  } catch (error) {
    settled = true;
    cleanup();
    throw error;
  }
}

/**
 * Custom error class for timeout errors
 */
export class TimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly code = 'TIMEOUT_ERROR';
  
  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Get timeout configuration info for debugging
 */
export function getTimeoutConfig(): {
  mode: 'claude-desktop' | 'default';
  maxTimeout: number;
  enforced: boolean;
} {
  const isDesktop = isClaudeDesktopMode();
  return {
    mode: isDesktop ? 'claude-desktop' : 'default',
    maxTimeout: isDesktop ? CLAUDE_DESKTOP_MAX_TIMEOUT : DEFAULT_MAX_TIMEOUT,
    enforced: isDesktop
  };
}
