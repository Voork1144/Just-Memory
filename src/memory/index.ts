/**
 * Just-Command Memory Module
 * 
 * Unified exports for memory functionality.
 */

// Database
export { 
  initDatabase, 
  getDatabase, 
  closeDatabase,
  getDefaultDbPath,
  getDatabaseStats,
  getBackupDir,
  backupDatabase,
  restoreDatabase,
  listBackups,
  type DatabaseConfig,
  type DatabaseStats,
  type BackupInfo,
} from './database.js';

// Schema
export { SCHEMA_VERSION, SCHEMA_SQL, VECTOR_TABLE_SQL, DROP_ALL_SQL } from './schema.js';

// Embeddings
export {
  initEmbeddings,
  isEmbeddingsReady,
  getEmbeddingsStatus,
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
  EMBEDDING_CONFIG,
} from './embeddings.js';

// CRUD operations
export {
  storeMemory,
  recallMemory,
  updateMemory,
  deleteMemory,
  recoverMemory,
  purgeMemory,
  listDeletedMemories,
  listRecentMemories,
  linkMemory,
  getMemoryLinks,
  createEntity,
  getEntity,
  listEntities,
  refreshContext,
  type MemoryInput,
  type Memory,
  type MemoryType,
  type MemoryLinkInput,
  type MemoryLink,
  type EntityInput,
  type Entity,
  type RefreshContextResult,
} from './crud.js';

// Search
export {
  searchMemories,
  type SearchOptions,
  type SearchResult,
} from './search.js';

// Decay (D10)
export {
  DECAY_CONFIG,
  calculateRetention,
  getRetentionLevel,
  calculateStrengthBoost,
  calculateDecayRate,
  projectRetention,
  getDecayStatus,
  getDecayStatusSQL,
  getNeedsReviewSQL,
  getAtRiskSQL,
  getArchiveSQL,
  getDeleteArchivedSQL,
  getHealthStatsSQL,
  getStrengthDistributionSQL,
  getBoostStrengthSQL,
  DECAY_TOOLS,
  generateHealthRecommendations,
  type DecayStatus,
  type MemoryHealth,
  type CleanupResult,
} from './decay.js';

// Project Isolation (D15)
export {
  detectProject,
  getGlobalProject,
  setProjectContext,
  getProjectContext,
  setIncludeGlobal,
  getIncludeGlobal,
  setWorkingDirectory,
  getWorkingDirectory,
  resetContext,
  buildProjectFilter,
  resolveProjectIdForStore,
  isGlobalProject,
  getProjectDisplayName,
  listKnownProjects,
  GLOBAL_PROJECT_ID,
  UNKNOWN_PROJECT_ID,
  type ProjectInfo,
  type ProjectQueryOptions,
} from './project-isolation.js';


// Contradiction Detection (TACL 2024)
export {
  detectContradiction,
  checkAndAdjustConfidence,
  flagContradiction,
  resolveContradiction,
  getUnresolvedContradictions,
  getContradictionStats,
  type ContradictionResult,
  type ContradictionType,
  type ContradictionOptions,
} from './contradiction.js';


// Performance Optimization
export {
  generateSearchCacheKey,
  getCachedSearch,
  cacheSearchResults,
  getCachedMemory,
  cacheMemory,
  getCachedEmbedding,
  cacheEmbedding,
  invalidateOnWrite,
  invalidateAllCaches,
  getCacheStats,
  profileQuery,
  profileQueryAsync,
  getQueryProfiles,
  resetQueryProfiles,
  getIndexStats,
  optimizeDatabase,
  createRecommendedIndexes,
  createMemoryBatchInserter,
  runBenchmark,
  getPerformanceRecommendations,
  getPreparedStatement,
  clearPreparedStatements,
  getDatabasePerformanceStats,
  LRUCache,
  type CacheStats,
  type QueryProfile,
  type IndexStats,
  type BatchOperation,
  type BenchmarkResult,
} from './performance.js';
