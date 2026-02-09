/**
 * Just-Memory Qdrant Vector Store (v4.0)
 *
 * Manages a Qdrant sidecar process and provides the VectorStore interface.
 * Qdrant handles all vector storage and HNSW search at 1M+ scale.
 * SQLite is freed from embedding BLOBs — only structured data.
 *
 * Features:
 * - Auto-downloads Qdrant binary on first use
 * - Spawns as child process on localhost
 * - Scalar quantization (int8) for 4x memory reduction
 * - Filtered search by project_id and deleted status
 * - Graceful shutdown on process exit
 */
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { VectorStore, VectorFilter, VectorResult, VectorMetadata } from './vector-store.js';
import type {
  QdrantPoint, QdrantSearchResult, QdrantCollectionInfoResponse,
  QdrantCollectionConfig, QdrantSearchParams, QdrantFilterCondition, QdrantDeleteSelector,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

export interface QdrantStoreOptions {
  /** Directory for Qdrant binary and data */
  dataDir: string;
  /** Embedding dimensions (384 for e5-small, 1024 for e5-large) */
  embeddingDim: number;
  /** HTTP port (default 6333) */
  port?: number;
  /** Collection name (default 'memories') */
  collection?: string;
  /** Path to pre-installed qdrant binary (skips download) */
  binaryPath?: string;
  /** Connection timeout in ms (default 10000) */
  connectTimeout?: number;
}

// ============================================================================
// QdrantStore Implementation
// ============================================================================

export class QdrantStore implements VectorStore {
  readonly backend = 'qdrant';
  private opts: Required<QdrantStoreOptions>;
  private process: ChildProcess | null = null;
  private _ready = false;
  private _client: QdrantClient | null = null;

  constructor(options: QdrantStoreOptions) {
    this.opts = {
      dataDir: options.dataDir,
      embeddingDim: options.embeddingDim,
      port: options.port || 6333,
      collection: options.collection || 'memories',
      binaryPath: options.binaryPath || join(options.dataDir, 'bin', 'qdrant'),
      connectTimeout: options.connectTimeout || 10000,
    };
  }

  /** Start the Qdrant sidecar and initialize the collection */
  async start(): Promise<boolean> {
    try {
      // Resolve binary from multiple sources
      const binaryPath = await this._resolveBinary();
      if (!binaryPath) {
        console.error('[Just-Memory] Qdrant binary not available, falling back to sqlite-vec');
        return false;
      }
      // Update binaryPath for spawn
      this.opts.binaryPath = binaryPath;

      // Check if Qdrant is already running on this port
      if (await this._healthCheck()) {
        console.error('[Just-Memory] Qdrant already running on port', this.opts.port);
        this._client = new QdrantClient(this.opts.port);
        await this._ensureCollection();
        this._ready = true;
        return true;
      }

      // Ensure storage directories exist
      const storagePath = join(this.opts.dataDir, 'qdrant-storage');
      const snapshotsPath = join(this.opts.dataDir, 'qdrant-snapshots');
      mkdirSync(storagePath, { recursive: true });
      mkdirSync(snapshotsPath, { recursive: true });

      // Spawn Qdrant process
      this.process = spawn(this.opts.binaryPath, [], {
        env: {
          ...process.env,
          QDRANT__SERVICE__HTTP_PORT: String(this.opts.port),
          QDRANT__SERVICE__GRPC_PORT: String(this.opts.port + 1),
          QDRANT__STORAGE__STORAGE_PATH: storagePath,
          QDRANT__STORAGE__SNAPSHOTS_PATH: snapshotsPath,
          // Disable telemetry
          QDRANT__TELEMETRY_DISABLED: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this.process.on('error', (err) => {
        console.error('[Just-Memory] Qdrant process error:', err.message);
        this._ready = false;
      });

      this.process.on('exit', (code) => {
        if (this._ready) {
          console.error('[Just-Memory] Qdrant process exited with code', code);
        }
        this._ready = false;
        this.process = null;
      });

      // Wait for Qdrant to become ready
      const ready = await this._waitForReady();
      if (!ready) {
        console.error('[Just-Memory] Qdrant failed to start within timeout');
        this._kill();
        return false;
      }

      this._client = new QdrantClient(this.opts.port);
      await this._ensureCollection();
      this._ready = true;
      console.error(`[Just-Memory] Qdrant ready on port ${this.opts.port} (${this.opts.embeddingDim}-dim, scalar quantized)`);
      return true;
    } catch (err: unknown) {
      console.error('[Just-Memory] Qdrant startup failed:', err instanceof Error ? err.message : err);
      this._kill();
      return false;
    }
  }

  isReady(): boolean {
    return this._ready && this._client !== null;
  }

  async upsert(id: string, embedding: Float32Array, metadata: VectorMetadata): Promise<void> {
    if (!this._client) throw new Error('Qdrant not ready');
    await this._client.upsert(this.opts.collection, [{
      id,
      vector: Array.from(embedding),
      payload: {
        project_id: metadata.projectId,
        deleted: metadata.deleted || false,
      },
    }]);
  }

  async upsertBatch(items: Array<{ id: string; embedding: Float32Array; metadata: VectorMetadata }>): Promise<number> {
    if (!this._client) throw new Error('Qdrant not ready');
    if (items.length === 0) return 0;

    // Qdrant handles batches natively, but chunk at 100 for safety
    const chunkSize = 100;
    let total = 0;

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const points = chunk.map(item => ({
        id: item.id,
        vector: Array.from(item.embedding),
        payload: {
          project_id: item.metadata.projectId,
          deleted: item.metadata.deleted || false,
        },
      }));
      await this._client.upsert(this.opts.collection, points);
      total += chunk.length;
    }
    return total;
  }

  async search(query: Float32Array, limit: number, filter?: VectorFilter): Promise<VectorResult[]> {
    if (!this._client) return [];

    const mustConditions: QdrantFilterCondition[] = [];
    const mustNotConditions: QdrantFilterCondition[] = [];

    if (filter?.projectId) {
      mustConditions.push({
        key: 'project_id',
        match: { any: [filter.projectId, 'global'] },
      });
    }

    if (filter?.excludeDeleted !== false) {
      mustNotConditions.push({
        key: 'deleted',
        match: { value: true },
      });
    }

    if (filter?.excludeIds && filter.excludeIds.length > 0) {
      mustNotConditions.push({
        has_id: filter.excludeIds,
      });
    }

    // Only include non-empty filter arrays
    const qdrantFilter: { must?: QdrantFilterCondition[]; must_not?: QdrantFilterCondition[] } = {};
    if (mustConditions.length > 0) qdrantFilter.must = mustConditions;
    if (mustNotConditions.length > 0) qdrantFilter.must_not = mustNotConditions;

    const hasFilter = qdrantFilter.must || qdrantFilter.must_not;

    const results = await this._client.search(this.opts.collection, {
      vector: Array.from(query),
      limit,
      score_threshold: 0.3,
      with_payload: false,
      filter: hasFilter ? qdrantFilter : undefined,
    });

    return results.map(r => ({
      id: r.id as string,
      score: r.score,
    }));
  }

  async delete(id: string): Promise<void> {
    if (!this._client) return;
    await this._client.delete(this.opts.collection, { points: [id] });
  }

  async count(): Promise<number> {
    if (!this._client) return 0;
    const info = await this._client.getCollection(this.opts.collection);
    return info.points_count || 0;
  }

  async close(): Promise<void> {
    this._ready = false;
    this._client = null;
    this._kill();
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Resolve Qdrant binary path from multiple sources:
   * 1. JUST_MEMORY_QDRANT_BINARY env var (explicit override)
   * 2. @just-memory/qdrant-{platform} optionalDependency (npm package)
   * 3. Legacy manual location (~/.just-memory/qdrant/bin/qdrant)
   * 4. Download from GitHub releases (lazy fallback)
   */
  private async _resolveBinary(): Promise<string | null> {
    // 1. Explicit override via env var
    if (process.env.JUST_MEMORY_QDRANT_BINARY) {
      const p = process.env.JUST_MEMORY_QDRANT_BINARY;
      if (existsSync(p)) return p;
      console.error(`[Just-Memory] JUST_MEMORY_QDRANT_BINARY set but not found: ${p}`);
    }

    // 2. Installed optionalDependency (@just-memory/qdrant-linux-x64 etc.)
    const platformPkg = `@just-memory/qdrant-${process.platform}-${process.arch}`;
    try {
      const require = createRequire(import.meta.url);
      const pkgDir = dirname(require.resolve(`${platformPkg}/package.json`));
      const binName = process.platform === 'win32' ? 'qdrant.exe' : 'qdrant';
      const bin = join(pkgDir, 'bin', binName);
      if (existsSync(bin)) return bin;
    } catch { /* package not installed */ }

    // 3. Legacy manual location
    if (existsSync(this.opts.binaryPath)) return this.opts.binaryPath;

    // 4. Download fallback
    console.error('[Just-Memory] Qdrant binary not found, downloading...');
    try {
      // Dynamic import of .mjs script — resolve path relative to this file
      const scriptUrl = new URL('../scripts/download-qdrant.mjs', import.meta.url);
      const mod = await import(/* @vite-ignore */ scriptUrl.href) as { downloadQdrant: () => Promise<boolean> };
      await mod.downloadQdrant();
      if (existsSync(this.opts.binaryPath)) return this.opts.binaryPath;
    } catch (err: unknown) {
      console.error('[Just-Memory] Qdrant download failed:', err instanceof Error ? err.message : err);
    }

    return null;
  }

  private async _healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.opts.port}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async _waitForReady(): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < this.opts.connectTimeout) {
      if (await this._healthCheck()) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  private async _ensureCollection(): Promise<void> {
    if (!this._client) return;
    const exists = await this._client.collectionExists(this.opts.collection);
    if (!exists) {
      await this._client.createCollection(this.opts.collection, {
        vectors: {
          size: this.opts.embeddingDim,
          distance: 'Cosine',
          on_disk: true,
        },
        quantization_config: {
          scalar: {
            type: 'int8',
            quantile: 0.99,
            always_ram: true,
          },
        },
        hnsw_config: {
          m: 16,
          ef_construct: 128,
          on_disk: false,
        },
      });

      // Create payload indexes for filtered search
      await this._client.createPayloadIndex(this.opts.collection, 'project_id', 'keyword');
      await this._client.createPayloadIndex(this.opts.collection, 'deleted', 'bool');

      console.error(`[Just-Memory] Created Qdrant collection '${this.opts.collection}' (${this.opts.embeddingDim}-dim, int8 quantized)`);
    }
  }

  private _kill(): void {
    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch { /* ignore */ }
      this.process = null;
    }
  }
}

// ============================================================================
// Minimal Qdrant REST Client (avoids @qdrant/js-client-rest dependency)
// Uses native fetch — no external deps required
// ============================================================================

class QdrantClient {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async collectionExists(name: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/collections/${name}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createCollection(name: string, config: QdrantCollectionConfig): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`createCollection failed: ${res.status} ${await res.text()}`);
  }

  async createPayloadIndex(collection: string, fieldName: string, fieldSchema: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${collection}/index`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_name: fieldName, field_schema: fieldSchema }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      // Ignore "already exists" errors
      if (!text.includes('already exists')) {
        throw new Error(`createPayloadIndex failed: ${res.status} ${text}`);
      }
    }
  }

  async getCollection(name: string): Promise<QdrantCollectionInfoResponse> {
    const res = await fetch(`${this.baseUrl}/collections/${name}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`getCollection failed: ${res.status}`);
    const data = await res.json() as { result: QdrantCollectionInfoResponse };
    return data.result;
  }

  async upsert(collection: string, points: QdrantPoint[]): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${collection}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`);
  }

  async search(collection: string, params: QdrantSearchParams): Promise<QdrantSearchResult[]> {
    const res = await fetch(`${this.baseUrl}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { result: QdrantSearchResult[] };
    return data.result || [];
  }

  async delete(collection: string, selector: QdrantDeleteSelector): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${collection}/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selector),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`delete failed: ${res.status} ${await res.text()}`);
  }
}
