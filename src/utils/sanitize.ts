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

/**
 * Control characters to remove (C0 control codes except tab, newline, CR)
 * Range: U+0000-U+001F excluding U+0009 (tab), U+000A (LF), U+000D (CR)
 */
const C0_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/**
 * C1 control characters (U+0080-U+009F)
 * Often cause issues in text processing
 */
const C1_CONTROL_CHARS = /[\u0080-\u009F]/g;

/**
 * Lone surrogates (invalid in UTF-8/JSON)
 * High surrogates: U+D800-U+DBFF
 * Low surrogates: U+DC00-U+DFFF
 */
const LONE_SURROGATES = /[\uD800-\uDFFF]/g;

/**
 * Unicode replacement character (often indicates encoding issues)
 */
const REPLACEMENT_CHAR = /\uFFFD/g;

/**
 * Byte Order Mark (BOM) - often unwanted at string start
 */
const BOM = /^\uFEFF/;

/**
 * Zero-width characters that can cause invisible issues
 */
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;

/**
 * Private Use Area characters
 */
const PRIVATE_USE_AREA = /[\uE000-\uF8FF]/g;

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

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  removeC0Controls: true,
  removeC1Controls: true,
  removeLoneSurrogates: true,
  replaceReplacementChar: true,
  removeBOM: true,
  removeZeroWidth: false,
  removePrivateUse: false,
  replacement: ''
};

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
export function sanitizeForJson(
  str: string,
  options: SanitizeOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let result = str;
  
  // Remove BOM first (only at start)
  if (opts.removeBOM) {
    result = result.replace(BOM, '');
  }
  
  // Remove C0 control characters (except tab, LF, CR)
  if (opts.removeC0Controls) {
    result = result.replace(C0_CONTROL_CHARS, opts.replacement);
  }
  
  // Remove C1 control characters
  if (opts.removeC1Controls) {
    result = result.replace(C1_CONTROL_CHARS, opts.replacement);
  }
  
  // Remove lone surrogates (CRITICAL for JSON)
  if (opts.removeLoneSurrogates) {
    result = result.replace(LONE_SURROGATES, opts.replacement);
  }
  
  // Replace replacement characters
  if (opts.replaceReplacementChar) {
    result = result.replace(REPLACEMENT_CHAR, '?');
  }
  
  // Optional: remove zero-width characters
  if (opts.removeZeroWidth) {
    result = result.replace(ZERO_WIDTH_CHARS, opts.replacement);
  }
  
  // Optional: remove Private Use Area
  if (opts.removePrivateUse) {
    result = result.replace(PRIVATE_USE_AREA, opts.replacement);
  }
  
  return result;
}

/**
 * Quick sanitization for MCP responses (most common issues only)
 * Optimized for speed over completeness
 */
export function quickSanitize(str: string): string {
  return str
    .replace(C0_CONTROL_CHARS, '')
    .replace(LONE_SURROGATES, '')
    .replace(REPLACEMENT_CHAR, '?');
}

/**
 * Check if a string contains problematic Unicode characters
 */
export function hasProblematicChars(str: string): boolean {
  return (
    C0_CONTROL_CHARS.test(str) ||
    LONE_SURROGATES.test(str) ||
    REPLACEMENT_CHAR.test(str)
  );
}

/**
 * Sanitize an object recursively for JSON serialization
 */
export function sanitizeObjectForJson<T>(obj: T): T {
  if (typeof obj === 'string') {
    return sanitizeForJson(obj) as T;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObjectForJson(item)) as T;
  }
  
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = sanitizeForJson(key);
      result[sanitizedKey] = sanitizeObjectForJson(value);
    }
    return result as T;
  }
  
  return obj;
}

/**
 * Escape special characters for safe inclusion in error messages
 */
export function escapeForDisplay(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
