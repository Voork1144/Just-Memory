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
export declare const CLAUDE_DESKTOP_MAX_TIMEOUT = 5000;
/** Maximum timeout in milliseconds for other environments */
export declare const DEFAULT_MAX_TIMEOUT = 30000;
/** Minimum timeout to prevent instant failures */
export declare const MIN_TIMEOUT = 100;
/**
 * Check if running in Claude Desktop mode
 */
export declare function isClaudeDesktopMode(): boolean;
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
export declare function getEffectiveTimeout(requested: number): number;
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
export declare function withTimeout<T>(promiseOrFn: Promise<T> | (() => T | Promise<T>), timeoutMs: number, operation?: string): Promise<T>;
/**
 * Custom error class for timeout errors
 */
export declare class TimeoutError extends Error {
    readonly timeoutMs: number;
    readonly code = "TIMEOUT_ERROR";
    constructor(message: string, timeoutMs: number);
}
/**
 * Get timeout configuration info for debugging
 */
export declare function getTimeoutConfig(): {
    mode: 'claude-desktop' | 'default';
    maxTimeout: number;
    enforced: boolean;
};
//# sourceMappingURL=timeout.d.ts.map