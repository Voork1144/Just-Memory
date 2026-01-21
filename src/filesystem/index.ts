/**
 * Filesystem Module - Public Exports
 * 
 * Provides 8 filesystem tools for Just-Command MCP server:
 * - read_file: Read with pagination, encoding support
 * - read_multiple_files: Batch read
 * - write_file: Write/append with chunking
 * - edit_block: Surgical find/replace
 * - create_directory: Recursive mkdir
 * - list_directory: List with depth control
 * - move_file: Move/rename (error if exists)
 * - get_file_info: Metadata (size, modified, lines)
 */

// Type exports
export * from './types.js';

// Security exports
export {
  updateSecurityConfig,
  getSecurityConfig,
  normalizePath,
  validatePath,
  isPathAllowed,
  isPathBlocked,
  checkPathExists,
  checkFileSize,
  formatBytes,
  getPermissionString,
  isHiddenFile,
  sanitizeFilename,
} from './security.js';

// Read operations
export { readFile, readMultipleFiles } from './read.js';

// Write operations
export { writeFile, editBlock } from './write.js';

// Directory and file operations
export { 
  createDirectory, 
  listDirectory, 
  moveFile, 
  getFileInfo,
} from './operations.js';
