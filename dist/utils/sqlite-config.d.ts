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
/** Default busy timeout in milliseconds */
export declare const DEFAULT_BUSY_TIMEOUT = 5000;
/** Default cache size in pages (negative = KB) */
export declare const DEFAULT_CACHE_SIZE = -2000;
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
export declare function initializeDatabase(config: SqliteConfig): Database.Database;
/**
 * Configure an existing database with safe PRAGMA settings
 * Used when the database is created elsewhere (e.g., by another library)
 *
 * @param db - Existing database instance
 * @param _dbPath - Database path (for logging, not used for operations)
 */
export declare function configureSQLite(db: Database.Database, _dbPath: string): void;
/**
 * Get current database configuration
 */
export declare function getDatabaseConfig(db: Database.Database): Record<string, unknown>;
/**
 * Perform WAL checkpoint to merge WAL into main database
 * Call periodically or before backup
 */
export declare function checkpoint(db: Database.Database): void;
/**
 * Safely close database with final checkpoint
 */
export declare function closeDatabase(db: Database.Database): void;
/**
 * Verify database is properly configured
 */
export declare function verifyDatabaseConfig(db: Database.Database): {
    valid: boolean;
    issues: string[];
};
/**
 * Wrapper for transactions with automatic retry on SQLITE_BUSY
 */
export declare function withRetry<T>(_db: Database.Database, operation: () => T, maxRetries?: number, delayMs?: number): Promise<T>;
//# sourceMappingURL=sqlite-config.d.ts.map