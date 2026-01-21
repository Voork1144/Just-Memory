/**
 * Filesystem Write Operations
 * 
 * Implements write_file and edit_block tools.
 * Supports append mode, chunked writes, and surgical editing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  WriteFileOptions, 
  WriteFileResult,
  EditBlockOptions,
  EditBlockResult,
} from './types.js';
import { 
  validatePath, 
  normalizePath, 
  checkPathExists,
} from './security.js';
import { sanitizeForJson } from '../utils/sanitize.js';

// ============================================================================
// write_file Implementation
// ============================================================================

/**
 * Write content to a file (write or append mode)
 */
export async function writeFile(options: WriteFileOptions): Promise<WriteFileResult> {
  const {
    path: filePath,
    content,
    mode = 'write',
    createDirs = true,
  } = options;
  
  // Validate path
  const pathError = validatePath(filePath, 'write');
  if (pathError) {
    throw new Error(`${pathError.code}: ${pathError.message}`);
  }
  
  const normalizedPath = normalizePath(filePath);
  
  // Create parent directories if needed
  if (createDirs) {
    const dirPath = path.dirname(normalizedPath);
    await fs.promises.mkdir(dirPath, { recursive: true });
  }
  
  // Check if directory exists
  const dirPath = path.dirname(normalizedPath);
  const { exists: dirExists } = await checkPathExists(dirPath);
  if (!dirExists) {
    throw new Error(`DIRECTORY_NOT_FOUND: Parent directory does not exist: ${dirPath}`);
  }
  
  // Write file
  const flag = mode === 'append' ? 'a' : 'w';
  await fs.promises.writeFile(normalizedPath, content, { flag, encoding: 'utf-8' });
  
  // Validate file was written by checking stats
  await fs.promises.stat(normalizedPath);
  
  return {
    success: true,
    path: normalizedPath,
    bytesWritten: Buffer.byteLength(content, 'utf-8'),
    mode,
  };
}

// ============================================================================
// edit_block Implementation (Surgical Editing)
// ============================================================================

/**
 * Perform surgical find/replace edit in a file
 */
export async function editBlock(options: EditBlockOptions): Promise<EditBlockResult> {
  const {
    path: filePath,
    oldText,
    newText,
    expectedReplacements = 1,
  } = options;
  
  // Validate path
  const pathError = validatePath(filePath, 'write');
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
  
  // Read current content
  const content = await fs.promises.readFile(normalizedPath, 'utf-8');
  
  // Count occurrences
  const occurrences = countOccurrences(content, oldText);
  
  if (occurrences === 0) {
    // Try to find similar text for helpful error
    const similar = findSimilarText(content, oldText);
    throw new Error(
      `TEXT_NOT_FOUND: The specified text was not found in the file.` +
      (similar ? `\n\nDid you mean:\n${similar.slice(0, 200)}...` : '')
    );
  }
  
  if (occurrences !== expectedReplacements) {
    throw new Error(
      `UNEXPECTED_OCCURRENCES: Found ${occurrences} occurrences, ` +
      `expected ${expectedReplacements}. ` +
      `Set expectedReplacements=${occurrences} to replace all, ` +
      `or make oldText more specific.`
    );
  }
  
  // Perform replacement
  const newContent = content.split(oldText).join(newText);
  
  // Write back
  await fs.promises.writeFile(normalizedPath, newContent, 'utf-8');
  
  // Generate preview (context around first replacement)
  const preview = generateEditPreview(newContent, newText);
  
  return {
    success: true,
    path: normalizedPath,
    replacements: occurrences,
    preview,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Count occurrences of a substring in text
 */
function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

/**
 * Find text similar to the search string (for helpful errors)
 */
function findSimilarText(content: string, search: string): string | null {
  // Try to find first line of search text
  const searchLines = search.split('\n');
  const firstLine = searchLines[0]?.trim() ?? '';
  if (firstLine.length < 5) return null;
  
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.includes(firstLine.slice(0, Math.min(20, firstLine.length)))) {
      // Return context around this line
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length, i + 5);
      return lines.slice(start, end).join('\n');
    }
  }
  
  return null;
}

/**
 * Generate a preview of the edit with context
 */
function generateEditPreview(content: string, newText: string): string {
  const lines = content.split('\n');
  const newTextFirstLine = newText.split('\n')[0] ?? '';
  
  // Find the line containing the new text
  let editLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && newTextFirstLine && line.includes(newTextFirstLine)) {
      editLineIndex = i;
      break;
    }
  }
  
  if (editLineIndex === -1) return 'Edit applied successfully.';
  
  // Get context (3 lines before and after)
  const start = Math.max(0, editLineIndex - 3);
  const end = Math.min(lines.length, editLineIndex + newText.split('\n').length + 3);
  
  const previewLines = lines.slice(start, end).map((line, idx) => {
    const lineNum = start + idx + 1;
    const prefix = lineNum === editLineIndex + 1 ? '>>>' : '   ';
    return `${prefix} ${lineNum.toString().padStart(4)}: ${line}`;
  });
  
  return sanitizeForJson(previewLines.join('\n'));
}
