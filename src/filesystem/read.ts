/**
 * Filesystem Read Operations
 * 
 * Implements read_file and read_multiple_files tools.
 * Supports pagination, encoding detection, and binary files (D18).
 */

import * as fs from 'fs';
// path import removed - unused
import { 
  ReadFileOptions, 
  ReadFileResult,
  ReadMultipleFilesOptions,
  ReadMultipleFilesResult,
} from './types.js';
import { 
  validatePath, 
  normalizePath, 
  checkPathExists,
  checkFileSize,
  getSecurityConfig,
} from './security.js';
import { detectEncoding, isBinaryBuffer } from '../utils/file-encoding.js';
import { sanitizeForJson } from '../utils/sanitize.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_LINES = 1000;
const DEFAULT_ENCODING = 'utf-8';

// ============================================================================
// read_file Implementation
// ============================================================================

/**
 * Read file with pagination and encoding support
 */
export async function readFile(options: ReadFileOptions): Promise<ReadFileResult> {
  const {
    path: filePath,
    offset = 0,
    length = DEFAULT_MAX_LINES,
    encoding = DEFAULT_ENCODING,
  } = options;
  
  // Validate path
  const pathError = validatePath(filePath, 'read');
  if (pathError) {
    throw new Error(`${pathError.code}: ${pathError.message}`);
  }
  
  const normalizedPath = normalizePath(filePath);
  
  // Check if file exists
  const { exists, type } = await checkPathExists(normalizedPath);
  if (!exists) {
    throw new Error(`FILE_NOT_FOUND: ${normalizedPath}`);
  }
  if (type !== 'file') {
    throw new Error(`NOT_A_FILE: ${normalizedPath} is a ${type}`);
  }
  
  // Check file size
  const sizeCheck = await checkFileSize(normalizedPath);
  if (sizeCheck.exceedsLimit && encoding === 'utf-8') {
    throw new Error(
      `FILE_TOO_LARGE: File is ${formatSize(sizeCheck.size)}, ` +
      `limit is ${formatSize(sizeCheck.limit)}. ` +
      `Use encoding='base64' for large binary files.`
    );
  }
  
  // Read file based on encoding
  if (encoding === 'base64' || encoding === 'hex') {
    return readBinaryFile(normalizedPath, encoding, offset, length);
  }
  
  return readTextFile(normalizedPath, offset, length);
}

/**
 * Read text file with line pagination
 */
async function readTextFile(
  filePath: string,
  offset: number,
  length: number
): Promise<ReadFileResult> {
  const config = getSecurityConfig();
  const maxLines = Math.min(length, config.maxReadLines);
  
  // Read entire file
  const buffer = await fs.promises.readFile(filePath);
  
  // Check if binary
  if (isBinaryBuffer(buffer)) {
    throw new Error(
      `BINARY_FILE: File appears to be binary. ` +
      `Use encoding='base64' or encoding='hex' to read binary files.`
    );
  }
  
  // Detect and use proper encoding
  const detected = detectEncoding(buffer);
  const content = buffer.toString(detected as BufferEncoding);
  
  // Split into lines
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  
  // Apply pagination
  const startLine = Math.max(0, offset);
  const endLine = Math.min(startLine + maxLines, totalLines);
  const selectedLines = lines.slice(startLine, endLine);
  
  // Sanitize content for JSON
  const sanitizedContent = sanitizeForJson(selectedLines.join('\n'));
  
  return {
    content: sanitizedContent,
    path: filePath,
    encoding: detected,
    lineCount: selectedLines.length,
    totalLines,
    offset: startLine,
    truncated: endLine < totalLines,
  };
}

/**
 * Read binary file with base64 or hex encoding
 */
async function readBinaryFile(
  filePath: string,
  encoding: 'base64' | 'hex',
  offset: number,
  length: number
): Promise<ReadFileResult> {
  const stats = await fs.promises.stat(filePath);
  
  // For binary files, offset/length are byte positions
  const startByte = Math.max(0, offset);
  const readLength = Math.min(length, 50 * 1024); // Max 50KB per read for binary
  
  // Create read stream for partial read
  const buffer = Buffer.alloc(readLength);
  const fd = await fs.promises.open(filePath, 'r');
  
  try {
    const { bytesRead } = await fd.read(buffer, 0, readLength, startByte);
    const content = buffer.slice(0, bytesRead).toString(encoding);
    
    return {
      content,
      path: filePath,
      encoding,
      lineCount: bytesRead,
      totalLines: stats.size,
      offset: startByte,
      truncated: startByte + bytesRead < stats.size,
    };
  } finally {
    await fd.close();
  }
}

// ============================================================================
// read_multiple_files Implementation
// ============================================================================

/**
 * Read multiple files in batch
 */
export async function readMultipleFiles(
  options: ReadMultipleFilesOptions
): Promise<ReadMultipleFilesResult> {
  const { paths, encoding = DEFAULT_ENCODING } = options;
  
  const results: ReadMultipleFilesResult['files'] = [];
  let successCount = 0;
  let errorCount = 0;
  
  // Process files in parallel (but limit concurrency)
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    
    const batchResults = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const result = await readFile({
            path: filePath,
            encoding,
            length: 500, // Limit lines per file in batch
          });
          
          successCount++;
          return {
            path: result.path,
            content: result.content,
            error: null,
            encoding: result.encoding,
            lineCount: result.lineCount,
          };
        } catch (error) {
          errorCount++;
          return {
            path: normalizePath(filePath),
            content: null,
            error: error instanceof Error ? error.message : 'Unknown error',
            encoding,
            lineCount: 0,
          };
        }
      })
    );
    
    results.push(...batchResults);
  }
  
  return {
    files: results,
    successCount,
    errorCount,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
