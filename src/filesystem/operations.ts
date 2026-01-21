/**
 * Filesystem Operations
 * 
 * Implements create_directory, list_directory, move_file, and get_file_info tools.
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  CreateDirectoryOptions,
  CreateDirectoryResult,
  ListDirectoryOptions,
  ListDirectoryResult,
  DirectoryEntry,
  MoveFileOptions,
  MoveFileResult,
  GetFileInfoOptions,
  FileInfo,
} from './types.js';
import { 
  validatePath, 
  normalizePath, 
  checkPathExists,
  formatBytes,
  getPermissionString,
  isHiddenFile,
  getSecurityConfig,
} from './security.js';

// ============================================================================
// create_directory Implementation
// ============================================================================

/**
 * Create a directory (with recursive option)
 */
export async function createDirectory(
  options: CreateDirectoryOptions
): Promise<CreateDirectoryResult> {
  const { path: dirPath, recursive = true } = options;
  
  // Validate path
  const pathError = validatePath(dirPath, 'write');
  if (pathError) {
    throw new Error(`${pathError.code}: ${pathError.message}`);
  }
  
  const normalizedPath = normalizePath(dirPath);
  
  // Check if already exists
  const { exists, type } = await checkPathExists(normalizedPath);
  
  if (exists) {
    if (type === 'directory') {
      return {
        success: true,
        path: normalizedPath,
        created: false, // Already existed
      };
    }
    throw new Error(`ALREADY_EXISTS: Path exists and is not a directory: ${normalizedPath}`);
  }
  
  // Create directory
  await fs.promises.mkdir(normalizedPath, { recursive });
  
  return {
    success: true,
    path: normalizedPath,
    created: true,
  };
}

// ============================================================================
// list_directory Implementation
// ============================================================================

/**
 * List directory contents with depth control
 */
export async function listDirectory(
  options: ListDirectoryOptions
): Promise<ListDirectoryResult> {
  const {
    path: dirPath,
    depth = 1,
    includeHidden = false,
    pattern,
  } = options;
  
  // Validate path
  const pathError = validatePath(dirPath, 'list');
  if (pathError) {
    throw new Error(`${pathError.code}: ${pathError.message}`);
  }
  
  const normalizedPath = normalizePath(dirPath);
  
  // Check if directory exists
  const { exists, type } = await checkPathExists(normalizedPath);
  if (!exists) {
    throw new Error(`DIRECTORY_NOT_FOUND: ${normalizedPath}`);
  }
  if (type !== 'directory') {
    throw new Error(`NOT_A_DIRECTORY: ${normalizedPath} is a ${type}`);
  }
  
  const config = getSecurityConfig();
  const entries: DirectoryEntry[] = [];
  let truncated = false;
  
  // Recursive listing function
  async function listRecursive(currentPath: string, currentDepth: number): Promise<void> {
    if (currentDepth > depth) return;
    if (entries.length >= config.maxDirectoryEntries) {
      truncated = true;
      return;
    }
    
    const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
    
    for (const item of items) {
      if (entries.length >= config.maxDirectoryEntries) {
        truncated = true;
        return;
      }
      
      const itemPath = path.join(currentPath, item.name);
      
      // Skip hidden files if not requested
      if (!includeHidden && isHiddenFile(item.name)) {
        continue;
      }
      
      // Apply pattern filter
      if (pattern && !matchGlob(item.name, pattern)) {
        continue;
      }
      
      try {
        const stats = await fs.promises.stat(itemPath);
        
        entries.push({
          name: item.name,
          path: itemPath,
          type: item.isFile() ? 'file' : 
                item.isDirectory() ? 'directory' : 
                item.isSymbolicLink() ? 'symlink' : 'other',
          size: stats.size,
          modified: stats.mtime.toISOString(),
        });
        
        // Recurse into directories
        if (item.isDirectory() && currentDepth < depth) {
          await listRecursive(itemPath, currentDepth + 1);
        }
      } catch {
        // Skip items we can't stat (permission issues)
      }
    }
  }
  
  await listRecursive(normalizedPath, 1);
  
  // Sort: directories first, then by name
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
  
  return {
    path: normalizedPath,
    entries,
    totalCount: entries.length,
    truncated,
  };
}

// ============================================================================
// move_file Implementation
// ============================================================================

/**
 * Move or rename a file/directory
 * D6: Error if destination exists (unless overwrite=true)
 */
export async function moveFile(options: MoveFileOptions): Promise<MoveFileResult> {
  const { source, destination, overwrite = false } = options;
  
  // Validate paths
  const sourceError = validatePath(source, 'read');
  if (sourceError) {
    throw new Error(`${sourceError.code}: ${sourceError.message}`);
  }
  
  const destError = validatePath(destination, 'write');
  if (destError) {
    throw new Error(`${destError.code}: ${destError.message}`);
  }
  
  const normalizedSource = normalizePath(source);
  const normalizedDest = normalizePath(destination);
  
  // Check source exists
  const { exists: sourceExists } = await checkPathExists(normalizedSource);
  if (!sourceExists) {
    throw new Error(`FILE_NOT_FOUND: Source does not exist: ${normalizedSource}`);
  }
  
  // Check destination doesn't exist (D6: safe default)
  const { exists: destExists } = await checkPathExists(normalizedDest);
  if (destExists && !overwrite) {
    throw new Error(
      `ALREADY_EXISTS: Destination already exists: ${normalizedDest}. ` +
      `Set overwrite=true to replace.`
    );
  }
  
  // Create destination directory if needed
  const destDir = path.dirname(normalizedDest);
  await fs.promises.mkdir(destDir, { recursive: true });
  
  // Check if it's a rename (same directory) or move
  const isRename = path.dirname(normalizedSource) === path.dirname(normalizedDest);
  
  // Perform move
  await fs.promises.rename(normalizedSource, normalizedDest);
  
  return {
    success: true,
    source: normalizedSource,
    destination: normalizedDest,
    renamed: isRename,
  };
}

// ============================================================================
// get_file_info Implementation
// ============================================================================

/**
 * Get detailed file/directory information
 */
export async function getFileInfo(options: GetFileInfoOptions): Promise<FileInfo> {
  const { path: filePath } = options;
  
  // Validate path
  const pathError = validatePath(filePath, 'read');
  if (pathError) {
    throw new Error(`${pathError.code}: ${pathError.message}`);
  }
  
  const normalizedPath = normalizePath(filePath);
  
  // Get stats
  const stats = await fs.promises.stat(normalizedPath);
  
  // Determine type
  let type: FileInfo['type'] = 'other';
  if (stats.isFile()) type = 'file';
  else if (stats.isDirectory()) type = 'directory';
  else if (stats.isSymbolicLink()) type = 'symlink';
  
  // Count lines for text files
  let lineCount: number | undefined;
  if (type === 'file' && stats.size < 10 * 1024 * 1024) { // < 10MB
    try {
      const content = await fs.promises.readFile(normalizedPath, 'utf-8');
      lineCount = content.split('\n').length;
    } catch {
      // Not a text file or can't read
    }
  }
  
  const basename = path.basename(normalizedPath);
  const extension = path.extname(normalizedPath);
  
  return {
    path: normalizedPath,
    name: basename,
    type,
    size: stats.size,
    sizeHuman: formatBytes(stats.size),
    created: stats.birthtime.toISOString(),
    modified: stats.mtime.toISOString(),
    accessed: stats.atime.toISOString(),
    permissions: getPermissionString(stats.mode),
    lineCount,
    extension: extension || undefined,
    isHidden: isHiddenFile(basename),
    isReadOnly: !(stats.mode & 0o200), // Check write permission
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Simple glob pattern matching
 */
function matchGlob(name: string, pattern: string): boolean {
  // Convert glob to regex
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  
  return new RegExp(`^${regex}$`, 'i').test(name);
}
