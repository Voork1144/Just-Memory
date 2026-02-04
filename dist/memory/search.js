"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchMemories = searchMemories;
const database_js_1 = require("./database.js");
const embeddings_js_1 = require("./embeddings.js");
const project_isolation_js_1 = require("./project-isolation.js");
/**
 * Search memories using hybrid approach
 *
 * By default, searches within the current project context (auto-detected)
 * and includes global memories. Use `allProjects: true` for cross-project search.
 */
async function searchMemories(query, options = {}) {
    const { projectId, includeGlobal, allProjects = false, type, limit = 10, minScore = 0.1, mode = 'hybrid', bm25Weight = 0.5, } = options;
    // Build project filter options for query helpers
    const projectOpts = {
        projectId: projectId ?? (0, project_isolation_js_1.getProjectContext)().id,
        includeGlobal: includeGlobal ?? (0, project_isolation_js_1.getIncludeGlobal)(),
        allProjects,
    };
    // Get results from different search methods based on mode
    let results;
    switch (mode) {
        case 'bm25':
            results = await searchBM25(query, { projectOpts, type, limit: limit * 2 });
            break;
        case 'vector':
            results = await searchVector(query, { projectOpts, type, limit: limit * 2 });
            break;
        case 'hybrid':
        default:
            results = await searchHybrid(query, { projectOpts, type, limit, bm25Weight });
            break;
    }
    // Filter by minimum score and limit
    return results
        .filter(r => r.score >= minScore)
        .slice(0, limit);
}
/**
 * BM25 search using FTS5
 */
async function searchBM25(query, options) {
    const db = (0, database_js_1.getDatabase)();
    const { projectOpts, type, limit } = options;
    // Build project filter using isolation helper
    const projectFilter = (0, project_isolation_js_1.buildProjectFilter)(projectOpts, 'm.project_id');
    // Build WHERE clause
    let whereClause = `m.deleted_at IS NULL AND ${projectFilter.clause}`;
    const params = [query, ...projectFilter.params];
    if (type) {
        whereClause += ' AND m.type = ?';
        params.push(type);
    }
    params.push(limit);
    // FTS5 query with BM25 ranking
    const rows = db.prepare(`
    SELECT 
      m.*,
      bm25(memories_fts) as bm25_score,
      snippet(memories_fts, 0, '>>>', '<<<', '...', 20) as match_snippet
    FROM memories_fts fts
    JOIN memories m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ? AND ${whereClause}
    ORDER BY bm25_score
    LIMIT ?
  `).all(...params);
    // Normalize BM25 scores to 0-1 range
    const maxScore = Math.max(...rows.map(r => Math.abs(r.bm25_score)), 1);
    return rows.map(row => ({
        memory: rowToMemory(row),
        score: Math.abs(row.bm25_score) / maxScore,
        snippet: createSnippet(row.content, row.match_snippet),
        source: 'bm25',
    }));
}
/**
 * Vector similarity search
 */
async function searchVector(query, options) {
    const db = (0, database_js_1.getDatabase)();
    // Generate query embedding
    const queryEmbedding = await (0, embeddings_js_1.generateEmbedding)(query);
    // Check if sqlite-vec is available
    const hasVec = checkVectorTableExists(db);
    if (hasVec) {
        // Use sqlite-vec for efficient vector search
        return searchVectorNative(db, queryEmbedding, options);
    }
    else {
        // Fall back to brute-force similarity calculation
        return searchVectorBruteForce(db, queryEmbedding, options);
    }
}
/**
 * Native vector search using sqlite-vec
 */
function searchVectorNative(db, queryEmbedding, options) {
    const { projectOpts, type, limit } = options;
    // Build project filter
    const projectFilter = (0, project_isolation_js_1.buildProjectFilter)(projectOpts, 'm.project_id');
    let whereClause = `m.deleted_at IS NULL AND ${projectFilter.clause}`;
    const params = [...projectFilter.params];
    if (type) {
        whereClause += ' AND m.type = ?';
        params.push(type);
    }
    // Query using vec_search (sqlite-vec)
    const queryBuffer = (0, embeddings_js_1.embeddingToBuffer)(queryEmbedding);
    const rows = db.prepare(`
    SELECT 
      m.*,
      vec_distance_cosine(m.embedding, ?) as distance
    FROM memories m
    WHERE ${whereClause} AND m.embedding IS NOT NULL
    ORDER BY distance ASC
    LIMIT ?
  `).all(queryBuffer, ...params, limit);
    return rows.map(row => ({
        memory: rowToMemory(row),
        score: 1 - row.distance, // Convert distance to similarity
        snippet: createSnippet(row.content),
        source: 'vector',
    }));
}
/**
 * Brute-force vector search (fallback when sqlite-vec unavailable)
 */
function searchVectorBruteForce(db, queryEmbedding, options) {
    const { projectOpts, type, limit } = options;
    // Build project filter
    const projectFilter = (0, project_isolation_js_1.buildProjectFilter)(projectOpts, 'project_id');
    let whereClause = `deleted_at IS NULL AND embedding IS NOT NULL AND ${projectFilter.clause}`;
    const params = [...projectFilter.params];
    if (type) {
        whereClause += ' AND type = ?';
        params.push(type);
    }
    const rows = db.prepare(`
    SELECT * FROM memories WHERE ${whereClause}
  `).all(...params);
    // Calculate similarities
    const results = rows.map(row => {
        const embedding = row.embedding ? (0, embeddings_js_1.bufferToEmbedding)(row.embedding) : null;
        const similarity = embedding ? (0, embeddings_js_1.cosineSimilarity)(queryEmbedding, embedding) : 0;
        return {
            memory: rowToMemory(row),
            score: similarity,
            snippet: createSnippet(row.content),
            source: 'vector',
        };
    });
    // Sort by similarity and limit
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
/**
 * Hybrid search using RRF (Reciprocal Rank Fusion)
 */
async function searchHybrid(query, options) {
    const { projectOpts, type, limit, bm25Weight } = options;
    const vectorWeight = 1 - bm25Weight;
    // Get results from both methods
    const [bm25Results, vectorResults] = await Promise.all([
        searchBM25(query, { projectOpts, type, limit: limit * 3 }),
        searchVector(query, { projectOpts, type, limit: limit * 3 }),
    ]);
    // Build rank maps
    const bm25Ranks = new Map();
    bm25Results.forEach((r, i) => bm25Ranks.set(r.memory.id, i + 1));
    const vectorRanks = new Map();
    vectorResults.forEach((r, i) => vectorRanks.set(r.memory.id, i + 1));
    // Collect all unique memory IDs
    const allIds = new Set([
        ...bm25Results.map(r => r.memory.id),
        ...vectorResults.map(r => r.memory.id),
    ]);
    // Calculate RRF scores
    const k = 60; // RRF constant
    const results = [];
    for (const id of allIds) {
        const bm25Rank = bm25Ranks.get(id);
        const vectorRank = vectorRanks.get(id);
        // RRF formula: score = sum(1 / (k + rank))
        let rrfScore = 0;
        if (bm25Rank !== undefined) {
            rrfScore += bm25Weight / (k + bm25Rank);
        }
        if (vectorRank !== undefined) {
            rrfScore += vectorWeight / (k + vectorRank);
        }
        // Get the memory and snippet from whichever search found it
        const bm25Result = bm25Results.find(r => r.memory.id === id);
        const vectorResult = vectorResults.find(r => r.memory.id === id);
        const baseResult = bm25Result ?? vectorResult;
        results.push({
            memory: baseResult.memory,
            score: rrfScore,
            snippet: bm25Result?.snippet ?? vectorResult?.snippet ?? createSnippet(baseResult.memory.content),
            source: 'hybrid',
        });
    }
    // Normalize scores and sort
    const maxScore = Math.max(...results.map(r => r.score), 0.001);
    return results
        .map(r => ({ ...r, score: r.score / maxScore }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
// =============================================================================
// Helpers
// =============================================================================
function checkVectorTableExists(db) {
    try {
        const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'").get();
        return result !== undefined;
    }
    catch {
        return false;
    }
}
/**
 * Create a 100-char snippet (D3)
 */
function createSnippet(content, matchSnippet) {
    // Use FTS5 snippet if available
    if (matchSnippet) {
        // Clean up FTS5 markers and truncate
        const cleaned = matchSnippet
            .replace(/>>>/g, '**')
            .replace(/<<</g, '**');
        return cleaned.slice(0, 100) + (cleaned.length > 100 ? '...' : '');
    }
    // Otherwise, just truncate content
    return content.slice(0, 100) + (content.length > 100 ? '...' : '');
}
function rowToMemory(row) {
    return {
        id: row.id,
        content: row.content,
        type: row.type,
        source: row.source,
        projectId: row.project_id,
        tags: JSON.parse(row.tags),
        metadata: JSON.parse(row.metadata),
        importance: row.importance,
        decayEnabled: row.decay_enabled === 1,
        lastAccessedAt: row.last_accessed_at,
        accessCount: row.access_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
    };
}
//# sourceMappingURL=search.js.map