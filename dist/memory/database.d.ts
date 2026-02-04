/**
 * Just-Command Memory Database Manager
 *
 * Handles database initialization, connection management, and migrations.
 * Uses better-sqlite3 for synchronous operations with sqlite-vec extension.
 */
import Database from 'better-sqlite3';
/**
 * Database configuration options
 */
export interface DatabaseConfig {
    /** Path to the SQLite database file */
    dbPath: string;
    /** Whether to enable WAL mode (default: true) */
    walMode?: boolean;
    /** Busy timeout in milliseconds (default: 5000) */
    busyTimeout?: number;
    /** Whether to load sqlite-vec extension (default: true) */
    enableVectorSearch?: boolean;
}
/**
 * Default database path in user's home directory
 */
export declare function getDefaultDbPath(): string;
/**
 * Initialize and return the database connection
 */
export declare function initDatabase(config?: Partial<DatabaseConfig>): Database.Database;
/**
 * Get the current database instance (throws if not initialized)
 */
export declare function getDatabase(): Database.Database;
/**
 * Close the database connection
 */
export declare function closeDatabase(): void;
/**
 * Get database statistics
 */
export interface DatabaseStats {
    memoryCount: number;
    entityCount: number;
    relationCount: number;
    fileAssociationCount: number;
    deletedMemoryCount: number;
    dbSizeBytes: number;
    schemaVersion: number;
}
export declare function getDatabaseStats(): DatabaseStats;
/**
 * Backup info
 */
export interface BackupInfo {
    filename: string;
    path: string;
    createdAt: string;
    sizeBytes: number;
}
/**
 * Get backup directory path
 */
export declare function getBackupDir(): string;
/**
 * Create a backup of the database
 */
export declare function backupDatabase(description?: string): BackupInfo;
/**
 * List available backups
 */
export declare function listBackups(limit?: number): BackupInfo[];
/**
 * Restore database from backup
 */
export declare function restoreDatabase(backupPath: string): {
    success: boolean;
    memoriesRestored: number;
};
//# sourceMappingURL=database.d.ts.map