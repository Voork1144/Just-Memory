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

import { getDatabase } from './database.js';
import { 
  generateEmbedding, 
  embeddingToBuffer,
  bufferToEmbedding,
  cosineSimilarity,
} from './embeddings.js';
import type { Memory, MemoryType } from './crud.js';

/**
 * Search options
 */
export interface SearchOptions {
  /** Project to search within */
  projectId?: string;
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
 */
export async function searchMemories(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const {
    projectId,
    type,
    limit = 10,
    minScore = 0.1,
    mode = 'hybrid',
    bm25Weight = 0.5,
  } = options;

  // Get results from different search methods based on mode
  let results: SearchResult[];
  
  switch (mode) {
    case 'bm25':
      results = await searchBM25(query, { projectId, type, limit: limit * 2 });
      break;
    case 'vector':
      results = await searchVector(query, { projectId, type, limit: limit * 2 });
      break;
    case 'hybrid':
    default:
      results = await searchHybrid(query, { projectId, type, limit, bm25Weight });
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
async function searchBM25(
  query: string,
  options: { projectId: string | undefined; type: MemoryType | undefined; limit: number }
): Promise<SearchResult[]> {
  const db = getDatabase();
  const { projectId, type, limit } = options;

  // Build WHERE clause
  let whereClause = 'm.deleted_at IS NULL';
  const params: unknown[] = [query];
  
  if (projectId) {
    whereClause += ' AND m.project_id = ?';
    params.push(projectId);
  }
  
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
  `).all(...params) as BM25Row[];

  // Normalize BM25 scores to 0-1 range
  const maxScore = Math.max(...rows.map(r => Math.abs(r.bm25_score)), 1);
  
  return rows.map(row => ({
    memory: rowToMemory(row),
    score: Math.abs(row.bm25_score) / maxScore,
    snippet: createSnippet(row.content, row.match_snippet),
    source: 'bm25' as const,
  }));
}

/**
 * Vector similarity search
 */
async function searchVector(
  query: string,
  options: { projectId: string | undefined; type: MemoryType | undefined; limit: number }
): Promise<SearchResult[]> {
  const db = getDatabase();

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // Check if sqlite-vec is available
  const hasVec = checkVectorTableExists(db);
  
  if (hasVec) {
    // Use sqlite-vec for efficient vector search
    return searchVectorNative(db, queryEmbedding, options);
  } else {
    // Fall back to brute-force similarity calculation
    return searchVectorBruteForce(db, queryEmbedding, options);
  }
}

/**
 * Native vector search using sqlite-vec
 */
function searchVectorNative(
  db: ReturnType<typeof getDatabase>,
  queryEmbedding: Float32Array,
  options: { projectId: string | undefined; type: MemoryType | undefined; limit: number }
): SearchResult[] {
  const { projectId, type, limit } = options;
  
  // Build filter conditions
  let whereClause = 'm.deleted_at IS NULL';
  const params: unknown[] = [];
  
  if (projectId) {
    whereClause += ' AND m.project_id = ?';
    params.push(projectId);
  }
  
  if (type) {
    whereClause += ' AND m.type = ?';
    params.push(type);
  }

  // Query using vec_search (sqlite-vec)
  const queryBuffer = embeddingToBuffer(queryEmbedding);
  
  const rows = db.prepare(`
    SELECT 
      m.*,
      vec_distance_cosine(m.embedding, ?) as distance
    FROM memories m
    WHERE ${whereClause} AND m.embedding IS NOT NULL
    ORDER BY distance ASC
    LIMIT ?
  `).all(queryBuffer, ...params, limit) as VectorRow[];

  return rows.map(row => ({
    memory: rowToMemory(row),
    score: 1 - row.distance, // Convert distance to similarity
    snippet: createSnippet(row.content),
    source: 'vector' as const,
  }));
}

/**
 * Brute-force vector search (fallback when sqlite-vec unavailable)
 */
function searchVectorBruteForce(
  db: ReturnType<typeof getDatabase>,
  queryEmbedding: Float32Array,
  options: { projectId: string | undefined; type: MemoryType | undefined; limit: number }
): SearchResult[] {
  const { projectId, type, limit } = options;

  // Get all memories with embeddings
  let whereClause = 'deleted_at IS NULL AND embedding IS NOT NULL';
  const params: unknown[] = [];
  
  if (projectId) {
    whereClause += ' AND project_id = ?';
    params.push(projectId);
  }
  
  if (type) {
    whereClause += ' AND type = ?';
    params.push(type);
  }

  const rows = db.prepare(`
    SELECT * FROM memories WHERE ${whereClause}
  `).all(...params) as MemoryRow[];

  // Calculate similarities
  const results = rows.map(row => {
    const embedding = row.embedding ? bufferToEmbedding(row.embedding) : null;
    const similarity = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;
    
    return {
      memory: rowToMemory(row),
      score: similarity,
      snippet: createSnippet(row.content),
      source: 'vector' as const,
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
async function searchHybrid(
  query: string,
  options: { projectId: string | undefined; type: MemoryType | undefined; limit: number; bm25Weight: number }
): Promise<SearchResult[]> {
  const { limit, bm25Weight } = options;
  const vectorWeight = 1 - bm25Weight;
  
  // Get results from both methods
  const [bm25Results, vectorResults] = await Promise.all([
    searchBM25(query, { ...options, limit: limit * 3 }),
    searchVector(query, { ...options, limit: limit * 3 }),
  ]);

  // Build rank maps
  const bm25Ranks = new Map<string, number>();
  bm25Results.forEach((r, i) => bm25Ranks.set(r.memory.id, i + 1));
  
  const vectorRanks = new Map<string, number>();
  vectorResults.forEach((r, i) => vectorRanks.set(r.memory.id, i + 1));

  // Collect all unique memory IDs
  const allIds = new Set([
    ...bm25Results.map(r => r.memory.id),
    ...vectorResults.map(r => r.memory.id),
  ]);

  // Calculate RRF scores
  const k = 60; // RRF constant
  const results: SearchResult[] = [];
  
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
    const baseResult = bm25Result ?? vectorResult!;
    
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

function checkVectorTableExists(db: ReturnType<typeof getDatabase>): boolean {
  try {
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'"
    ).get();
    return result !== undefined;
  } catch {
    return false;
  }
}

/**
 * Create a 100-char snippet (D3)
 */
function createSnippet(content: string, matchSnippet?: string): string {
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

interface MemoryRow {
  id: string;
  content: string;
  embedding: Buffer | null;
  type: string;
  source: string | null;
  project_id: string | null;
  tags: string;
  metadata: string;
  importance: number;
  decay_enabled: number;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface BM25Row extends MemoryRow {
  bm25_score: number;
  match_snippet: string;
}

interface VectorRow extends MemoryRow {
  distance: number;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    type: row.type as MemoryType,
    source: row.source,
    projectId: row.project_id,
    tags: JSON.parse(row.tags) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    importance: row.importance,
    decayEnabled: row.decay_enabled === 1,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

// Re-export Memory type for convenience
export type { Memory, MemoryType };
