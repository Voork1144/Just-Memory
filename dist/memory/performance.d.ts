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
/** Cache statistics */
export interface CacheStats {
    hits: number;
    misses: number;
    entries: number;
    hitRate: number;
    memoryBytes: number;
}
/** Query profile result */
export interface QueryProfile {
    query: string;
    avgMs: number;
    maxMs: number;
    minMs: number;
    calls: number;
    lastCall: Date;
}
/**
 * LRU Cache implementation with TTL
 * Thread-safe via synchronous operations
 */
declare class LRUCache<K, V> {
    private cache;
    private readonly maxSize;
    private readonly defaultTtlMs;
    private hits;
    private misses;
    constructor(maxSize?: number, defaultTtlMs?: number);
    get(key: K): V | undefined;
    set(key: K, value: V, ttlMs?: number): void;
    delete(key: K): boolean;
    clear(): void;
    /** Invalidate entries matching a pattern */
    invalidatePattern(predicate: (key: K) => boolean): number;
    getStats(): CacheStats;
    private estimateMemory;
}
/**
 * Generate cache key for search queries
 */
export declare function generateSearchCacheKey(query: string, options: Record<string, any>): string;
/**
 * Get cached search results
 */
export declare function getCachedSearch(key: string): any[] | undefined;
/**
 * Cache search results
 */
export declare function cacheSearchResults(key: string, results: any[], ttlMs?: number): void;
/**
 * Get cached memory by ID
 */
export declare function getCachedMemory(id: string): any | undefined;
/**
 * Cache a memory
 */
export declare function cacheMemory(id: string, memory: any, ttlMs?: number): void;
/**
 * Get cached embedding for content
 */
export declare function getCachedEmbedding(content: string): Float32Array | undefined;
/**
 * Cache an embedding
 */
export declare function cacheEmbedding(content: string, embedding: Float32Array): void;
/**
 * Invalidate caches on memory write operations
 */
export declare function invalidateOnWrite(memoryId?: string): void;
/**
 * Invalidate all caches (use sparingly)
 */
export declare function invalidateAllCaches(): void;
/**
 * Get cache statistics
 */
export declare function getCacheStats(): {
    search: CacheStats;
    memory: CacheStats;
    embedding: CacheStats;
    total: CacheStats;
};
/**
 * Profile a query execution
 */
export declare function profileQuery<T>(queryName: string, fn: () => T): T;
/**
 * Async query profiler
 */
export declare function profileQueryAsync<T>(queryName: string, fn: () => Promise<T>): Promise<T>;
/**
 * Get query profiles sorted by total time
 */
export declare function getQueryProfiles(): QueryProfile[];
/**
 * Reset query profiles
 */
export declare function resetQueryProfiles(): void;
/**
 * Index optimization utilities
 */
export interface IndexStats {
    name: string;
    tableName: string;
    isUnique: boolean;
    columns: string[];
    size: number;
}
/**
 * Get all index statistics
 */
export declare function getIndexStats(): IndexStats[];
/**
 * Optimize database for better query performance
 * Call periodically (e.g., daily) or after large batch imports
 */
export declare function optimizeDatabase(): {
    analyzed: boolean;
    vacuumed: boolean;
    optimized: boolean;
};
/**
 * Create recommended indexes for common query patterns
 */
export declare function createRecommendedIndexes(): string[];
/**
 * Batch operation interface for efficient bulk imports
 */
export interface BatchOperation {
    add(item: any): void;
    flush(): Promise<void>;
    getStats(): {
        queued: number;
        flushed: number;
        errors: number;
    };
}
/**
 * Create a batch inserter for memories
 */
export declare function createMemoryBatchInserter(batchSize?: number): BatchOperation;
/**
 * Performance benchmarking utilities
 */
export interface BenchmarkResult {
    name: string;
    opsPerSecond: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    iterations: number;
}
/**
 * Run a performance benchmark
 */
export declare function runBenchmark(name: string, fn: () => void | Promise<void>, iterations?: number): Promise<BenchmarkResult>;
/**
 * Get performance recommendations based on current stats
 */
export declare function getPerformanceRecommendations(): string[];
/**
 * Get or create a prepared statement
 */
export declare function getPreparedStatement(key: string, sql: string): any;
/**
 * Clear prepared statements (call on schema changes)
 */
export declare function clearPreparedStatements(): void;
/**
 * Get database statistics for performance monitoring
 */
export declare function getDatabasePerformanceStats(): {
    pageCount: number;
    pageSize: number;
    cacheSize: number;
    walCheckpoint: {
        busy: number;
        log: number;
        checkpointed: number;
    } | null;
};
export { LRUCache };
//# sourceMappingURL=performance.d.ts.map