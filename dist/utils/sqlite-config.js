"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CACHE_SIZE = exports.DEFAULT_BUSY_TIMEOUT = void 0;
exports.initializeDatabase = initializeDatabase;
exports.configureSQLite = configureSQLite;
exports.getDatabaseConfig = getDatabaseConfig;
exports.checkpoint = checkpoint;
exports.closeDatabase = closeDatabase;
exports.verifyDatabaseConfig = verifyDatabaseConfig;
exports.withRetry = withRetry;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = require("path"); // FIX: Use dirname instead of join for parent directory
const fs_1 = require("fs");
/** Default busy timeout in milliseconds */
exports.DEFAULT_BUSY_TIMEOUT = 5000;
/** Default cache size in pages (negative = KB) */
exports.DEFAULT_CACHE_SIZE = -2000; // 2MB
const DEFAULT_CONFIG = {
    busyTimeout: exports.DEFAULT_BUSY_TIMEOUT,
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
function initializeDatabase(config) {
    const opts = { ...DEFAULT_CONFIG, ...config };
    // FIX: Use dirname() instead of join(path, '..')
    const dbDir = (0, path_1.dirname)(opts.dbPath);
    if (!(0, fs_1.existsSync)(dbDir)) {
        (0, fs_1.mkdirSync)(dbDir, { recursive: true });
    }
    // Create database with verbose mode for debugging in dev
    const db = new better_sqlite3_1.default(opts.dbPath, {
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
function configureSQLite(db, _dbPath) {
    applyPragmas(db, DEFAULT_CONFIG);
}
/**
 * Apply PRAGMA settings for safe operation
 */
function applyPragmas(db, opts) {
    // CRITICAL: WAL mode for concurrent access safety
    if (opts.walMode) {
        const result = db.pragma('journal_mode = WAL');
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
function getDatabaseConfig(db) {
    return {
        journalMode: db.pragma('journal_mode', true),
        busyTimeout: db.pragma('busy_timeout', true),
        cacheSize: db.pragma('cache_size', true),
        foreignKeys: db.pragma('foreign_keys', true),
        synchronous: db.pragma('synchronous', true),
        walCheckpoint: db.pragma('wal_checkpoint', true)
    };
}
/**
 * Perform WAL checkpoint to merge WAL into main database
 * Call periodically or before backup
 */
function checkpoint(db) {
    db.pragma('wal_checkpoint(TRUNCATE)');
}
/**
 * Safely close database with final checkpoint
 */
function closeDatabase(db) {
    try {
        // Final checkpoint before close
        checkpoint(db);
        db.close();
    }
    catch (error) {
        console.error('[SQLite] Error closing database:', error);
        // Force close even if checkpoint failed
        try {
            db.close();
        }
        catch {
            // Ignore
        }
    }
}
/**
 * Verify database is properly configured
 */
function verifyDatabaseConfig(db) {
    const issues = [];
    const journalMode = db.pragma('journal_mode', true);
    if (journalMode !== 'wal') {
        issues.push(`Journal mode is '${journalMode}', expected 'wal'`);
    }
    const busyTimeout = db.pragma('busy_timeout', true);
    if (busyTimeout < 1000) {
        issues.push(`Busy timeout is ${busyTimeout}ms, recommended >= 1000ms`);
    }
    const foreignKeys = db.pragma('foreign_keys', true);
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
async function withRetry(_db, operation, maxRetries = 3, delayMs = 100) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return operation();
        }
        catch (error) {
            lastError = error;
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
//# sourceMappingURL=sqlite-config.js.map