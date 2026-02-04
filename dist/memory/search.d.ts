/**
 * Just-Command Memory Search
 *
 * Implements hybrid search combining:
 * - BM25 (keyword matching via FTS5)
 * - Vector similarity (semantic matching via sqlite-vec)
 * - RRF (Reciprocal Rank Fusion) for combining results
 *
 * Decision D3: Search returns 100-char snippets
 */
import type { Memory, MemoryType } from './crud.js';
/**
 * Search options
 */
export interface SearchOptions {
    /** Project to search within (auto-detected if not specified) */
    projectId?: string;
    /** Include global memories in search (default: true, uses session setting) */
    includeGlobal?: boolean;
    /** Search across all projects (admin mode) */
    allProjects?: boolean;
    /** Filter by memory type */
    type?: MemoryType;
    /** Maximum results to return */
    limit?: number;
    /** Minimum relevance score (0-1) */
    minScore?: number;
    /** Search mode: 'hybrid', 'bm25', 'vector' */
    mode?: 'hybrid' | 'bm25' | 'vector';
    /** Weight for BM25 in hybrid mode (0-1, default 0.5) */
    bm25Weight?: number;
    /** Include soft-deleted memories in results */
    includeDeleted?: boolean;
}
/**
 * Search result with relevance score and snippet
 */
export interface SearchResult {
    memory: Memory;
    /** Relevance score (0-1) */
    score: number;
    /** 100-char snippet with match highlighted (D3) */
    snippet: string;
    /** Which search method found this result */
    source: 'bm25' | 'vector' | 'hybrid';
}
/**
 * Search memories using hybrid approach
 *
 * By default, searches within the current project context (auto-detected)
 * and includes global memories. Use `allProjects: true` for cross-project search.
 */
export declare function searchMemories(query: string, options?: SearchOptions): Promise<SearchResult[]>;
export type { Memory, MemoryType };
//# sourceMappingURL=search.d.ts.map