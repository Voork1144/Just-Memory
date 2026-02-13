/**
 * Just-Memory Vector Store Abstraction (v4.0)
 *
 * Unified interface for vector storage and similarity search.
 * Two backends:
 *   - SqliteVecStore: sqlite-vec + optional vectorlite HNSW (current, up to ~50K)
 *   - QdrantStore:    Qdrant sidecar with scalar quantization (1M+)
 *
 * The VectorStore replaces the old HNSWProvider interface with a richer API
 * that handles upsert/delete/search/count operations.
 */
import Database from 'better-sqlite3';
import type { VecScoreRow, CntRow } from './types.js';

// ============================================================================
// Interfaces
// ============================================================================

export interface VectorFilter {
  projectId?: string;
  excludeDeleted?: boolean;
  excludeIds?: string[];
  confidenceThreshold?: number;
}

export interface VectorResult {
  id: string;
  score: number; // 0-1, higher = more similar
}

export interface VectorMetadata {
  projectId: string;
  deleted?: boolean;
}

export interface VectorStore {
  /** Whether the store is initialized and ready for queries */
  isReady(): boolean;

  /** Insert or update a vector by memory ID */
  upsert(id: string, embedding: Float32Array, metadata: VectorMetadata): Promise<void>;

  /** Batch upsert for bulk operations */
  upsertBatch(items: Array<{ id: string; embedding: Float32Array; metadata: VectorMetadata }>): Promise<number>;

  /** Search for nearest neighbors */
  search(query: Float32Array, limit: number, filter?: VectorFilter): Promise<VectorResult[]>;

  /** Delete a vector by memory ID */
  delete(id: string): Promise<void>;

  /** Count total vectors */
  count(): Promise<number>;

  /** Backend name for diagnostics */
  readonly backend: string;

  /** Graceful shutdown */
  close(): Promise<void>;
}

// ============================================================================
// SqliteVecStore — wraps existing sqlite-vec + vectorlite HNSW
// ============================================================================

interface SqliteVecStoreOptions {
  db: Database.Database;
  embeddingDim: number;
  /** If vectorlite is loaded, provide the HNSW search function */
  hnswSearch?: (embedding: Float32Array, limit: number, efSearch: number) => string[];
  hnswReady?: () => boolean;
}

export class SqliteVecStore implements VectorStore {
  readonly backend = 'sqlite-vec';
  private db: Database.Database;
  private _hnswSearch?: (embedding: Float32Array, limit: number, efSearch: number) => string[];
  private _hnswReady: () => boolean;

  constructor(options: SqliteVecStoreOptions) {
    this.db = options.db;
    this._hnswSearch = options.hnswSearch;
    this._hnswReady = options.hnswReady || (() => false);
  }

  /** Public accessor for backward-compat HNSWProvider adapter (avoids unsafe `as any` cast) */
  public getHNSWSearch(): ((embedding: Float32Array, limit: number, efSearch: number) => string[]) | undefined {
    return (this._hnswReady() && this._hnswSearch) ? this._hnswSearch : undefined;
  }

  isReady(): boolean {
    return true; // sqlite-vec is always available if loaded
  }

  async upsert(id: string, embedding: Float32Array, _metadata: VectorMetadata): Promise<void> {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(buffer, id);
  }

  async upsertBatch(items: Array<{ id: string; embedding: Float32Array; metadata: VectorMetadata }>): Promise<number> {
    const stmt = this.db.prepare('UPDATE memories SET embedding = ? WHERE id = ?');
    const tx = this.db.transaction((batch: typeof items) => {
      let count = 0;
      for (const item of batch) {
        const buffer = Buffer.from(item.embedding.buffer, item.embedding.byteOffset, item.embedding.byteLength);
        const result = stmt.run(buffer, item.id);
        if (result.changes > 0) count++;
      }
      return count;
    });
    return tx(items);
  }

  async search(query: Float32Array, limit: number, filter?: VectorFilter): Promise<VectorResult[]> {
    const queryBuffer = Buffer.from(query.buffer, query.byteOffset, query.byteLength);

    // Try HNSW first (O(log n))
    if (this._hnswReady() && this._hnswSearch) {
      const candidateIds = this._hnswSearch(query, limit * 3, 100);
      if (candidateIds.length > 0) {
        const placeholders = candidateIds.map(() => '?').join(',');
        let sql = `
          SELECT m.id, (1 - (vec_distance_cosine(m.embedding, ?) / 2)) as score
          FROM memories m
          WHERE m.embedding IS NOT NULL
          AND m.id IN (${placeholders})
        `;
        const params: (Buffer | string | number)[] = [queryBuffer, ...candidateIds];

        if (filter?.excludeDeleted !== false) {
          sql += ' AND m.deleted_at IS NULL';
        }
        if (filter?.projectId) {
          sql += " AND (m.project_id = ? OR m.project_id = 'global')";
          params.push(filter.projectId);
        }
        if (filter?.confidenceThreshold && filter.confidenceThreshold > 0) {
          sql += ' AND m.confidence >= ?';
          params.push(filter.confidenceThreshold);
        }
        sql += ' ORDER BY score DESC LIMIT ?';
        params.push(limit);

        const rows = this.db.prepare(sql).all(...params) as VecScoreRow[];
        return rows.filter(r => r.score > 0.1).map(r => ({ id: r.id, score: r.score }));
      }
    }

    // Fallback: O(n) full table scan
    let sql = `
      SELECT m.id, (1 - (vec_distance_cosine(m.embedding, ?) / 2)) as score
      FROM memories m
      WHERE m.embedding IS NOT NULL
    `;
    const params: (Buffer | string | number)[] = [queryBuffer];

    if (filter?.excludeDeleted !== false) {
      sql += ' AND m.deleted_at IS NULL';
    }
    if (filter?.projectId) {
      sql += " AND (m.project_id = ? OR m.project_id = 'global')";
      params.push(filter.projectId);
    }
    if (filter?.confidenceThreshold && filter.confidenceThreshold > 0) {
      sql += ' AND m.confidence >= ?';
      params.push(filter.confidenceThreshold);
    }
    sql += ' ORDER BY score DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as VecScoreRow[];
    return rows.filter(r => r.score > 0.1).map(r => ({ id: r.id, score: r.score }));
  }

  async delete(id: string): Promise<void> {
    // Embeddings are stored in the memories table, so deleting the memory handles this.
    // If HNSW is in use, we'd need to remove from the virtual table too.
    this.db.prepare('UPDATE memories SET embedding = NULL WHERE id = ?').run(id);
  }

  async count(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE embedding IS NOT NULL AND deleted_at IS NULL').get() as CntRow;
    return row?.cnt || 0;
  }

  async close(): Promise<void> {
    // No-op for sqlite-vec — DB lifecycle managed by monolith
  }
}

// ============================================================================
// Backward compatibility: HNSWProvider adapter
// ============================================================================

/** Create an HNSWProvider-compatible object from a VectorStore (for modules that still use the old interface) */
export function toHNSWProvider(store: VectorStore): { isReady: () => boolean; search: (embedding: Float32Array, limit: number, efSearch: number) => string[] } {
  return {
    isReady: () => store.isReady(),
    search: (embedding: Float32Array, limit: number, _efSearch: number) => {
      // Synchronous adapter — HNSW search was always sync, but VectorStore is async.
      // For backward compat, we use the underlying sync search if available.
      if (store instanceof SqliteVecStore) {
        const hnswSearch = store.getHNSWSearch();
        if (hnswSearch) return hnswSearch(embedding, limit, _efSearch);
      }
      return [];
    },
  };
}
