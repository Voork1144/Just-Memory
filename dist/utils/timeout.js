"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeoutError = exports.MIN_TIMEOUT = exports.DEFAULT_MAX_TIMEOUT = exports.CLAUDE_DESKTOP_MAX_TIMEOUT = void 0;
exports.isClaudeDesktopMode = isClaudeDesktopMode;
exports.getEffectiveTimeout = getEffectiveTimeout;
exports.withTimeout = withTimeout;
exports.getTimeoutConfig = getTimeoutConfig;
/** Maximum timeout in milliseconds for Claude Desktop mode */
exports.CLAUDE_DESKTOP_MAX_TIMEOUT = 5000;
/** Maximum timeout in milliseconds for other environments */
exports.DEFAULT_MAX_TIMEOUT = 30000;
/** Minimum timeout to prevent instant failures */
exports.MIN_TIMEOUT = 100;
/**
 * Check if running in Claude Desktop mode
 */
function isClaudeDesktopMode() {
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
function getEffectiveTimeout(requested) {
    const maxAllowed = isClaudeDesktopMode()
        ? exports.CLAUDE_DESKTOP_MAX_TIMEOUT
        : exports.DEFAULT_MAX_TIMEOUT;
    return Math.max(exports.MIN_TIMEOUT, Math.min(requested, maxAllowed));
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
async function withTimeout(promiseOrFn, timeoutMs, operation = 'Operation') {
    const effectiveTimeout = getEffectiveTimeout(timeoutMs);
    // Convert function to promise if needed
    const promise = typeof promiseOrFn === 'function'
        ? Promise.resolve().then(() => promiseOrFn())
        : promiseOrFn;
    // FIX: Use settled flag to prevent memory leaks and ensure cleanup
    let timeoutId;
    let settled = false;
    const cleanup = () => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
    };
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new TimeoutError(`${operation} timed out after ${effectiveTimeout}ms`, effectiveTimeout));
            }
        }, effectiveTimeout);
    });
    try {
        const result = await Promise.race([promise, timeoutPromise]);
        settled = true;
        cleanup();
        return result;
    }
    catch (error) {
        settled = true;
        cleanup();
        throw error;
    }
}
/**
 * Custom error class for timeout errors
 */
class TimeoutError extends Error {
    timeoutMs;
    code = 'TIMEOUT_ERROR';
    constructor(message, timeoutMs) {
        super(message);
        this.name = 'TimeoutError';
        this.timeoutMs = timeoutMs;
    }
}
exports.TimeoutError = TimeoutError;
/**
 * Get timeout configuration info for debugging
 */
function getTimeoutConfig() {
    const isDesktop = isClaudeDesktopMode();
    return {
        mode: isDesktop ? 'claude-desktop' : 'default',
        maxTimeout: isDesktop ? exports.CLAUDE_DESKTOP_MAX_TIMEOUT : exports.DEFAULT_MAX_TIMEOUT,
        enforced: isDesktop
    };
}
//# sourceMappingURL=timeout.js.map