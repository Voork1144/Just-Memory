/**
 * P0 Fix #3: File Encoding Support
 *
 * Bug #7 in CLAUDE_MCP_ANALYSIS.md: Binary files or non-UTF8 content
 * can corrupt responses or cause parsing errors.
 *
 * This module provides safe file reading with encoding options.
 *
 * Decision D18: read_file encoding param (utf-8, base64, hex)
 */
/** Supported encoding types */
export type FileEncoding = 'utf-8' | 'base64' | 'hex';
/** Binary file extensions that should default to base64 */
export declare const BINARY_EXTENSIONS: Set<string>;
/** Text file extensions that are safe for UTF-8 */
export declare const TEXT_EXTENSIONS: Set<string>;
/**
 * Detect if a file is likely binary based on extension
 */
export declare function isBinaryFile(filePath: string): boolean;
/**
 * Get file extension (lowercase, with dot)
 */
export declare function getExtension(filePath: string): string;
/**
 * Suggest encoding based on file extension
 */
export declare function suggestEncoding(filePath: string): FileEncoding;
/**
 * Read file with specified encoding
 *
 * @param filePath - Path to file
 * @param encoding - Encoding to use (default: auto-detect)
 * @returns File content in specified encoding
 */
export declare function readFileWithEncoding(filePath: string, encoding?: FileEncoding): Promise<{
    content: string;
    encoding: FileEncoding;
    sizeBytes: number;
    isBinary: boolean;
}>;
/**
 * Check if buffer content appears to be binary (has many non-printable chars)
 * Alias: isBinaryBuffer (for compatibility with filesystem/read.ts)
 */
export declare function appearsToBeBinary(content: Buffer): boolean;
/** Alias for appearsToBeBinary - used by filesystem module */
export declare const isBinaryBuffer: typeof appearsToBeBinary;
/**
 * Detect encoding from buffer content
 * Checks for BOM markers and binary content
 */
export declare function detectEncoding(buffer: Buffer): 'utf-8' | 'utf-16le' | 'utf-16be';
/**
 * File read result with metadata
 */
export interface EncodedFileResult {
    content: string;
    encoding: FileEncoding;
    sizeBytes: number;
    isBinary: boolean;
    mimeType?: string;
}
//# sourceMappingURL=file-encoding.d.ts.map