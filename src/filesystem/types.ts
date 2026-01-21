/**
 * Filesystem Module Types
 * 
 * Type definitions for filesystem operations in Just-Command MCP server.
 */

// ============================================================================
// Read Operations
// ============================================================================

export interface ReadFileOptions {
  path: string;
  offset?: number;       // Line offset (0-based)
  length?: number;       // Number of lines to read
  encoding?: 'utf-8' | 'base64' | 'hex';  // D18: Binary file support
}

export interface ReadFileResult {
  content: string;
  path: string;
  encoding: string;
  lineCount: number;
  totalLines: number;
  offset: number;
  truncated: boolean;
}

export interface ReadMultipleFilesOptions {
  paths: string[];
  encoding?: 'utf-8' | 'base64' | 'hex';
}

export interface ReadMultipleFilesResult {
  files: Array<{
    path: string;
    content: string | null;
    error: string | null;
    encoding: string;
    lineCount: number;
  }>;
  successCount: number;
  errorCount: number;
}

// ============================================================================
// Write Operations
// ============================================================================

export interface WriteFileOptions {
  path: string;
  content: string;
  mode?: 'write' | 'append';
  createDirs?: boolean;
}

export interface WriteFileResult {
  success: boolean;
  path: string;
  bytesWritten: number;
  mode: string;
}

export interface EditBlockOptions {
  path: string;
  oldText: string;
  newText: string;
  expectedReplacements?: number;
}

export interface EditBlockResult {
  success: boolean;
  path: string;
  replacements: number;
  preview?: string;  // Show context around the edit
}

// ============================================================================
// Directory Operations
// ============================================================================

export interface CreateDirectoryOptions {
  path: string;
  recursive?: boolean;
}

export interface CreateDirectoryResult {
  success: boolean;
  path: string;
  created: boolean;  // false if already existed
}

export interface ListDirectoryOptions {
  path: string;
  depth?: number;      // Max depth (default: 1)
  includeHidden?: boolean;
  pattern?: string;    // Glob pattern filter
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
}

export interface ListDirectoryResult {
  path: string;
  entries: DirectoryEntry[];
  totalCount: number;
  truncated: boolean;
}

// ============================================================================
// File Operations
// ============================================================================

export interface MoveFileOptions {
  source: string;
  destination: string;
  overwrite?: boolean;  // D6: Error if exists by default
}

export interface MoveFileResult {
  success: boolean;
  source: string;
  destination: string;
  renamed: boolean;
}

export interface GetFileInfoOptions {
  path: string;
}

export interface FileInfo {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  sizeHuman: string;
  created: string;
  modified: string;
  accessed: string;
  permissions: string;
  lineCount?: number;  // Only for text files
  extension?: string;
  isHidden: boolean;
  isReadOnly: boolean;
}

// ============================================================================
// Security Configuration (D12)
// ============================================================================

export interface SecurityConfig {
  allowedDirectories: string[];
  blockedPaths: string[];
  blockedExtensions: string[];
  maxFileSize: number;        // 10MB default
  maxReadLines: number;       // 1000 default
  maxDirectoryEntries: number; // 500 default
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowedDirectories: [],      // Empty = all allowed (configurable)
  blockedPaths: [
    '/.git/',
    '/node_modules/',
    '/.env',
    '/secrets/',
    '/private/',
  ],
  blockedExtensions: [
    '.exe', '.dll', '.sys', '.bat', '.cmd', '.ps1',
  ],
  maxFileSize: 10 * 1024 * 1024,    // 10MB
  maxReadLines: 1000,
  maxDirectoryEntries: 500,
};

// ============================================================================
// Error Types
// ============================================================================

export type FilesystemErrorCode = 
  | 'FILE_NOT_FOUND'
  | 'DIRECTORY_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'PATH_BLOCKED'
  | 'FILE_TOO_LARGE'
  | 'ALREADY_EXISTS'
  | 'INVALID_PATH'
  | 'NOT_A_FILE'
  | 'NOT_A_DIRECTORY'
  | 'READ_ERROR'
  | 'WRITE_ERROR'
  | 'UNKNOWN_ERROR';

export interface FilesystemError {
  code: FilesystemErrorCode;
  message: string;
  path?: string;
}
