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
export declare const MAX_RESPONSE_BYTES: number;
/** Warning threshold (80% of max) */
export declare const WARN_RESPONSE_BYTES: number;
/** Truncation marker */
export declare const TRUNCATION_MARKER = "\n\n[... truncated, response exceeded 50KB limit ...]";
/**
 * Measure string size in bytes (UTF-8)
 */
export declare function getByteSize(str: string): number;
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
export declare function truncateToByteLimit(content: string, maxBytes?: number): {
    content: string;
    truncated: boolean;
    originalBytes: number;
};
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
export declare function enforceResponseLimit(content: string, maxBytes?: number): SizeLimitedResponse<string>;
/**
 * Format file content with size-aware pagination info
 */
export declare function formatFileResponse(content: string, filePath: string, totalLines: number, startLine: number, endLine: number): string;
//# sourceMappingURL=response-limit.d.ts.map