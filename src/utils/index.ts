/**
 * Just-Command Utility Modules
 * 
 * P0 fixes for MCP bug protection and safe operation
 */

// P0 Fix #1: Timeout protection (Bug #1)
export {
  CLAUDE_DESKTOP_MAX_TIMEOUT,
  DEFAULT_MAX_TIMEOUT,
  MIN_TIMEOUT,
  isClaudeDesktopMode,
  getEffectiveTimeout,
  withTimeout,
  TimeoutError,
  getTimeoutConfig
} from './timeout.js';

// P0 Fix #2: Response size limit (Bug #2)
export {
  MAX_RESPONSE_BYTES,
  WARN_RESPONSE_BYTES,
  TRUNCATION_MARKER,
  getByteSize,
  truncateToByteLimit,
  enforceResponseLimit,
  formatFileResponse,
  type SizeLimitedResponse
} from './response-limit.js';

// P0 Fix #3: File encoding support (Bug #7)
export {
  type FileEncoding,
  BINARY_EXTENSIONS,
  TEXT_EXTENSIONS,
  isBinaryFile,
  getExtension,
  suggestEncoding,
  readFileWithEncoding,
  appearsToBeBinary,
  type EncodedFileResult
} from './file-encoding.js';

// P0 Fix #4: Unicode sanitization (Bug #8)
export {
  sanitizeForJson,
  quickSanitize,
  hasProblematicChars,
  sanitizeObjectForJson,
  escapeForDisplay,
  type SanitizeOptions
} from './sanitize.js';

// P0 Fix #5: SQLite WAL mode (Bug #11)
export {
  DEFAULT_BUSY_TIMEOUT,
  DEFAULT_CACHE_SIZE,
  initializeDatabase,
  configureSQLite,
  getDatabaseConfig,
  checkpoint,
  closeDatabase,
  verifyDatabaseConfig,
  withRetry,
  type SqliteConfig
} from './sqlite-config.js';


// Server configuration
export {
  getConfig,
  type ServerConfig
} from './config.js';
