/**
 * P0 Fix #4: Unicode Sanitization
 *
 * Bug #8 in CLAUDE_MCP_ANALYSIS.md: Unicode control characters, lone
 * surrogates, and invalid sequences can cause JSON parse errors or
 * corrupt the response stream.
 *
 * This module provides comprehensive Unicode sanitization.
 *
 * Decision D19: Unicode sanitization (remove control chars, lone surrogates)
 */
/** Sanitization options */
export interface SanitizeOptions {
    /** Remove C0 control characters (default: true) */
    removeC0Controls?: boolean;
    /** Remove C1 control characters (default: true) */
    removeC1Controls?: boolean;
    /** Remove lone surrogates (default: true) */
    removeLoneSurrogates?: boolean;
    /** Replace replacement characters with '?' (default: true) */
    replaceReplacementChar?: boolean;
    /** Remove BOM at start (default: true) */
    removeBOM?: boolean;
    /** Remove zero-width characters (default: false) */
    removeZeroWidth?: boolean;
    /** Remove Private Use Area characters (default: false) */
    removePrivateUse?: boolean;
    /** Replacement string for removed characters (default: '') */
    replacement?: string;
}
/**
 * Sanitize a string for safe JSON serialization and MCP transport
 *
 * @param str - String to sanitize
 * @param options - Sanitization options
 * @returns Sanitized string safe for JSON
 *
 * @example
 * sanitizeForJson("Hello\u0000World") // "HelloWorld"
 * sanitizeForJson("Test\uD800String") // "TestString"
 */
export declare function sanitizeForJson(str: string, options?: SanitizeOptions): string;
/**
 * Quick sanitization for MCP responses (most common issues only)
 * Optimized for speed over completeness
 */
export declare function quickSanitize(str: string): string;
/**
 * Check if a string contains problematic Unicode characters
 */
export declare function hasProblematicChars(str: string): boolean;
/**
 * Sanitize an object recursively for JSON serialization
 */
export declare function sanitizeObjectForJson<T>(obj: T): T;
/**
 * Escape special characters for safe inclusion in error messages
 */
export declare function escapeForDisplay(str: string): string;
//# sourceMappingURL=sanitize.d.ts.map