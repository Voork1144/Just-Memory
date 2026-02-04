"use strict";
/**
 * Just-Memory Performance Optimization
 *
 * Implements performance optimizations for 100K+ memory scale:
 * - Query result caching with TTL
 * - Prepared statement caching
 * - Index optimization utilities
 * - Batch operation support
 * - Query profiling
 * - Hot path optimization
 *
 * Design goals:
 * - Sub-50ms search latency for 100K memories
 * - Minimal memory overhead for cache
 * - Automatic cache invalidation on writes
 *
 * @module performance
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LRUCache = void 0;
exports.generateSearchCacheKey = generateSearchCacheKey;
exports.getCachedSearch = getCachedSearch;
exports.cacheSearchResults = cacheSearchResults;
exports.getCachedMemory = getCachedMemory;
exports.cacheMemory = cacheMemory;
exports.getCachedEmbedding = getCachedEmbedding;
exports.cacheEmbedding = cacheEmbedding;
exports.invalidateOnWrite = invalidateOnWrite;
exports.invalidateAllCaches = invalidateAllCaches;
exports.getCacheStats = getCacheStats;
exports.profileQuery = profileQuery;
exports.profileQueryAsync = profileQueryAsync;
exports.getQueryProfiles = getQueryProfiles;
exports.resetQueryProfiles = resetQueryProfiles;
exports.getIndexStats = getIndexStats;
exports.optimizeDatabase = optimizeDatabase;
exports.createRecommendedIndexes = createRecommendedIndexes;
exports.createMemoryBatchInserter = createMemoryBatchInserter;
exports.runBenchmark = runBenchmark;
exports.getPerformanceRecommendations = getPerformanceRecommendations;
exports.getPreparedStatement = getPreparedStatement;
exports.clearPreparedStatements = clearPreparedStatements;
exports.getDatabasePerformanceStats = getDatabasePerformanceStats;
const database_js_1 = require("./database.js");
/**
 * LRU Cache implementation with TTL
 * Thread-safe via synchronous operations
 */
class LRUCache {
    cache;
    maxSize;
    defaultTtlMs;
    hits = 0;
    misses = 0;
    constructor(maxSize = 1000, defaultTtlMs = 60000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.defaultTtlMs = defaultTtlMs;
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }
        // Check TTL
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }
        // Move to end (most recently used)
        this.cache.delete(key);
        entry.hits++;
        this.cache.set(key, entry);
        this.hits++;
        return entry.value;
    }
    set(key, value, ttlMs) {
        // Evict if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
            hits: 0,
        });
    }
    delete(key) {
        return this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
    /** Invalidate entries matching a pattern */
    invalidatePattern(predicate) {
        let count = 0;
        for (const key of Array.from(this.cache.keys())) {
            if (predicate(key)) {
                this.cache.delete(key);
                count++;
            }
        }
        return count;
    }
    getStats() {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            entries: this.cache.size,
            hitRate: total > 0 ? this.hits / total : 0,
            memoryBytes: this.estimateMemory(),
        };
    }
    estimateMemory() {
        // Rough estimate: 100 bytes per entry base + value size
        return this.cache.size * 100;
    }
}
exports.LRUCache = LRUCache;
// Singleton caches
const searchCache = new LRUCache(500, 30000); // 30s TTL for search
const memoryCache = new LRUCache(1000, 120000); // 2min TTL for single memories
const embeddingCache = new LRUCache(200, 300000); // 5min for embeddings
// Query profiling data
const queryProfiles = new Map();
/**
 * Generate cache key for search queries
 */
function generateSearchCacheKey(query, options) {
    const normalized = query.toLowerCase().trim();
    const optStr = JSON.stringify(options, Object.keys(options).sort());
    return `search:${normalized}:${optStr}`;
}
/**
 * Get cached search results
 */
function getCachedSearch(key) {
    return searchCache.get(key);
}
/**
 * Cache search results
 */
function cacheSearchResults(key, results, ttlMs) {
    searchCache.set(key, results, ttlMs);
}
/**
 * Get cached memory by ID
 */
function getCachedMemory(id) {
    return memoryCache.get(id);
}
/**
 * Cache a memory
 */
function cacheMemory(id, memory, ttlMs) {
    memoryCache.set(id, memory, ttlMs);
}
/**
 * Get cached embedding for content
 */
function getCachedEmbedding(content) {
    const key = `emb:${content.slice(0, 200)}`; // Truncate key
    return embeddingCache.get(key);
}
/**
 * Cache an embedding
 */
function cacheEmbedding(content, embedding) {
    const key = `emb:${content.slice(0, 200)}`;
    embeddingCache.set(key, embedding);
}
/**
 * Invalidate caches on memory write operations
 */
function invalidateOnWrite(memoryId) {
    // Always invalidate search cache (could be affected by any write)
    searchCache.clear();
    // If specific memory, invalidate it
    if (memoryId) {
        memoryCache.delete(memoryId);
    }
}
/**
 * Invalidate all caches (use sparingly)
 */
function invalidateAllCaches() {
    searchCache.clear();
    memoryCache.clear();
    embeddingCache.clear();
}
/**
 * Get cache statistics
 */
function getCacheStats() {
    const search = searchCache.getStats();
    const memory = memoryCache.getStats();
    const embedding = embeddingCache.getStats();
    return {
        search,
        memory,
        embedding,
        total: {
            hits: search.hits + memory.hits + embedding.hits,
            misses: search.misses + memory.misses + embedding.misses,
            entries: search.entries + memory.entries + embedding.entries,
            hitRate: (search.hits + memory.hits + embedding.hits) /
                Math.max(1, search.hits + memory.hits + embedding.hits +
                    search.misses + memory.misses + embedding.misses),
            memoryBytes: search.memoryBytes + memory.memoryBytes + embedding.memoryBytes,
        },
    };
}
/**
 * Profile a query execution
 */
function profileQuery(queryName, fn) {
    const start = performance.now();
    try {
        return fn();
    }
    finally {
        const elapsed = performance.now() - start;
        const existing = queryProfiles.get(queryName);
        if (existing) {
            existing.totalMs += elapsed;
            existing.maxMs = Math.max(existing.maxMs, elapsed);
            existing.minMs = Math.min(existing.minMs, elapsed);
            existing.calls++;
            existing.lastCall = new Date();
        }
        else {
            queryProfiles.set(queryName, {
                totalMs: elapsed,
                maxMs: elapsed,
                minMs: elapsed,
                calls: 1,
                lastCall: new Date(),
            });
        }
    }
}
/**
 * Async query profiler
 */
async function profileQueryAsync(queryName, fn) {
    const start = performance.now();
    try {
        return await fn();
    }
    finally {
        const elapsed = performance.now() - start;
        const existing = queryProfiles.get(queryName);
        if (existing) {
            existing.totalMs += elapsed;
            existing.maxMs = Math.max(existing.maxMs, elapsed);
            existing.minMs = Math.min(existing.minMs, elapsed);
            existing.calls++;
            existing.lastCall = new Date();
        }
        else {
            queryProfiles.set(queryName, {
                totalMs: elapsed,
                maxMs: elapsed,
                minMs: elapsed,
                calls: 1,
                lastCall: new Date(),
            });
        }
    }
}
/**
 * Get query profiles sorted by total time
 */
function getQueryProfiles() {
    const profiles = [];
    for (const [query, data] of queryProfiles) {
        profiles.push({
            query,
            avgMs: data.totalMs / data.calls,
            maxMs: data.maxMs,
            minMs: data.minMs,
            calls: data.calls,
            lastCall: data.lastCall,
        });
    }
    return profiles.sort((a, b) => b.avgMs - a.avgMs);
}
/**
 * Reset query profiles
 */
function resetQueryProfiles() {
    queryProfiles.clear();
}
/**
 * Get all index statistics
 */
function getIndexStats() {
    const db = (0, database_js_1.getDatabase)();
    const indexes = db.prepare(`
    SELECT 
      name,
      tbl_name,
      sql
    FROM sqlite_master 
    WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
  `).all();
    return indexes.map(idx => {
        // Parse columns from SQL
        const columns = [];
        if (idx.sql) {
            const match = idx.sql.match(/\(([^)]+)\)/);
            if (match) {
                const colStr = match[1];
                if (colStr) {
                    columns.push(...colStr.split(',').map(c => c.trim()));
                }
            }
        }
        return {
            name: idx.name,
            tableName: idx.tbl_name,
            isUnique: idx.sql?.includes('UNIQUE') ?? false,
            columns,
            size: 0, // SQLite doesn't expose index size directly
        };
    });
}
/**
 * Optimize database for better query performance
 * Call periodically (e.g., daily) or after large batch imports
 */
function optimizeDatabase() {
    const db = (0, database_js_1.getDatabase)();
    try {
        // Run ANALYZE to update query planner statistics
        db.exec('ANALYZE');
        // Run incremental vacuum if in auto_vacuum mode
        db.exec('PRAGMA incremental_vacuum(100)');
        // Optimize FTS5 index
        try {
            db.exec("INSERT INTO memories_fts(memories_fts) VALUES('optimize')");
        }
        catch {
            // FTS5 table might not exist
        }
        return { analyzed: true, vacuumed: true, optimized: true };
    }
    catch (error) {
        console.error('Database optimization failed:', error);
        return { analyzed: false, vacuumed: false, optimized: false };
    }
}
/**
 * Create recommended indexes for common query patterns
 */
function createRecommendedIndexes() {
    const db = (0, database_js_1.getDatabase)();
    const created = [];
    const indexes = [
        // Fast lookup by type within project
        {
            name: 'idx_memories_project_type',
            sql: 'CREATE INDEX IF NOT EXISTS idx_memories_project_type ON memories(project_id, type) WHERE deleted_at IS NULL',
        },
        // Fast time-based queries
        {
            name: 'idx_memories_created_at',
            sql: 'CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC) WHERE deleted_at IS NULL',
        },
        // Fast confidence-based filtering
        {
            name: 'idx_memories_confidence',
            sql: 'CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence_score DESC) WHERE deleted_at IS NULL',
        },
        // Fast importance-based filtering
        {
            name: 'idx_memories_importance',
            sql: 'CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC) WHERE deleted_at IS NULL',
        },
        // Covering index for search results
        {
            name: 'idx_memories_search_cover',
            sql: 'CREATE INDEX IF NOT EXISTS idx_memories_search_cover ON memories(project_id, deleted_at, created_at DESC) INCLUDE (id, content, type, tags, importance)',
        },
        // Entity lookup
        {
            name: 'idx_entities_project_type',
            sql: 'CREATE INDEX IF NOT EXISTS idx_entities_project_type ON entities(project_id, entity_type)',
        },
    ];
    for (const idx of indexes) {
        try {
            db.exec(idx.sql);
            created.push(idx.name);
        }
        catch (error) {
            // Index might already exist or INCLUDE not supported
            console.warn(`Failed to create index ${idx.name}:`, error);
        }
    }
    return created;
}
/**
 * Create a batch inserter for memories
 */
function createMemoryBatchInserter(batchSize = 100) {
    const db = (0, database_js_1.getDatabase)();
    const queue = [];
    let flushed = 0;
    let errors = 0;
    const stmt = db.prepare(`
    INSERT INTO memories (id, content, type, tags, importance, confidence_score, project_id, embedding, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
    const flush = async () => {
        if (queue.length === 0)
            return;
        const transaction = db.transaction(() => {
            for (const item of queue) {
                try {
                    stmt.run(item.id, item.content, item.type, JSON.stringify(item.tags || []), item.importance || 0.5, item.confidenceScore || 1.0, item.projectId, item.embedding || null);
                    flushed++;
                }
                catch (e) {
                    errors++;
                    console.error('Batch insert error:', e);
                }
            }
        });
        transaction();
        queue.length = 0;
        // Invalidate caches after batch insert
        invalidateOnWrite();
    };
    return {
        add(item) {
            queue.push(item);
            if (queue.length >= batchSize) {
                flush(); // Sync flush for simplicity
            }
        },
        async flush() {
            await flush();
        },
        getStats() {
            return { queued: queue.length, flushed, errors };
        },
    };
}
/**
 * Run a performance benchmark
 */
async function runBenchmark(name, fn, iterations = 100) {
    const times = [];
    // Warmup
    for (let i = 0; i < Math.min(10, iterations / 10); i++) {
        await fn();
    }
    // Actual benchmark
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await fn();
        times.push(performance.now() - start);
    }
    const sum = times.reduce((a, b) => a + b, 0);
    const avg = sum / times.length;
    return {
        name,
        opsPerSecond: 1000 / avg,
        avgMs: avg,
        minMs: Math.min(...times),
        maxMs: Math.max(...times),
        iterations,
    };
}
/**
 * Get performance recommendations based on current stats
 */
function getPerformanceRecommendations() {
    const recommendations = [];
    const cacheStats = getCacheStats();
    const profiles = getQueryProfiles();
    // Check cache hit rates
    if (cacheStats.search.hitRate < 0.3 && cacheStats.search.misses > 100) {
        recommendations.push('Search cache hit rate is low. Consider increasing cache size or TTL.');
    }
    // Check for slow queries
    for (const profile of profiles) {
        if (profile.avgMs > 100) {
            recommendations.push(`Query "${profile.query}" is slow (avg ${profile.avgMs.toFixed(1)}ms). Consider adding indexes.`);
        }
    }
    // Check memory usage
    if (cacheStats.total.memoryBytes > 50_000_000) {
        recommendations.push('Cache memory usage is high. Consider reducing cache sizes.');
    }
    // General recommendations
    if (recommendations.length === 0) {
        recommendations.push('Performance looks good! No immediate optimizations needed.');
    }
    return recommendations;
}
/**
 * Prepared statement cache for frequently used queries
 */
const preparedStatements = new Map();
/**
 * Get or create a prepared statement
 */
function getPreparedStatement(key, sql) {
    if (!preparedStatements.has(key)) {
        const db = (0, database_js_1.getDatabase)();
        preparedStatements.set(key, db.prepare(sql));
    }
    return preparedStatements.get(key);
}
/**
 * Clear prepared statements (call on schema changes)
 */
function clearPreparedStatements() {
    preparedStatements.clear();
}
/**
 * Get database statistics for performance monitoring
 */
function getDatabasePerformanceStats() {
    const db = (0, database_js_1.getDatabase)();
    const pageCount = db.pragma('page_count', true) || 0;
    const pageSize = db.pragma('page_size', true) || 4096;
    const cacheSize = db.pragma('cache_size', true) || -2000;
    let walCheckpoint = null;
    try {
        const result = db.pragma('wal_checkpoint(PASSIVE)');
        if (result && result[0]) {
            walCheckpoint = {
                busy: result[0].busy,
                log: result[0].log,
                checkpointed: result[0].checkpointed,
            };
        }
    }
    catch {
        // WAL might not be enabled
    }
    return { pageCount, pageSize, cacheSize, walCheckpoint };
}
//# sourceMappingURL=performance.js.map