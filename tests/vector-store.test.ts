/**
 * Tests for src/vector-store.ts
 * SqliteVecStore, toHNSWProvider backward compat.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import { SqliteVecStore, toHNSWProvider } from '../src/vector-store.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

before(() => { db = createTestDb(); });
after(() => { db.close(); });

describe('SqliteVecStore', () => {
  it('should report isReady() as true', () => {
    const store = new SqliteVecStore({ db, embeddingDim: 384 });
    assert.strictEqual(store.isReady(), true);
  });

  it('should report backend as sqlite-vec', () => {
    const store = new SqliteVecStore({ db, embeddingDim: 384 });
    assert.strictEqual(store.backend, 'sqlite-vec');
  });

  it('should upsert an embedding', async () => {
    const id = insertTestMemory(db, { content: 'Vector test memory' });
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    await store.upsert(id, embedding, { projectId: 'test-project' });

    const row = db.prepare('SELECT embedding FROM memories WHERE id = ?').get(id) as any;
    assert.ok(row.embedding, 'Embedding should be stored');
    assert.ok(row.embedding instanceof Buffer, 'Should be a Buffer');
  });

  it('should upsertBatch multiple embeddings', async () => {
    const ids = [
      insertTestMemory(db, { content: 'Batch vec 1' }),
      insertTestMemory(db, { content: 'Batch vec 2' }),
      insertTestMemory(db, { content: 'Batch vec 3' }),
    ];
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    const items = ids.map(id => ({
      id,
      embedding: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      metadata: { projectId: 'test-project' },
    }));

    const count = await store.upsertBatch(items);
    assert.strictEqual(count, 3, 'Should upsert all 3 items');
  });

  it('should delete an embedding', async () => {
    const id = insertTestMemory(db, { content: 'Delete vec test' });
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    const embedding = new Float32Array([0.5, 0.6, 0.7, 0.8]);

    await store.upsert(id, embedding, { projectId: 'test-project' });
    await store.delete(id);

    const row = db.prepare('SELECT embedding FROM memories WHERE id = ?').get(id) as any;
    assert.strictEqual(row.embedding, null, 'Embedding should be nulled');
  });

  it('should count embeddings', async () => {
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    const count = await store.count();
    assert.ok(typeof count === 'number', 'Count should be a number');
    assert.ok(count >= 0, 'Count should be non-negative');
  });

  it('should close without error', async () => {
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    await store.close(); // no-op but should not throw
  });

  it('should return undefined from getHNSWSearch when no HNSW configured', () => {
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    assert.strictEqual(store.getHNSWSearch(), undefined);
  });

  it('should return HNSW search when configured and ready', () => {
    const mockSearch = (_e: Float32Array, _l: number, _ef: number) => ['id1', 'id2'];
    const store = new SqliteVecStore({
      db,
      embeddingDim: 4,
      hnswSearch: mockSearch,
      hnswReady: () => true,
    });
    const fn = store.getHNSWSearch();
    assert.ok(fn, 'Should return search function');
    const result = fn!(new Float32Array([0.1, 0.2, 0.3, 0.4]), 5, 100);
    assert.deepStrictEqual(result, ['id1', 'id2']);
  });
});

describe('toHNSWProvider', () => {
  it('should create a provider with isReady and search', () => {
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    const provider = toHNSWProvider(store);
    assert.ok(typeof provider.isReady === 'function');
    assert.ok(typeof provider.search === 'function');
  });

  it('should delegate isReady to store', () => {
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    const provider = toHNSWProvider(store);
    assert.strictEqual(provider.isReady(), true);
  });

  it('should return empty array when no HNSW available', () => {
    const store = new SqliteVecStore({ db, embeddingDim: 4 });
    const provider = toHNSWProvider(store);
    const result = provider.search(new Float32Array([0.1, 0.2, 0.3, 0.4]), 10, 100);
    assert.deepStrictEqual(result, []);
  });

  it('should delegate to HNSW search when available', () => {
    const mockSearch = (_e: Float32Array, _l: number, _ef: number) => ['result1'];
    const store = new SqliteVecStore({
      db,
      embeddingDim: 4,
      hnswSearch: mockSearch,
      hnswReady: () => true,
    });
    const provider = toHNSWProvider(store);
    const result = provider.search(new Float32Array([0.1, 0.2, 0.3, 0.4]), 5, 100);
    assert.deepStrictEqual(result, ['result1']);
  });
});
