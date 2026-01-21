/**
 * Just-Command Memory Database Manager
 * 
 * Handles database initialization, connection management, and migrations.
 * Uses better-sqlite3 for synchronous operations with sqlite-vec extension.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as sqliteVec from 'sqlite-vec';
import { configureSQLite } from '../utils/sqlite-config.js';
import { SCHEMA_SQL, SCHEMA_VERSION, VECTOR_TABLE_SQL } from './schema.js';

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
export function getDefaultDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  const dir = path.join(home, '.just-command');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'memory.db');
}

/**
 * Database manager singleton
 */
let dbInstance: Database.Database | null = null;

/**
 * Initialize and return the database connection
 */
export function initDatabase(config?: Partial<DatabaseConfig>): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const fullConfig: DatabaseConfig = {
    dbPath: config?.dbPath || getDefaultDbPath(),
    walMode: config?.walMode ?? true,
    busyTimeout: config?.busyTimeout ?? 5000,
    enableVectorSearch: config?.enableVectorSearch ?? true,
  };

  // Ensure directory exists
  const dir = path.dirname(fullConfig.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Create database connection
  const db = new Database(fullConfig.dbPath);

  // Apply SQLite configuration (WAL mode, busy_timeout, etc.)
  configureSQLite(db, fullConfig.dbPath);

  // Load sqlite-vec extension if enabled
  if (fullConfig.enableVectorSearch) {
    try {
      sqliteVec.load(db);
    } catch (error) {
      console.warn('Failed to load sqlite-vec extension:', error);
      // Continue without vector search - will fall back to BM25 only
    }
  }

  // Run schema migrations
  runMigrations(db, fullConfig.enableVectorSearch ?? true);

  dbInstance = db;
  return db;
}

/**
 * Get the current database instance (throws if not initialized)
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Run schema migrations
 */
function runMigrations(db: Database.Database, enableVectorSearch: boolean): void {
  // Check current schema version
  const versionTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get() as { name: string } | undefined;

  let currentVersion = 0;
  if (versionTable) {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as 
      { version: number | null } | undefined;
    currentVersion = row?.version ?? 0;
  }

  // Apply migrations if needed
  if (currentVersion < SCHEMA_VERSION) {
    db.exec(SCHEMA_SQL);
    
    // Create vector table if extension is loaded
    if (enableVectorSearch) {
      try {
        db.exec(VECTOR_TABLE_SQL);
      } catch (error) {
        console.warn('Failed to create vector table:', error);
      }
    }
  }
}

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

export function getDatabaseStats(): DatabaseStats {
  const db = getDatabase();
  
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL) as memoryCount,
      (SELECT COUNT(*) FROM entities WHERE deleted_at IS NULL) as entityCount,
      (SELECT COUNT(*) FROM relations) as relationCount,
      (SELECT COUNT(*) FROM file_associations) as fileAssociationCount,
      (SELECT COUNT(*) FROM memories WHERE deleted_at IS NOT NULL) as deletedMemoryCount,
      (SELECT version FROM schema_version ORDER BY version DESC LIMIT 1) as schemaVersion
  `).get() as {
    memoryCount: number;
    entityCount: number;
    relationCount: number;
    fileAssociationCount: number;
    deletedMemoryCount: number;
    schemaVersion: number;
  };

  // Get database file size
  const config = { dbPath: getDefaultDbPath() };
  let dbSizeBytes = 0;
  try {
    const stats = fs.statSync(config.dbPath);
    dbSizeBytes = stats.size;
  } catch {
    // File might not exist yet
  }

  return {
    ...counts,
    dbSizeBytes,
  };
}


// =============================================================================
// Backup/Restore Functions
// =============================================================================

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
export function getBackupDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  const dir = path.join(home, '.just-command', 'backups');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Create a backup of the database
 */
export function backupDatabase(description?: string): BackupInfo {
  const db = getDatabase();
  const backupDir = getBackupDir();
  
  // Generate timestamped filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = description ? `_${description.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30)}` : '';
  const filename = `memory_backup_${timestamp}${suffix}.db`;
  const backupPath = path.join(backupDir, filename);
  
  // Use SQLite's backup API for safe copy
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  
  const stats = fs.statSync(backupPath);
  
  return {
    filename,
    path: backupPath,
    createdAt: new Date().toISOString(),
    sizeBytes: stats.size,
  };
}

/**
 * List available backups
 */
export function listBackups(limit: number = 20): BackupInfo[] {
  const backupDir = getBackupDir();
  
  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.db') && f.startsWith('memory_backup_'))
    .map(filename => {
      const filePath = path.join(backupDir, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        path: filePath,
        createdAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  
  return files;
}

/**
 * Restore database from backup
 */
export function restoreDatabase(backupPath: string): { success: boolean; memoriesRestored: number } {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }
  
  // Close current connection
  closeDatabase();
  
  const dbPath = getDefaultDbPath();
  
  // Create backup of current DB before restore
  const currentBackup = dbPath + '.pre-restore';
  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, currentBackup);
  }
  
  try {
    // Copy backup to main location
    fs.copyFileSync(backupPath, dbPath);
    
    // Reinitialize and count memories
    const db = initDatabase();
    const row = db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL').get() as { count: number };
    
    // Clean up pre-restore backup on success
    if (fs.existsSync(currentBackup)) {
      fs.unlinkSync(currentBackup);
    }
    
    return { success: true, memoriesRestored: row.count };
  } catch (error) {
    // Restore original on failure
    if (fs.existsSync(currentBackup)) {
      fs.copyFileSync(currentBackup, dbPath);
      fs.unlinkSync(currentBackup);
    }
    initDatabase(); // Reinitialize with original
    throw error;
  }
}
