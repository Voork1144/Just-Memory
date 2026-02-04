"use strict";
/**
 * Just-Command Utility Modules
 *
 * P0 fixes for MCP bug protection and safe operation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = exports.withRetry = exports.verifyDatabaseConfig = exports.closeDatabase = exports.checkpoint = exports.getDatabaseConfig = exports.configureSQLite = exports.initializeDatabase = exports.DEFAULT_CACHE_SIZE = exports.DEFAULT_BUSY_TIMEOUT = exports.escapeForDisplay = exports.sanitizeObjectForJson = exports.hasProblematicChars = exports.quickSanitize = exports.sanitizeForJson = exports.appearsToBeBinary = exports.readFileWithEncoding = exports.suggestEncoding = exports.getExtension = exports.isBinaryFile = exports.TEXT_EXTENSIONS = exports.BINARY_EXTENSIONS = exports.formatFileResponse = exports.enforceResponseLimit = exports.truncateToByteLimit = exports.getByteSize = exports.TRUNCATION_MARKER = exports.WARN_RESPONSE_BYTES = exports.MAX_RESPONSE_BYTES = exports.getTimeoutConfig = exports.TimeoutError = exports.withTimeout = exports.getEffectiveTimeout = exports.isClaudeDesktopMode = exports.MIN_TIMEOUT = exports.DEFAULT_MAX_TIMEOUT = exports.CLAUDE_DESKTOP_MAX_TIMEOUT = void 0;
// P0 Fix #1: Timeout protection (Bug #1)
var timeout_js_1 = require("./timeout.js");
Object.defineProperty(exports, "CLAUDE_DESKTOP_MAX_TIMEOUT", { enumerable: true, get: function () { return timeout_js_1.CLAUDE_DESKTOP_MAX_TIMEOUT; } });
Object.defineProperty(exports, "DEFAULT_MAX_TIMEOUT", { enumerable: true, get: function () { return timeout_js_1.DEFAULT_MAX_TIMEOUT; } });
Object.defineProperty(exports, "MIN_TIMEOUT", { enumerable: true, get: function () { return timeout_js_1.MIN_TIMEOUT; } });
Object.defineProperty(exports, "isClaudeDesktopMode", { enumerable: true, get: function () { return timeout_js_1.isClaudeDesktopMode; } });
Object.defineProperty(exports, "getEffectiveTimeout", { enumerable: true, get: function () { return timeout_js_1.getEffectiveTimeout; } });
Object.defineProperty(exports, "withTimeout", { enumerable: true, get: function () { return timeout_js_1.withTimeout; } });
Object.defineProperty(exports, "TimeoutError", { enumerable: true, get: function () { return timeout_js_1.TimeoutError; } });
Object.defineProperty(exports, "getTimeoutConfig", { enumerable: true, get: function () { return timeout_js_1.getTimeoutConfig; } });
// P0 Fix #2: Response size limit (Bug #2)
var response_limit_js_1 = require("./response-limit.js");
Object.defineProperty(exports, "MAX_RESPONSE_BYTES", { enumerable: true, get: function () { return response_limit_js_1.MAX_RESPONSE_BYTES; } });
Object.defineProperty(exports, "WARN_RESPONSE_BYTES", { enumerable: true, get: function () { return response_limit_js_1.WARN_RESPONSE_BYTES; } });
Object.defineProperty(exports, "TRUNCATION_MARKER", { enumerable: true, get: function () { return response_limit_js_1.TRUNCATION_MARKER; } });
Object.defineProperty(exports, "getByteSize", { enumerable: true, get: function () { return response_limit_js_1.getByteSize; } });
Object.defineProperty(exports, "truncateToByteLimit", { enumerable: true, get: function () { return response_limit_js_1.truncateToByteLimit; } });
Object.defineProperty(exports, "enforceResponseLimit", { enumerable: true, get: function () { return response_limit_js_1.enforceResponseLimit; } });
Object.defineProperty(exports, "formatFileResponse", { enumerable: true, get: function () { return response_limit_js_1.formatFileResponse; } });
// P0 Fix #3: File encoding support (Bug #7)
var file_encoding_js_1 = require("./file-encoding.js");
Object.defineProperty(exports, "BINARY_EXTENSIONS", { enumerable: true, get: function () { return file_encoding_js_1.BINARY_EXTENSIONS; } });
Object.defineProperty(exports, "TEXT_EXTENSIONS", { enumerable: true, get: function () { return file_encoding_js_1.TEXT_EXTENSIONS; } });
Object.defineProperty(exports, "isBinaryFile", { enumerable: true, get: function () { return file_encoding_js_1.isBinaryFile; } });
Object.defineProperty(exports, "getExtension", { enumerable: true, get: function () { return file_encoding_js_1.getExtension; } });
Object.defineProperty(exports, "suggestEncoding", { enumerable: true, get: function () { return file_encoding_js_1.suggestEncoding; } });
Object.defineProperty(exports, "readFileWithEncoding", { enumerable: true, get: function () { return file_encoding_js_1.readFileWithEncoding; } });
Object.defineProperty(exports, "appearsToBeBinary", { enumerable: true, get: function () { return file_encoding_js_1.appearsToBeBinary; } });
// P0 Fix #4: Unicode sanitization (Bug #8)
var sanitize_js_1 = require("./sanitize.js");
Object.defineProperty(exports, "sanitizeForJson", { enumerable: true, get: function () { return sanitize_js_1.sanitizeForJson; } });
Object.defineProperty(exports, "quickSanitize", { enumerable: true, get: function () { return sanitize_js_1.quickSanitize; } });
Object.defineProperty(exports, "hasProblematicChars", { enumerable: true, get: function () { return sanitize_js_1.hasProblematicChars; } });
Object.defineProperty(exports, "sanitizeObjectForJson", { enumerable: true, get: function () { return sanitize_js_1.sanitizeObjectForJson; } });
Object.defineProperty(exports, "escapeForDisplay", { enumerable: true, get: function () { return sanitize_js_1.escapeForDisplay; } });
// P0 Fix #5: SQLite WAL mode (Bug #11)
var sqlite_config_js_1 = require("./sqlite-config.js");
Object.defineProperty(exports, "DEFAULT_BUSY_TIMEOUT", { enumerable: true, get: function () { return sqlite_config_js_1.DEFAULT_BUSY_TIMEOUT; } });
Object.defineProperty(exports, "DEFAULT_CACHE_SIZE", { enumerable: true, get: function () { return sqlite_config_js_1.DEFAULT_CACHE_SIZE; } });
Object.defineProperty(exports, "initializeDatabase", { enumerable: true, get: function () { return sqlite_config_js_1.initializeDatabase; } });
Object.defineProperty(exports, "configureSQLite", { enumerable: true, get: function () { return sqlite_config_js_1.configureSQLite; } });
Object.defineProperty(exports, "getDatabaseConfig", { enumerable: true, get: function () { return sqlite_config_js_1.getDatabaseConfig; } });
Object.defineProperty(exports, "checkpoint", { enumerable: true, get: function () { return sqlite_config_js_1.checkpoint; } });
Object.defineProperty(exports, "closeDatabase", { enumerable: true, get: function () { return sqlite_config_js_1.closeDatabase; } });
Object.defineProperty(exports, "verifyDatabaseConfig", { enumerable: true, get: function () { return sqlite_config_js_1.verifyDatabaseConfig; } });
Object.defineProperty(exports, "withRetry", { enumerable: true, get: function () { return sqlite_config_js_1.withRetry; } });
// Server configuration
var config_js_1 = require("./config.js");
Object.defineProperty(exports, "getConfig", { enumerable: true, get: function () { return config_js_1.getConfig; } });
//# sourceMappingURL=index.js.map