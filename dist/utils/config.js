"use strict";
/**
 * Just-Command Server Configuration
 *
 * Returns current server configuration and state.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = getConfig;
const timeout_js_1 = require("./timeout.js");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Get database path (duplicated to avoid circular imports)
 */
function getDbPath() {
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(home, '.just-command', 'memory.db');
}
/**
 * Get backup directory path
 */
function getBackupDirPath() {
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(home, '.just-command', 'backups');
}
/**
 * Get current server configuration
 */
function getConfig() {
    const dbPath = getDbPath();
    const backupDir = getBackupDirPath();
    let dbSizeBytes = 0;
    try {
        if (fs.existsSync(dbPath)) {
            dbSizeBytes = fs.statSync(dbPath).size;
        }
    }
    catch {
        // Ignore
    }
    const claudeDesktopMode = (0, timeout_js_1.isClaudeDesktopMode)();
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
//# sourceMappingURL=config.js.map