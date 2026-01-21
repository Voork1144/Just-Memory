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
  type DatabaseConfig,
  type DatabaseStats,
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
  type MemoryInput,
  type Memory,
  type MemoryType,
} from './crud.js';

// Search
export {
  searchMemories,
  type SearchOptions,
  type SearchResult,
} from './search.js';
