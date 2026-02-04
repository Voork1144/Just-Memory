"use strict";
/**
 * Just-Command Memory Module
 *
 * Unified exports for memory functionality.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHealthStatsSQL = exports.getDeleteArchivedSQL = exports.getArchiveSQL = exports.getAtRiskSQL = exports.getNeedsReviewSQL = exports.getDecayStatusSQL = exports.getDecayStatus = exports.projectRetention = exports.calculateDecayRate = exports.calculateStrengthBoost = exports.getRetentionLevel = exports.calculateRetention = exports.DECAY_CONFIG = exports.searchMemories = exports.refreshContext = exports.listEntities = exports.getEntity = exports.createEntity = exports.getMemoryLinks = exports.linkMemory = exports.listRecentMemories = exports.listDeletedMemories = exports.purgeMemory = exports.recoverMemory = exports.deleteMemory = exports.updateMemory = exports.recallMemory = exports.storeMemory = exports.EMBEDDING_CONFIG = exports.bufferToEmbedding = exports.embeddingToBuffer = exports.cosineSimilarity = exports.generateEmbeddings = exports.generateEmbedding = exports.getEmbeddingsStatus = exports.isEmbeddingsReady = exports.initEmbeddings = exports.DROP_ALL_SQL = exports.VECTOR_TABLE_SQL = exports.SCHEMA_SQL = exports.SCHEMA_VERSION = exports.listBackups = exports.restoreDatabase = exports.backupDatabase = exports.getBackupDir = exports.getDatabaseStats = exports.getDefaultDbPath = exports.closeDatabase = exports.getDatabase = exports.initDatabase = void 0;
exports.LRUCache = exports.getDatabasePerformanceStats = exports.clearPreparedStatements = exports.getPreparedStatement = exports.getPerformanceRecommendations = exports.runBenchmark = exports.createMemoryBatchInserter = exports.createRecommendedIndexes = exports.optimizeDatabase = exports.getIndexStats = exports.resetQueryProfiles = exports.getQueryProfiles = exports.profileQueryAsync = exports.profileQuery = exports.getCacheStats = exports.invalidateAllCaches = exports.invalidateOnWrite = exports.cacheEmbedding = exports.getCachedEmbedding = exports.cacheMemory = exports.getCachedMemory = exports.cacheSearchResults = exports.getCachedSearch = exports.generateSearchCacheKey = exports.getContradictionStats = exports.getUnresolvedContradictions = exports.resolveContradiction = exports.flagContradiction = exports.checkAndAdjustConfidence = exports.detectContradiction = exports.UNKNOWN_PROJECT_ID = exports.GLOBAL_PROJECT_ID = exports.listKnownProjects = exports.getProjectDisplayName = exports.isGlobalProject = exports.resolveProjectIdForStore = exports.buildProjectFilter = exports.resetContext = exports.getWorkingDirectory = exports.setWorkingDirectory = exports.getIncludeGlobal = exports.setIncludeGlobal = exports.getProjectContext = exports.setProjectContext = exports.getGlobalProject = exports.detectProject = exports.generateHealthRecommendations = exports.DECAY_TOOLS = exports.getBoostStrengthSQL = exports.getStrengthDistributionSQL = void 0;
// Database
var database_js_1 = require("./database.js");
Object.defineProperty(exports, "initDatabase", { enumerable: true, get: function () { return database_js_1.initDatabase; } });
Object.defineProperty(exports, "getDatabase", { enumerable: true, get: function () { return database_js_1.getDatabase; } });
Object.defineProperty(exports, "closeDatabase", { enumerable: true, get: function () { return database_js_1.closeDatabase; } });
Object.defineProperty(exports, "getDefaultDbPath", { enumerable: true, get: function () { return database_js_1.getDefaultDbPath; } });
Object.defineProperty(exports, "getDatabaseStats", { enumerable: true, get: function () { return database_js_1.getDatabaseStats; } });
Object.defineProperty(exports, "getBackupDir", { enumerable: true, get: function () { return database_js_1.getBackupDir; } });
Object.defineProperty(exports, "backupDatabase", { enumerable: true, get: function () { return database_js_1.backupDatabase; } });
Object.defineProperty(exports, "restoreDatabase", { enumerable: true, get: function () { return database_js_1.restoreDatabase; } });
Object.defineProperty(exports, "listBackups", { enumerable: true, get: function () { return database_js_1.listBackups; } });
// Schema
var schema_js_1 = require("./schema.js");
Object.defineProperty(exports, "SCHEMA_VERSION", { enumerable: true, get: function () { return schema_js_1.SCHEMA_VERSION; } });
Object.defineProperty(exports, "SCHEMA_SQL", { enumerable: true, get: function () { return schema_js_1.SCHEMA_SQL; } });
Object.defineProperty(exports, "VECTOR_TABLE_SQL", { enumerable: true, get: function () { return schema_js_1.VECTOR_TABLE_SQL; } });
Object.defineProperty(exports, "DROP_ALL_SQL", { enumerable: true, get: function () { return schema_js_1.DROP_ALL_SQL; } });
// Embeddings
var embeddings_js_1 = require("./embeddings.js");
Object.defineProperty(exports, "initEmbeddings", { enumerable: true, get: function () { return embeddings_js_1.initEmbeddings; } });
Object.defineProperty(exports, "isEmbeddingsReady", { enumerable: true, get: function () { return embeddings_js_1.isEmbeddingsReady; } });
Object.defineProperty(exports, "getEmbeddingsStatus", { enumerable: true, get: function () { return embeddings_js_1.getEmbeddingsStatus; } });
Object.defineProperty(exports, "generateEmbedding", { enumerable: true, get: function () { return embeddings_js_1.generateEmbedding; } });
Object.defineProperty(exports, "generateEmbeddings", { enumerable: true, get: function () { return embeddings_js_1.generateEmbeddings; } });
Object.defineProperty(exports, "cosineSimilarity", { enumerable: true, get: function () { return embeddings_js_1.cosineSimilarity; } });
Object.defineProperty(exports, "embeddingToBuffer", { enumerable: true, get: function () { return embeddings_js_1.embeddingToBuffer; } });
Object.defineProperty(exports, "bufferToEmbedding", { enumerable: true, get: function () { return embeddings_js_1.bufferToEmbedding; } });
Object.defineProperty(exports, "EMBEDDING_CONFIG", { enumerable: true, get: function () { return embeddings_js_1.EMBEDDING_CONFIG; } });
// CRUD operations
var crud_js_1 = require("./crud.js");
Object.defineProperty(exports, "storeMemory", { enumerable: true, get: function () { return crud_js_1.storeMemory; } });
Object.defineProperty(exports, "recallMemory", { enumerable: true, get: function () { return crud_js_1.recallMemory; } });
Object.defineProperty(exports, "updateMemory", { enumerable: true, get: function () { return crud_js_1.updateMemory; } });
Object.defineProperty(exports, "deleteMemory", { enumerable: true, get: function () { return crud_js_1.deleteMemory; } });
Object.defineProperty(exports, "recoverMemory", { enumerable: true, get: function () { return crud_js_1.recoverMemory; } });
Object.defineProperty(exports, "purgeMemory", { enumerable: true, get: function () { return crud_js_1.purgeMemory; } });
Object.defineProperty(exports, "listDeletedMemories", { enumerable: true, get: function () { return crud_js_1.listDeletedMemories; } });
Object.defineProperty(exports, "listRecentMemories", { enumerable: true, get: function () { return crud_js_1.listRecentMemories; } });
Object.defineProperty(exports, "linkMemory", { enumerable: true, get: function () { return crud_js_1.linkMemory; } });
Object.defineProperty(exports, "getMemoryLinks", { enumerable: true, get: function () { return crud_js_1.getMemoryLinks; } });
Object.defineProperty(exports, "createEntity", { enumerable: true, get: function () { return crud_js_1.createEntity; } });
Object.defineProperty(exports, "getEntity", { enumerable: true, get: function () { return crud_js_1.getEntity; } });
Object.defineProperty(exports, "listEntities", { enumerable: true, get: function () { return crud_js_1.listEntities; } });
Object.defineProperty(exports, "refreshContext", { enumerable: true, get: function () { return crud_js_1.refreshContext; } });
// Search
var search_js_1 = require("./search.js");
Object.defineProperty(exports, "searchMemories", { enumerable: true, get: function () { return search_js_1.searchMemories; } });
// Decay (D10)
var decay_js_1 = require("./decay.js");
Object.defineProperty(exports, "DECAY_CONFIG", { enumerable: true, get: function () { return decay_js_1.DECAY_CONFIG; } });
Object.defineProperty(exports, "calculateRetention", { enumerable: true, get: function () { return decay_js_1.calculateRetention; } });
Object.defineProperty(exports, "getRetentionLevel", { enumerable: true, get: function () { return decay_js_1.getRetentionLevel; } });
Object.defineProperty(exports, "calculateStrengthBoost", { enumerable: true, get: function () { return decay_js_1.calculateStrengthBoost; } });
Object.defineProperty(exports, "calculateDecayRate", { enumerable: true, get: function () { return decay_js_1.calculateDecayRate; } });
Object.defineProperty(exports, "projectRetention", { enumerable: true, get: function () { return decay_js_1.projectRetention; } });
Object.defineProperty(exports, "getDecayStatus", { enumerable: true, get: function () { return decay_js_1.getDecayStatus; } });
Object.defineProperty(exports, "getDecayStatusSQL", { enumerable: true, get: function () { return decay_js_1.getDecayStatusSQL; } });
Object.defineProperty(exports, "getNeedsReviewSQL", { enumerable: true, get: function () { return decay_js_1.getNeedsReviewSQL; } });
Object.defineProperty(exports, "getAtRiskSQL", { enumerable: true, get: function () { return decay_js_1.getAtRiskSQL; } });
Object.defineProperty(exports, "getArchiveSQL", { enumerable: true, get: function () { return decay_js_1.getArchiveSQL; } });
Object.defineProperty(exports, "getDeleteArchivedSQL", { enumerable: true, get: function () { return decay_js_1.getDeleteArchivedSQL; } });
Object.defineProperty(exports, "getHealthStatsSQL", { enumerable: true, get: function () { return decay_js_1.getHealthStatsSQL; } });
Object.defineProperty(exports, "getStrengthDistributionSQL", { enumerable: true, get: function () { return decay_js_1.getStrengthDistributionSQL; } });
Object.defineProperty(exports, "getBoostStrengthSQL", { enumerable: true, get: function () { return decay_js_1.getBoostStrengthSQL; } });
Object.defineProperty(exports, "DECAY_TOOLS", { enumerable: true, get: function () { return decay_js_1.DECAY_TOOLS; } });
Object.defineProperty(exports, "generateHealthRecommendations", { enumerable: true, get: function () { return decay_js_1.generateHealthRecommendations; } });
// Project Isolation (D15)
var project_isolation_js_1 = require("./project-isolation.js");
Object.defineProperty(exports, "detectProject", { enumerable: true, get: function () { return project_isolation_js_1.detectProject; } });
Object.defineProperty(exports, "getGlobalProject", { enumerable: true, get: function () { return project_isolation_js_1.getGlobalProject; } });
Object.defineProperty(exports, "setProjectContext", { enumerable: true, get: function () { return project_isolation_js_1.setProjectContext; } });
Object.defineProperty(exports, "getProjectContext", { enumerable: true, get: function () { return project_isolation_js_1.getProjectContext; } });
Object.defineProperty(exports, "setIncludeGlobal", { enumerable: true, get: function () { return project_isolation_js_1.setIncludeGlobal; } });
Object.defineProperty(exports, "getIncludeGlobal", { enumerable: true, get: function () { return project_isolation_js_1.getIncludeGlobal; } });
Object.defineProperty(exports, "setWorkingDirectory", { enumerable: true, get: function () { return project_isolation_js_1.setWorkingDirectory; } });
Object.defineProperty(exports, "getWorkingDirectory", { enumerable: true, get: function () { return project_isolation_js_1.getWorkingDirectory; } });
Object.defineProperty(exports, "resetContext", { enumerable: true, get: function () { return project_isolation_js_1.resetContext; } });
Object.defineProperty(exports, "buildProjectFilter", { enumerable: true, get: function () { return project_isolation_js_1.buildProjectFilter; } });
Object.defineProperty(exports, "resolveProjectIdForStore", { enumerable: true, get: function () { return project_isolation_js_1.resolveProjectIdForStore; } });
Object.defineProperty(exports, "isGlobalProject", { enumerable: true, get: function () { return project_isolation_js_1.isGlobalProject; } });
Object.defineProperty(exports, "getProjectDisplayName", { enumerable: true, get: function () { return project_isolation_js_1.getProjectDisplayName; } });
Object.defineProperty(exports, "listKnownProjects", { enumerable: true, get: function () { return project_isolation_js_1.listKnownProjects; } });
Object.defineProperty(exports, "GLOBAL_PROJECT_ID", { enumerable: true, get: function () { return project_isolation_js_1.GLOBAL_PROJECT_ID; } });
Object.defineProperty(exports, "UNKNOWN_PROJECT_ID", { enumerable: true, get: function () { return project_isolation_js_1.UNKNOWN_PROJECT_ID; } });
// Contradiction Detection (TACL 2024)
var contradiction_js_1 = require("./contradiction.js");
Object.defineProperty(exports, "detectContradiction", { enumerable: true, get: function () { return contradiction_js_1.detectContradiction; } });
Object.defineProperty(exports, "checkAndAdjustConfidence", { enumerable: true, get: function () { return contradiction_js_1.checkAndAdjustConfidence; } });
Object.defineProperty(exports, "flagContradiction", { enumerable: true, get: function () { return contradiction_js_1.flagContradiction; } });
Object.defineProperty(exports, "resolveContradiction", { enumerable: true, get: function () { return contradiction_js_1.resolveContradiction; } });
Object.defineProperty(exports, "getUnresolvedContradictions", { enumerable: true, get: function () { return contradiction_js_1.getUnresolvedContradictions; } });
Object.defineProperty(exports, "getContradictionStats", { enumerable: true, get: function () { return contradiction_js_1.getContradictionStats; } });
// Performance Optimization
var performance_js_1 = require("./performance.js");
Object.defineProperty(exports, "generateSearchCacheKey", { enumerable: true, get: function () { return performance_js_1.generateSearchCacheKey; } });
Object.defineProperty(exports, "getCachedSearch", { enumerable: true, get: function () { return performance_js_1.getCachedSearch; } });
Object.defineProperty(exports, "cacheSearchResults", { enumerable: true, get: function () { return performance_js_1.cacheSearchResults; } });
Object.defineProperty(exports, "getCachedMemory", { enumerable: true, get: function () { return performance_js_1.getCachedMemory; } });
Object.defineProperty(exports, "cacheMemory", { enumerable: true, get: function () { return performance_js_1.cacheMemory; } });
Object.defineProperty(exports, "getCachedEmbedding", { enumerable: true, get: function () { return performance_js_1.getCachedEmbedding; } });
Object.defineProperty(exports, "cacheEmbedding", { enumerable: true, get: function () { return performance_js_1.cacheEmbedding; } });
Object.defineProperty(exports, "invalidateOnWrite", { enumerable: true, get: function () { return performance_js_1.invalidateOnWrite; } });
Object.defineProperty(exports, "invalidateAllCaches", { enumerable: true, get: function () { return performance_js_1.invalidateAllCaches; } });
Object.defineProperty(exports, "getCacheStats", { enumerable: true, get: function () { return performance_js_1.getCacheStats; } });
Object.defineProperty(exports, "profileQuery", { enumerable: true, get: function () { return performance_js_1.profileQuery; } });
Object.defineProperty(exports, "profileQueryAsync", { enumerable: true, get: function () { return performance_js_1.profileQueryAsync; } });
Object.defineProperty(exports, "getQueryProfiles", { enumerable: true, get: function () { return performance_js_1.getQueryProfiles; } });
Object.defineProperty(exports, "resetQueryProfiles", { enumerable: true, get: function () { return performance_js_1.resetQueryProfiles; } });
Object.defineProperty(exports, "getIndexStats", { enumerable: true, get: function () { return performance_js_1.getIndexStats; } });
Object.defineProperty(exports, "optimizeDatabase", { enumerable: true, get: function () { return performance_js_1.optimizeDatabase; } });
Object.defineProperty(exports, "createRecommendedIndexes", { enumerable: true, get: function () { return performance_js_1.createRecommendedIndexes; } });
Object.defineProperty(exports, "createMemoryBatchInserter", { enumerable: true, get: function () { return performance_js_1.createMemoryBatchInserter; } });
Object.defineProperty(exports, "runBenchmark", { enumerable: true, get: function () { return performance_js_1.runBenchmark; } });
Object.defineProperty(exports, "getPerformanceRecommendations", { enumerable: true, get: function () { return performance_js_1.getPerformanceRecommendations; } });
Object.defineProperty(exports, "getPreparedStatement", { enumerable: true, get: function () { return performance_js_1.getPreparedStatement; } });
Object.defineProperty(exports, "clearPreparedStatements", { enumerable: true, get: function () { return performance_js_1.clearPreparedStatements; } });
Object.defineProperty(exports, "getDatabasePerformanceStats", { enumerable: true, get: function () { return performance_js_1.getDatabasePerformanceStats; } });
Object.defineProperty(exports, "LRUCache", { enumerable: true, get: function () { return performance_js_1.LRUCache; } });
//# sourceMappingURL=index.js.map