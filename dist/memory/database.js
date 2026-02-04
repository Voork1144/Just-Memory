"use strict";
/**
 * Just-Command Memory Database Manager
 *
 * Handles database initialization, connection management, and migrations.
 * Uses better-sqlite3 for synchronous operations with sqlite-vec extension.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultDbPath = getDefaultDbPath;
exports.initDatabase = initDatabase;
exports.getDatabase = getDatabase;
exports.closeDatabase = closeDatabase;
exports.getDatabaseStats = getDatabaseStats;
exports.getBackupDir = getBackupDir;
exports.backupDatabase = backupDatabase;
exports.listBackups = listBackups;
exports.restoreDatabase = restoreDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const sqliteVec = __importStar(require("sqlite-vec"));
const sqlite_config_js_1 = require("../utils/sqlite-config.js");
const schema_js_1 = require("./schema.js");
/**
 * Default database path in user's home directory
 */
function getDefaultDbPath() {
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
let dbInstance = null;
/**
 * Initialize and return the database connection
 */
function initDatabase(config) {
    if (dbInstance) {
        return dbInstance;
    }
    const fullConfig = {
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
    const db = new better_sqlite3_1.default(fullConfig.dbPath);
    // Apply SQLite configuration (WAL mode, busy_timeout, etc.)
    (0, sqlite_config_js_1.configureSQLite)(db, fullConfig.dbPath);
    // Load sqlite-vec extension if enabled
    if (fullConfig.enableVectorSearch) {
        try {
            sqliteVec.load(db);
        }
        catch (error) {
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
function getDatabase() {
    if (!dbInstance) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return dbInstance;
}
/**
 * Close the database connection
 */
function closeDatabase() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}
/**
 * Run schema migrations
 */
function runMigrations(db, enableVectorSearch) {
    // Check current schema version
    const versionTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
        .get();
    let currentVersion = 0;
    if (versionTable) {
        const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get();
        currentVersion = row?.version ?? 0;
    }
    // Apply migrations if needed
    if (currentVersion < schema_js_1.SCHEMA_VERSION) {
        db.exec(schema_js_1.SCHEMA_SQL);
        // Create vector table if extension is loaded
        if (enableVectorSearch) {
            try {
                db.exec(schema_js_1.VECTOR_TABLE_SQL);
            }
            catch (error) {
                console.warn('Failed to create vector table:', error);
            }
        }
    }
}
function getDatabaseStats() {
    const db = getDatabase();
    const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL) as memoryCount,
      (SELECT COUNT(*) FROM entities WHERE deleted_at IS NULL) as entityCount,
      (SELECT COUNT(*) FROM relations) as relationCount,
      (SELECT COUNT(*) FROM file_associations) as fileAssociationCount,
      (SELECT COUNT(*) FROM memories WHERE deleted_at IS NOT NULL) as deletedMemoryCount,
      (SELECT version FROM schema_version ORDER BY version DESC LIMIT 1) as schemaVersion
  `).get();
    // Get database file size
    const config = { dbPath: getDefaultDbPath() };
    let dbSizeBytes = 0;
    try {
        const stats = fs.statSync(config.dbPath);
        dbSizeBytes = stats.size;
    }
    catch {
        // File might not exist yet
    }
    return {
        ...counts,
        dbSizeBytes,
    };
}
/**
 * Get backup directory path
 */
function getBackupDir() {
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
function backupDatabase(description) {
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
function listBackups(limit = 20) {
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
function restoreDatabase(backupPath) {
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
        const row = db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL').get();
        // Clean up pre-restore backup on success
        if (fs.existsSync(currentBackup)) {
            fs.unlinkSync(currentBackup);
        }
        return { success: true, memoriesRestored: row.count };
    }
    catch (error) {
        // Restore original on failure
        if (fs.existsSync(currentBackup)) {
            fs.copyFileSync(currentBackup, dbPath);
            fs.unlinkSync(currentBackup);
        }
        initDatabase(); // Reinitialize with original
        throw error;
    }
}
//# sourceMappingURL=database.js.map