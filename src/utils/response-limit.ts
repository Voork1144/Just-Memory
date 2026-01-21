/**
 * P0 Fix #2: Response Size Limit
 * 
 * Bug #2 in CLAUDE_MCP_ANALYSIS.md: Large responses (>50KB) can freeze
 * Claude Desktop UI or cause parsing failures.
 * 
 * This module enforces response size limits with graceful truncation.
 * 
 * Decision D17: 50KB response limit hard enforcement
 */

/** Maximum response size in bytes (50KB) */
export const MAX_RESPONSE_BYTES = 50 * 1024;

/** Warning threshold (80% of max) */
export const WARN_RESPONSE_BYTES = 40 * 1024;

/** Truncation marker */
export const TRUNCATION_MARKER = '\n\n[... truncated, response exceeded 50KB limit ...]';

/**
 * Measure string size in bytes (UTF-8)
 */
export function getByteSize(str: string): number {
  return Buffer.byteLength(str, 'utf-8');
}

/**
 * Truncate string to fit within byte limit
 * 
 * FIX: Now safely handles UTF-8 multi-byte characters to prevent
 * corruption at truncation boundaries (emoji, surrogate pairs, etc.)
 * 
 * @param content - Content to truncate
 * @param maxBytes - Maximum bytes (default: MAX_RESPONSE_BYTES)
 * @returns Truncated content with marker if truncated
 */
export function truncateToByteLimit(
  content: string,
  maxBytes: number = MAX_RESPONSE_BYTES
): { content: string; truncated: boolean; originalBytes: number } {
  const originalBytes = getByteSize(content);
  
  if (originalBytes <= maxBytes) {
    return { content, truncated: false, originalBytes };
  }
  
  // Reserve space for truncation marker
  const markerBytes = getByteSize(TRUNCATION_MARKER);
  const targetBytes = maxBytes - markerBytes;
  
  // Binary search for the right character position
  let low = 0;
  let high = content.length;
  
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (getByteSize(content.slice(0, mid)) <= targetBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  
  // FIX: Ensure we don't split a multi-byte character (surrogate pairs)
  // High surrogates: 0xD800-0xDBFF, Low surrogates: 0xDC00-0xDFFF
  let truncateAt = low;
  while (truncateAt > 0) {
    const charCode = content.charCodeAt(truncateAt);
    // If we're at a low surrogate (second half of emoji), back up
    if (charCode >= 0xDC00 && charCode <= 0xDFFF) {
      truncateAt--;
    } else {
      break;
    }
  }
  
  // Try to truncate at a line break for cleaner output
  truncateAt = findCleanBreakPoint(content, truncateAt);
  
  return {
    content: content.slice(0, truncateAt) + TRUNCATION_MARKER,
    truncated: true,
    originalBytes
  };
}

/**
 * Find a clean break point (newline) near the target position
 */
function findCleanBreakPoint(content: string, position: number): number {
  // Look back up to 200 chars for a newline
  const searchStart = Math.max(0, position - 200);
  const lastNewline = content.lastIndexOf('\n', position);
  
  if (lastNewline > searchStart) {
    return lastNewline;
  }
  
  // No newline found, truncate at position
  return position;
}

/**
 * Response wrapper that enforces size limits
 */
export interface SizeLimitedResponse<T> {
  data: T;
  metadata: {
    truncated: boolean;
    originalBytes: number;
    returnedBytes: number;
    warningIssued: boolean;
  };
}

/**
 * Wrap a string response with size limit enforcement
 */
export function enforceResponseLimit(
  content: string,
  maxBytes: number = MAX_RESPONSE_BYTES
): SizeLimitedResponse<string> {
  const result = truncateToByteLimit(content, maxBytes);
  const returnedBytes = getByteSize(result.content);
  
  return {
    data: result.content,
    metadata: {
      truncated: result.truncated,
      originalBytes: result.originalBytes,
      returnedBytes,
      warningIssued: result.originalBytes > WARN_RESPONSE_BYTES
    }
  };
}

/**
 * Format file content with size-aware pagination info
 */
export function formatFileResponse(
  content: string,
  filePath: string,
  totalLines: number,
  startLine: number,
  endLine: number
): string {
  const result = truncateToByteLimit(content);
  
  let response = result.content;
  
  if (result.truncated) {
    response += `\n\n📊 File: ${filePath}`;
    response += `\n   Original: ${(result.originalBytes / 1024).toFixed(1)}KB`;
    response += `\n   Returned: ${(getByteSize(response) / 1024).toFixed(1)}KB`;
    response += `\n   Lines: ${startLine}-${endLine} of ${totalLines}`;
    response += `\n   Use offset/length params to read more.`;
  }
  
  return response;
}
