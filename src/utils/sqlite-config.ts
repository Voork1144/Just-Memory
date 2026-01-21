/**
 * P0 Fix #5: SQLite WAL Mode & Safe Configuration
 * 
 * Bug #11 in CLAUDE_MCP_ANALYSIS.md: Concurrent database access can
 * cause "database is locked" errors or corruption.
 * 
 * This module configures SQLite for safe concurrent access.
 * 
 * Decision D20: SQLite WAL mode + busy_timeout required
 */

import Database from 'better-sqlite3';
import { dirname } from 'path';  // FIX: Use dirname instead of join for parent directory
import { existsSync, mkdirSync } from 'fs';

/** Default busy timeout in milliseconds */
export const DEFAULT_BUSY_TIMEOUT = 5000;

/** Default cache size in pages (negative = KB) */
export const DEFAULT_CACHE_SIZE = -2000; // 2MB

/** SQLite configuration options */
export interface SqliteConfig {
  /** Path to database file */
  dbPath: string;
  /** Busy timeout in milliseconds (default: 5000) */
  busyTimeout?: number;
  /** Cache size in KB (default: 2000) */
  cacheSizeKb?: number;
  /** Enable foreign keys (default: true) */
  foreignKeys?: boolean;
  /** Enable WAL mode (default: true, REQUIRED for safety) */
  walMode?: boolean;
  /** Synchronous mode (default: 'NORMAL') */
  synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
}

const DEFAULT_CONFIG: Omit<Required<SqliteConfig>, 'dbPath'> = {
  busyTimeout: DEFAULT_BUSY_TIMEOUT,
  cacheSizeKb: 2000,
  foreignKeys: true,
  walMode: true,
  synchronous: 'NORMAL'
};

/**
 * Initialize SQLite database with safe configuration
 * 
 * @param config - Database configuration
 * @returns Configured database instance
 * 
 * @example
 * const db = initializeDatabase({
 *   dbPath: './data/memory.db'
 * });
 */
export function initializeDatabase(config: SqliteConfig): Database.Database {
  const opts = { ...DEFAULT_CONFIG, ...config };
  
  // FIX: Use dirname() instead of join(path, '..')
  const dbDir = dirname(opts.dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  
  // Create database with verbose mode for debugging in dev
  const db = new Database(opts.dbPath, {
    verbose: process.env.NODE_ENV === 'development' 
      ? (sql) => console.log('[SQL]', sql)
      : undefined
  });
  
  // Apply PRAGMA settings
  applyPragmas(db, opts);
  
  return db;
}

/**
 * Configure an existing database with safe PRAGMA settings
 * Used when the database is created elsewhere (e.g., by another library)
 * 
 * @param db - Existing database instance
 * @param _dbPath - Database path (for logging, not used for operations)
 */
export function configureSQLite(
  db: Database.Database, 
  _dbPath: string
): void {
  applyPragmas(db, DEFAULT_CONFIG);
}

/**
 * Apply PRAGMA settings for safe operation
 */
function applyPragmas(
  db: Database.Database,
  opts: Omit<Required<SqliteConfig>, 'dbPath'>
): void {
  // CRITICAL: WAL mode for concurrent access safety
  if (opts.walMode) {
    const result = db.pragma('journal_mode = WAL') as Array<{ journal_mode: string }>;
    if (result[0]?.journal_mode !== 'wal') {
      console.warn('[SQLite] Failed to enable WAL mode');
    }
  }
  
  // CRITICAL: Busy timeout to handle lock contention
  db.pragma(`busy_timeout = ${opts.busyTimeout}`);
  
  // Performance: cache size
  db.pragma(`cache_size = ${-opts.cacheSizeKb}`);
  
  // Data integrity: foreign keys
  if (opts.foreignKeys) {
    db.pragma('foreign_keys = ON');
  }
  
  // Synchronous mode (NORMAL is good balance of safety/speed)
  db.pragma(`synchronous = ${opts.synchronous}`);
  
  // Additional safety settings
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O
}

/**
 * Get current database configuration
 */
export function getDatabaseConfig(db: Database.Database): Record<string, unknown> {
  return {
    journalMode: db.pragma('journal_mode', { simple: true }),
    busyTimeout: db.pragma('busy_timeout', { simple: true }),
    cacheSize: db.pragma('cache_size', { simple: true }),
    foreignKeys: db.pragma('foreign_keys', { simple: true }),
    synchronous: db.pragma('synchronous', { simple: true }),
    walCheckpoint: db.pragma('wal_checkpoint', { simple: true })
  };
}

/**
 * Perform WAL checkpoint to merge WAL into main database
 * Call periodically or before backup
 */
export function checkpoint(db: Database.Database): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
}

/**
 * Safely close database with final checkpoint
 */
export function closeDatabase(db: Database.Database): void {
  try {
    // Final checkpoint before close
    checkpoint(db);
    db.close();
  } catch (error) {
    console.error('[SQLite] Error closing database:', error);
    // Force close even if checkpoint failed
    try {
      db.close();
    } catch {
      // Ignore
    }
  }
}

/**
 * Verify database is properly configured
 */
export function verifyDatabaseConfig(db: Database.Database): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  const journalMode = db.pragma('journal_mode', { simple: true });
  if (journalMode !== 'wal') {
    issues.push(`Journal mode is '${journalMode}', expected 'wal'`);
  }
  
  const busyTimeout = db.pragma('busy_timeout', { simple: true }) as number;
  if (busyTimeout < 1000) {
    issues.push(`Busy timeout is ${busyTimeout}ms, recommended >= 1000ms`);
  }
  
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  if (foreignKeys !== 1) {
    issues.push('Foreign keys are disabled');
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Wrapper for transactions with automatic retry on SQLITE_BUSY
 */
export async function withRetry<T>(
  _db: Database.Database,
  operation: () => T,
  maxRetries: number = 3,
  delayMs: number = 100
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return operation();
    } catch (error) {
      lastError = error as Error;
      
      // Check if it's a busy error
      if (lastError.message?.includes('SQLITE_BUSY')) {
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
          continue;
        }
      }
      
      throw error;
    }
  }
  
  throw lastError;
}
