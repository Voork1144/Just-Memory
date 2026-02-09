/**
 * Tests for src/schema.ts
 * Table creation, FTS5 init, migration idempotency, legacy cleanup, entity type seeding.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  runMigrations,
  createCoreTables,
  seedEntityTypes,
  runLegacyCleanup,
  initFTS5,
} from '../src/schema.js';

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName) as { count: number };
  return row.count > 0;
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='index' AND name=?"
  ).get(indexName) as { count: number };
  return row.count > 0;
}

function rowCount(db: Database.Database, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

describe('runMigrations', () => {
  let db: Database.Database;
  before(() => { db = new Database(':memory:'); });
  after(() => { db.close(); });

  it('should create schema_migrations table', () => {
    runMigrations(db);
    assert.ok(tableExists(db, 'schema_migrations'));
  });

  it('should record migration 1', () => {
    const row = db.prepare('SELECT version, description FROM schema_migrations WHERE version = 1').get() as { version: number; description: string } | undefined;
    assert.ok(row);
    assert.strictEqual(row.version, 1);
    assert.ok(row.description.includes('unused tables'));
  });

  it('should be idempotent', () => {
    assert.doesNotThrow(() => { runMigrations(db); runMigrations(db); });
  });

  it('should not duplicate migration entries on re-run', () => {
    const count = rowCount(db, 'schema_migrations');
    runMigrations(db);
    assert.strictEqual(rowCount(db, 'schema_migrations'), count);
  });
});

describe('createCoreTables', () => {
  let db: Database.Database;
  before(() => { db = new Database(':memory:'); createCoreTables(db); });
  after(() => { db.close(); });

  it('should create memories table', () => { assert.ok(tableExists(db, 'memories')); });
  it('should create edges table', () => { assert.ok(tableExists(db, 'edges')); });
  it('should create scratchpad table', () => { assert.ok(tableExists(db, 'scratchpad')); });
  it('should create entities table', () => { assert.ok(tableExists(db, 'entities')); });
  it('should create entity_relations table', () => { assert.ok(tableExists(db, 'entity_relations')); });
  it('should create entity_types table', () => { assert.ok(tableExists(db, 'entity_types')); });
  it('should create contradiction_resolutions table', () => { assert.ok(tableExists(db, 'contradiction_resolutions')); });
  it('should create scheduled_tasks table', () => { assert.ok(tableExists(db, 'scheduled_tasks')); });
  it('should create tool_calls table', () => { assert.ok(tableExists(db, 'tool_calls')); });

  it('should create core indexes on memories', () => {
    assert.ok(indexExists(db, 'idx_memories_project'));
    assert.ok(indexExists(db, 'idx_memories_type'));
    assert.ok(indexExists(db, 'idx_memories_deleted'));
    assert.ok(indexExists(db, 'idx_memories_confidence'));
  });

  it('should be idempotent', () => {
    assert.doesNotThrow(() => { createCoreTables(db); });
  });

  it('should support inserting a memory row', () => {
    db.prepare("INSERT INTO memories (id, project_id, content, type) VALUES ('test-1', 'global', 'test content', 'note')").run();
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get('test-1') as Record<string, unknown>;
    assert.ok(row);
    assert.strictEqual(row.content, 'test content');
  });
});

describe('seedEntityTypes', () => {
  let db: Database.Database;
  before(() => { db = new Database(':memory:'); createCoreTables(db); });
  after(() => { db.close(); });

  it('should seed 8 default entity types', () => {
    seedEntityTypes(db);
    assert.strictEqual(rowCount(db, 'entity_types'), 8);
  });

  it('should include all expected type names', () => {
    const types = db.prepare('SELECT name FROM entity_types ORDER BY name').all() as { name: string }[];
    const names = types.map(t => t.name);
    for (const n of ['concept', 'person', 'project', 'technology', 'organization', 'location', 'event', 'document']) {
      assert.ok(names.includes(n), `Missing: ${n}`);
    }
  });

  it('should not duplicate on re-run', () => {
    seedEntityTypes(db);
    seedEntityTypes(db);
    assert.strictEqual(rowCount(db, 'entity_types'), 8);
  });
});

describe('initFTS5', () => {
  let db: Database.Database;
  before(() => { db = new Database(':memory:'); createCoreTables(db); });
  after(() => { db.close(); });

  it('should create FTS5 virtual table', () => {
    assert.strictEqual(initFTS5(db), true);
    assert.ok(tableExists(db, 'memories_fts'));
  });

  it('should be idempotent', () => {
    assert.strictEqual(initFTS5(db), true);
  });

  it('should create sync triggers', () => {
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memories_fts%'").all() as { name: string }[];
    const names = triggers.map(t => t.name);
    assert.ok(names.includes('memories_fts_insert'));
    assert.ok(names.includes('memories_fts_delete'));
    assert.ok(names.includes('memories_fts_update'));
    assert.ok(names.includes('memories_fts_softdelete'));
  });

  it('should populate FTS5 via trigger on insert', () => {
    db.prepare("INSERT INTO memories (id, project_id, content, type) VALUES ('fts-1', 'global', 'Hello world memory', 'note')").run();
    const ftsCount = (db.prepare('SELECT COUNT(*) as count FROM memories_fts').get() as { count: number }).count;
    assert.ok(ftsCount >= 1);
  });
});

describe('Full schema lifecycle', () => {
  let db: Database.Database;
  before(() => { db = new Database(':memory:'); });
  after(() => { db.close(); });

  it('should run complete setup without errors', () => {
    assert.doesNotThrow(() => {
      createCoreTables(db);
      runMigrations(db);
      seedEntityTypes(db);
      initFTS5(db);
      runLegacyCleanup(db);
    });
  });

  it('should run complete setup twice (idempotent)', () => {
    assert.doesNotThrow(() => {
      createCoreTables(db);
      runMigrations(db);
      seedEntityTypes(db);
      initFTS5(db);
      runLegacyCleanup(db);
    });
  });
});
