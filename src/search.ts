/**
 * Just-Memory Search Functions (v4.0)
 * Keyword (FTS5), semantic (VectorStore), and hybrid search.
 * VectorStore abstraction: uses Qdrant at 1M+ scale, sqlite-vec fallback.
 */
import Database from 'better-sqlite3';
import { safeParse } from './config.js';
import { generateEmbedding } from './models.js';
import { sanitizeLikePattern } from './validation.js';
import { calculateRetention, calculateEffectiveConfidence } from './memory.js';
import type { VectorStore } from './vector-store.js';
import type { MemoryRow, MemoryRowWithSimilarity, MemorySummary } from './types.js';

// Backward compat — still accept HNSWProvider from contradiction.ts
import type { HNSWProvider } from './contradiction.js';

// ============================================================================
// Keyword Search
// ============================================================================

export function keywordSearch(
  db: Database.Database,
  query: string,
  projectId: string,
  limit: number,
  confidenceThreshold: number,
  useFTS5 = false
) {
  const trimmed = query.trim();
  if (!trimmed) return []; // v3.13: empty query returns nothing for keyword search

  let rows: MemoryRow[];

  // v3.13: Use FTS5 for O(1) keyword search with BM25 ranking when available
  if (useFTS5) {
    try {
      // FTS5 query: escape special characters, use implicit AND between terms
      const ftsQuery = trimmed.split(/\s+/).filter(t => t.length > 1).map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
      if (!ftsQuery) return [];

      rows = db.prepare(`
        SELECT m.*, bm25(memories_fts) as fts_rank
        FROM memories_fts fts
        JOIN memories m ON fts.id = m.id
        WHERE memories_fts MATCH ?
        AND m.deleted_at IS NULL
        AND (m.project_id = ? OR m.project_id = 'global')
        ORDER BY fts_rank
        LIMIT ?
      `).all(ftsQuery, projectId, limit * 2) as MemoryRow[];
    } catch {
      // FTS5 query failed (bad syntax etc.) — fall back to LIKE
      const sanitizedQuery = sanitizeLikePattern(trimmed);
      rows = db.prepare(`
        SELECT * FROM memories
        WHERE deleted_at IS NULL
        AND (project_id = ? OR project_id = 'global')
        AND content LIKE ? ESCAPE '\\'
        ORDER BY confidence DESC, importance DESC
        LIMIT ?
      `).all(projectId, `%${sanitizedQuery}%`, limit * 2) as MemoryRow[];
    }
  } else {
    const sanitizedQuery = sanitizeLikePattern(trimmed);
    rows = db.prepare(`
      SELECT * FROM memories
      WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND content LIKE ? ESCAPE '\\'
      ORDER BY confidence DESC, importance DESC
      LIMIT ?
    `).all(projectId, `%${sanitizedQuery}%`, limit * 2) as MemoryRow[];
  }

  // v3.13: Compute actual term-match score instead of hardcoding 1.0
  const queryTerms = trimmed.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  return rows
    .map(m => {
      let keywordScore = 1.0;
      if (queryTerms.length > 0) {
        const contentLower = m.content.toLowerCase();
        const matchCount = queryTerms.filter(t => contentLower.includes(t)).length;
        keywordScore = matchCount / queryTerms.length;
      }
      return { ...m, keywordScore };
    })
    .filter(m => m.keywordScore > 0 && calculateRetention(m.last_accessed, m.strength) > 0.1 && calculateEffectiveConfidence(m) >= confidenceThreshold);
}

// ============================================================================
// Semantic Search (VectorStore-aware)
// ============================================================================

/**
 * Semantic search using VectorStore (Qdrant or sqlite-vec).
 * Falls back to HNSWProvider for backward compatibility, then to full table scan.
 */
export async function semanticSearch(
  db: Database.Database,
  query: string,
  projectId: string,
  limit: number,
  confidenceThreshold: number,
  vectorStoreOrHnsw?: VectorStore | HNSWProvider,
) {
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    console.error('[Just-Memory] Semantic search unavailable - embedder not ready');
    return [];
  }

  try {
    // v4.0: Use VectorStore for O(log n) search when available
    if (vectorStoreOrHnsw && 'search' in vectorStoreOrHnsw && 'backend' in vectorStoreOrHnsw) {
      const store = vectorStoreOrHnsw as VectorStore;
      if (store.isReady()) {
        const results = await store.search(queryEmbedding, limit * 3, {
          projectId,
          excludeDeleted: true,
        });

        if (results.length > 0) {
          // Normalize IDs: Qdrant auto-formats hex strings as hyphenated UUIDs,
          // but SQLite stores them without hyphens
          const ids = results.map(r => r.id.replace(/-/g, ''));
          const placeholders = ids.map(() => '?').join(',');
          const rows = db.prepare(`
            SELECT * FROM memories
            WHERE id IN (${placeholders})
            AND deleted_at IS NULL
          `).all(...ids) as MemoryRow[];

          // Merge scores — use normalized (hyphenless) IDs for lookup
          const scoreMap = new Map(results.map(r => [r.id.replace(/-/g, ''), r.score]));
          return rows
            .map(m => ({ ...m, similarity: scoreMap.get(m.id) || 0 }))
            .filter(m => m.similarity > 0.1 &&
              calculateRetention(m.last_accessed, m.strength) > 0.1 &&
              calculateEffectiveConfidence(m) >= confidenceThreshold)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit * 2);
        }
        // VectorStore returned nothing — fall through to SQLite scan
      }
    }

    // Backward compat: HNSWProvider (sync search)
    if (vectorStoreOrHnsw && 'isReady' in vectorStoreOrHnsw && !('backend' in vectorStoreOrHnsw)) {
      const hnsw = vectorStoreOrHnsw as HNSWProvider;
      if (hnsw.isReady()) {
        const candidateIds = hnsw.search(queryEmbedding, limit * 3, 100);
        if (candidateIds.length > 0) {
          const queryBuffer = Buffer.from(queryEmbedding.buffer);
          const placeholders = candidateIds.map(() => '?').join(',');
          const rows = db.prepare(`
            SELECT m.*, (1 - (vec_distance_cosine(m.embedding, ?) / 2)) as similarity
            FROM memories m
            WHERE m.deleted_at IS NULL
            AND (m.project_id = ? OR m.project_id = 'global')
            AND m.embedding IS NOT NULL
            AND m.id IN (${placeholders})
            ORDER BY similarity DESC
            LIMIT ?
          `).all(queryBuffer, projectId, ...candidateIds, limit * 2) as MemoryRowWithSimilarity[];

          return rows
            .filter(m => m.similarity > 0.1 &&
              calculateRetention(m.last_accessed, m.strength) > 0.1 &&
              calculateEffectiveConfidence(m) >= confidenceThreshold)
            .map(m => ({ ...m, similarity: m.similarity }));
        }
        return [];
      }
    }

    // Fallback: O(n) full table scan via sqlite-vec
    const queryBuffer = Buffer.from(queryEmbedding.buffer);
    const rows = db.prepare(`
      SELECT m.*, (1 - (vec_distance_cosine(m.embedding, ?) / 2)) as similarity
      FROM memories m
      WHERE m.deleted_at IS NULL
      AND (m.project_id = ? OR m.project_id = 'global')
      AND m.embedding IS NOT NULL
      ORDER BY similarity DESC
      LIMIT ?
    `).all(queryBuffer, projectId, limit * 2) as MemoryRowWithSimilarity[];

    return rows
      .filter(m => m.similarity > 0.1 &&
        calculateRetention(m.last_accessed, m.strength) > 0.1 &&
        calculateEffectiveConfidence(m) >= confidenceThreshold)
      .map(m => ({ ...m, similarity: m.similarity }));
  } catch (err) {
    console.error('[Just-Memory] Semantic search error:', err);
    return [];
  }
}

// ============================================================================
// Hybrid Search
// ============================================================================

export async function hybridSearch(
  db: Database.Database,
  query: string,
  projectId: string,
  limit = 10,
  confidenceThreshold = 0,
  vectorStoreOrHnsw?: VectorStore | HNSWProvider,
  useFTS5 = false
): Promise<MemorySummary[]> {
  const [keywordResults, semanticResults] = await Promise.all([
    keywordSearch(db, query, projectId, limit, confidenceThreshold, useFTS5),
    semanticSearch(db, query, projectId, limit, confidenceThreshold, vectorStoreOrHnsw),
  ]);

  const combined = new Map<string, MemoryRow & { keywordScore: number; semanticScore: number }>();

  for (const m of keywordResults) {
    combined.set(m.id, { ...m, keywordScore: m.keywordScore || 1.0, semanticScore: 0 });
  }

  for (const m of semanticResults) {
    const existing = combined.get(m.id);
    if (existing) {
      existing.semanticScore = m.similarity || 0;
    } else {
      combined.set(m.id, { ...m, keywordScore: 0, semanticScore: m.similarity || 0 });
    }
  }

  const results = Array.from(combined.values())
    .map(m => ({
      ...m,
      combinedScore: (m.keywordScore * 0.35) + (m.semanticScore * 0.50) + ((m.importance || 0.5) * 0.15),
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);

  return results.map(m => ({
    id: m.id,
    project_id: m.project_id,
    content: m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content,
    content_truncated: m.content.length > 200,
    type: m.type,
    tags: safeParse(m.tags, []),
    importance: m.importance,
    confidence: calculateEffectiveConfidence(m),
    combinedScore: m.combinedScore,
  }));
}
