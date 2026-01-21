/**
 * Filesystem Security Module
 * 
 * Path validation and security checks for filesystem operations.
 * Implements D12: Comprehensive validation (blocked commands, allowed dirs)
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  SecurityConfig,
  DEFAULT_SECURITY_CONFIG,
  FilesystemError,
  FilesystemErrorCode,
} from './types.js';

// Global security config (can be overridden)
let securityConfig: SecurityConfig = { ...DEFAULT_SECURITY_CONFIG };

/**
 * Update security configuration
 */
export function updateSecurityConfig(config: Partial<SecurityConfig>): void {
  securityConfig = { ...securityConfig, ...config };
}

/**
 * Get current security configuration
 */
export function getSecurityConfig(): SecurityConfig {
  return { ...securityConfig };
}

/**
 * Normalize and resolve a path to absolute form
 */
export function normalizePath(inputPath: string): string {
  // Handle Windows paths
  let normalized = inputPath.replace(/\\/g, '/');
  
  // Expand home directory
  if (normalized.startsWith('~')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    normalized = path.join(home, normalized.slice(1));
  }
  
  // Resolve to absolute path
  normalized = path.resolve(normalized);
  
  // Normalize again for consistency
  return path.normalize(normalized);
}

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(inputPath: string): boolean {
  const normalizedPath = normalizePath(inputPath);
  
  // If no allowed directories specified, allow all
  if (securityConfig.allowedDirectories.length === 0) {
    return true;
  }
  
  // Check if path is under any allowed directory
  return securityConfig.allowedDirectories.some(allowedDir => {
    const normalizedAllowed = normalizePath(allowedDir);
    return normalizedPath.startsWith(normalizedAllowed);
  });
}

/**
 * Check if a path matches any blocked patterns
 */
export function isPathBlocked(inputPath: string): boolean {
  const normalizedPath = normalizePath(inputPath).replace(/\\/g, '/');
  
  // Check blocked paths
  for (const blockedPath of securityConfig.blockedPaths) {
    if (normalizedPath.includes(blockedPath)) {
      return true;
    }
  }
  
  // Check blocked extensions
  const ext = path.extname(normalizedPath).toLowerCase();
  if (securityConfig.blockedExtensions.includes(ext)) {
    return true;
  }
  
  return false;
}

/**
 * Validate a path for filesystem operations
 * Returns null if valid, error object if invalid
 */
export function validatePath(
  inputPath: string,
  operation: 'read' | 'write' | 'delete' | 'list'
): FilesystemError | null {
  try {
    // Empty path check
    if (!inputPath || inputPath.trim().length === 0) {
      return {
        code: 'INVALID_PATH',
        message: 'Path cannot be empty',
        path: inputPath,
      };
    }
    
    const normalizedPath = normalizePath(inputPath);
    
    // Check allowed directories
    if (!isPathAllowed(normalizedPath)) {
      return {
        code: 'PERMISSION_DENIED',
        message: `Path is outside allowed directories`,
        path: normalizedPath,
      };
    }
    
    // Check blocked paths
    if (isPathBlocked(normalizedPath)) {
      return {
        code: 'PATH_BLOCKED',
        message: `Path is blocked by security policy`,
        path: normalizedPath,
      };
    }
    
    return null; // Valid
    
  } catch (error) {
    return {
      code: 'INVALID_PATH',
      message: error instanceof Error ? error.message : 'Invalid path',
      path: inputPath,
    };
  }
}

/**
 * Check if path exists and get its type
 */
export async function checkPathExists(
  inputPath: string
): Promise<{ exists: boolean; type: 'file' | 'directory' | 'symlink' | 'other' | null }> {
  try {
    const normalizedPath = normalizePath(inputPath);
    const stats = await fs.promises.stat(normalizedPath);
    
    let type: 'file' | 'directory' | 'symlink' | 'other' = 'other';
    if (stats.isFile()) type = 'file';
    else if (stats.isDirectory()) type = 'directory';
    else if (stats.isSymbolicLink()) type = 'symlink';
    
    return { exists: true, type };
    
  } catch {
    return { exists: false, type: null };
  }
}

/**
 * Check file size before reading
 */
export async function checkFileSize(inputPath: string): Promise<{
  size: number;
  exceedsLimit: boolean;
  limit: number;
}> {
  const normalizedPath = normalizePath(inputPath);
  const stats = await fs.promises.stat(normalizedPath);
  
  return {
    size: stats.size,
    exceedsLimit: stats.size > securityConfig.maxFileSize,
    limit: securityConfig.maxFileSize,
  };
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get file permissions as string (e.g., "rwxr-xr-x")
 */
export function getPermissionString(mode: number): string {
  const permissions = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-',
  ];
  return permissions.join('');
}

/**
 * Check if a file is hidden (starts with . or has hidden attribute on Windows)
 */
export function isHiddenFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return basename.startsWith('.');
}

/**
 * Sanitize filename to remove dangerous characters
 */
export function sanitizeFilename(filename: string): string {
  // Remove or replace dangerous characters
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .trim();
}
