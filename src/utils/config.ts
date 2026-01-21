/**
 * Just-Command Server Configuration
 * 
 * Returns current server configuration and state.
 */

import { isClaudeDesktopMode } from './timeout.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Server configuration
 */
export interface ServerConfig {
  version: string;
  claudeDesktopMode: boolean;
  timeoutMs: number;
  responseLimitBytes: number;
  database: {
    path: string;
    backupDir: string;
    sizeBytes: number;
  };
  modules: {
    memory: boolean;
    filesystem: boolean;
    terminal: boolean;
    search: boolean;
  };
  toolCount: number;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
}

/**
 * Get database path (duplicated to avoid circular imports)
 */
function getDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, '.just-command', 'memory.db');
}

/**
 * Get backup directory path
 */
function getBackupDirPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, '.just-command', 'backups');
}

/**
 * Get current server configuration
 */
export function getConfig(): ServerConfig {
  const dbPath = getDbPath();
  const backupDir = getBackupDirPath();
  
  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(dbPath)) {
      dbSizeBytes = fs.statSync(dbPath).size;
    }
  } catch {
    // Ignore
  }
  
  const claudeDesktopMode = isClaudeDesktopMode();
  
  return {
    version: '0.4.0',
    claudeDesktopMode,
    timeoutMs: claudeDesktopMode ? 5000 : 30000,
    responseLimitBytes: 50 * 1024, // 50KB
    database: {
      path: dbPath,
      backupDir,
      sizeBytes: dbSizeBytes,
    },
    modules: {
      memory: true,
      filesystem: true,
      terminal: true,
      search: true,
    },
    toolCount: 31, // Full 31-tool spec
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}
