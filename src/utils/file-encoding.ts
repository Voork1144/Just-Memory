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

import { readFile as fsReadFile } from 'fs/promises';
// FIX: Removed unused imports (existsSync, statSync)

/** Supported encoding types */
export type FileEncoding = 'utf-8' | 'base64' | 'hex';

/** Binary file extensions that should default to base64 */
export const BINARY_EXTENSIONS = new Set([
  // Images (note: SVG is text/XML, so in TEXT_EXTENSIONS)
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  // Archives
  '.zip', '.tar', '.gz', '.7z', '.rar',
  // Executables
  '.exe', '.dll', '.so', '.dylib',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Media
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
  // Data
  '.db', '.sqlite', '.sqlite3',
  // Other
  '.bin', '.dat', '.wasm'
]);

/** Text file extensions that are safe for UTF-8 */
export const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.sh', '.bash', '.zsh', '.fish',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.gitignore', '.editorconfig',
  // FIX: Added missing text extensions (including SVG which is text/XML)
  '.svg', '.vue', '.svelte', '.scss', '.less', '.graphql', '.sql'
]);

/**
 * Detect if a file is likely binary based on extension
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = getExtension(filePath);
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Get file extension (lowercase, with dot)
 */
export function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

/**
 * Suggest encoding based on file extension
 */
export function suggestEncoding(filePath: string): FileEncoding {
  if (isBinaryFile(filePath)) {
    return 'base64';
  }
  return 'utf-8';
}

/**
 * Read file with specified encoding
 * 
 * @param filePath - Path to file
 * @param encoding - Encoding to use (default: auto-detect)
 * @returns File content in specified encoding
 */
export async function readFileWithEncoding(
  filePath: string,
  encoding?: FileEncoding
): Promise<{
  content: string;
  encoding: FileEncoding;
  sizeBytes: number;
  isBinary: boolean;
}> {
  // Use provided encoding or auto-detect
  const effectiveEncoding = encoding ?? suggestEncoding(filePath);
  const isBinary = isBinaryFile(filePath);
  
  const buffer = await fsReadFile(filePath);
  const sizeBytes = buffer.length;
  
  let content: string;
  
  switch (effectiveEncoding) {
    case 'base64':
      content = buffer.toString('base64');
      break;
    case 'hex':
      content = buffer.toString('hex');
      break;
    case 'utf-8':
    default:
      // For UTF-8, sanitize the content
      content = sanitizeUtf8(buffer.toString('utf-8'));
      break;
  }
  
  return {
    content,
    encoding: effectiveEncoding,
    sizeBytes,
    isBinary
  };
}

/**
 * Sanitize UTF-8 string by removing problematic characters
 * (This is a light version - full sanitization in sanitize.ts)
 */
function sanitizeUtf8(str: string): string {
  // Replace NULL bytes and other control characters
  return str.replace(/\0/g, '');
}

/**
 * Check if buffer content appears to be binary (has many non-printable chars)
 * Alias: isBinaryBuffer (for compatibility with filesystem/read.ts)
 */
export function appearsToBeBinary(content: Buffer): boolean {
  // Sample first 8KB
  const sample = content.slice(0, 8192);
  let nonPrintable = 0;
  
  for (const byte of sample) {
    // Count bytes that aren't printable ASCII or common whitespace
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      nonPrintable++;
    }
  }
  
  // If more than 10% non-printable, likely binary
  return nonPrintable / sample.length > 0.1;
}

/** Alias for appearsToBeBinary - used by filesystem module */
export const isBinaryBuffer = appearsToBeBinary;

/**
 * Detect encoding from buffer content
 * Checks for BOM markers and binary content
 */
export function detectEncoding(buffer: Buffer): 'utf-8' | 'utf-16le' | 'utf-16be' {
  // Check for BOM (Byte Order Mark)
  if (buffer.length >= 3) {
    // UTF-8 BOM
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return 'utf-8';
    }
  }
  if (buffer.length >= 2) {
    // UTF-16 LE BOM
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      return 'utf-16le';
    }
    // UTF-16 BE BOM
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      return 'utf-16be';
    }
  }
  
  // Default to UTF-8
  return 'utf-8';
}

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
