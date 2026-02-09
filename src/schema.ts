/**
 * Just-Memory v5.0 — Schema
 * Database schema creation, migrations, FTS5 setup, vectorlite/HNSW init.
 * Extracted from monolith — functions take db parameter, return status.
 */
import Database from 'better-sqlite3';
import { EMBEDDING_DIM } from './config.js';
import type { CountRow } from './types.js';

// ============================================================================
// Migrations
// ============================================================================

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const hasRun = (version: number): boolean =>
    !!(db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version));
  const mark = (version: number, description: string): void => {
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, description) VALUES (?, ?)').run(version, description);
  };

  // Migration 1: Drop unused tables (Phase 5 cleanup)
  if (!hasRun(1)) {
    const unusedTables = ['causal_relationships', 'alternative_outcomes', 'user_intents', 'intent_signals', 'memory_access_sequences', 'memory_coaccess'];
    for (const table of unusedTables) {
      try { db.exec(`DROP TABLE IF EXISTS ${table}`); } catch { /* ignore */ }
    }
    mark(1, 'Drop unused tables: causal_relationships, alternative_outcomes, user_intents, intent_signals, memory_access_sequences, memory_coaccess');
    console.error('[Just-Memory] Migration 1: Dropped 6 unused tables');
  }
}

// ============================================================================
// HNSW / Vectorlite
// ============================================================================

export type SearchHNSWFn = (queryEmbedding: Float32Array, limit?: number, efSearch?: number) => string[];

export interface VectorliteState {
  vectorliteLoaded: boolean;
  hnswIndexReady: boolean;
  searchHNSW: SearchHNSWFn;
}

export async function initVectorlite(db: Database.Database, embeddingDim: number = EMBEDDING_DIM): Promise<VectorliteState> {
  let _vectorliteLoaded = false;
  let hnswIndexReady = false;

  try {
    const vectorlite = await import('vectorlite');
    db.loadExtension(vectorlite.vectorlitePath());
    _vectorliteLoaded = true;
    console.error('[Just-Memory] vectorlite extension loaded');

    // Create HNSW virtual table for fast vector search
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vectorlite(
          embedding float32[${embeddingDim}],
          hnsw(max_elements=100000, ef_construction=200, M=16)
        );
      `);
      hnswIndexReady = true;
      console.error('[Just-Memory] HNSW index ready (vectorlite)');
    } catch (tableErr: unknown) {
      if (tableErr instanceof Error && !tableErr.message.includes('already exists')) {
        console.error('[Just-Memory] HNSW table creation warning:', tableErr.message);
      }
      hnswIndexReady = true;
    }
  } catch (err: unknown) {
    console.error('[Just-Memory] vectorlite not available, using sqlite-vec fallback:', err instanceof Error ? err.message : err);
    _vectorliteLoaded = false;
    hnswIndexReady = false;
  }

  // Create the bound search function
  const searchHNSW: SearchHNSWFn = (queryEmbedding, limit = 10, efSearch = 100): string[] => {
    if (!hnswIndexReady) return [];
    try {
      const queryBuffer = Buffer.from(new Uint8Array(queryEmbedding.buffer));
      const safeEfSearch = Math.max(1, Math.min(1000, Math.floor(Number(efSearch) || 100)));
      db.prepare('SELECT vectorlite_set_ef(?)').run(safeEfSearch);
      const results = db.prepare(`
        SELECT rowid, distance
        FROM memory_vectors
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `).all(queryBuffer, limit) as { rowid: string; distance: number }[];
      return results.map(r => r.rowid);
    } catch (err) {
      console.error(`[Just-Memory] HNSW search failed: ${err}`);
      return [];
    }
  };

  return { vectorliteLoaded: _vectorliteLoaded, hnswIndexReady, searchHNSW };
}

// ============================================================================
// Core Tables
// ============================================================================

export function createCoreTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      content TEXT NOT NULL,
      type TEXT DEFAULT 'note',
      tags TEXT DEFAULT '[]',
      importance REAL DEFAULT 0.5,
      strength REAL DEFAULT 1.0,
      access_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed TEXT DEFAULT (datetime('now')),
      deleted_at TEXT,
      confidence REAL DEFAULT 0.5,
      source_count INTEGER DEFAULT 1,
      contradiction_count INTEGER DEFAULT 0,
      embedding BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      valid_from TEXT DEFAULT (datetime('now')),
      valid_to TEXT,
      confidence REAL DEFAULT 1.0,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (from_id) REFERENCES memories(id),
      FOREIGN KEY (to_id) REFERENCES memories(id)
    );
    CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
    CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation_type);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scratchpad (
      key TEXT NOT NULL,
      project_id TEXT DEFAULT 'global',
      value TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (key, project_id)
    );
    CREATE INDEX IF NOT EXISTS idx_scratchpad_project ON scratchpad(project_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      name TEXT NOT NULL,
      entity_type TEXT DEFAULT 'concept',
      observations TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_relations (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      from_entity TEXT NOT NULL,
      to_entity TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, from_entity, to_entity, relation_type)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_relations_project ON entity_relations(project_id);
    CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_entity);
    CREATE INDEX IF NOT EXISTS idx_entity_relations_to ON entity_relations(to_entity);
  `);

  // Entity type hierarchy table
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_types (
      name TEXT PRIMARY KEY,
      parent_type TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (parent_type) REFERENCES entity_types(name)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_types_parent ON entity_types(parent_type);
  `);

  // Contradiction resolutions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS contradiction_resolutions (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      memory_id_1 TEXT NOT NULL,
      memory_id_2 TEXT NOT NULL,
      resolution_type TEXT DEFAULT 'pending',
      chosen_memory TEXT,
      resolution_note TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id_1) REFERENCES memories(id),
      FOREIGN KEY (memory_id_2) REFERENCES memories(id)
    );
    CREATE INDEX IF NOT EXISTS idx_resolution_project ON contradiction_resolutions(project_id);
    CREATE INDEX IF NOT EXISTS idx_resolution_type ON contradiction_resolutions(resolution_type);
  `);

  // Scheduled tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      title TEXT NOT NULL,
      description TEXT,
      cron_expression TEXT,
      next_run TEXT,
      last_run TEXT,
      status TEXT DEFAULT 'pending',
      recurring INTEGER DEFAULT 0,
      memory_id TEXT,
      action_type TEXT DEFAULT 'reminder',
      action_data TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_project ON scheduled_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_next_run ON scheduled_tasks(next_run);
  `);

  // Tool usage logging table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      arguments TEXT,
      output TEXT,
      success INTEGER DEFAULT 1,
      error TEXT,
      duration_ms INTEGER,
      project_id TEXT DEFAULT 'global',
      timestamp TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp ON tool_calls(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_success ON tool_calls(success);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_project ON tool_calls(project_id);
  `);

  // Composite indexes for hot paths
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_project_active ON memories(project_id, deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_memories_embedding_null ON memories(project_id)
      WHERE deleted_at IS NULL AND embedding IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tool_calls_prune ON tool_calls(timestamp);
  `);

  // Additional indexes for common query patterns
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_global ON memories(project_id)
      WHERE project_id = 'global' AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_memories_type_project ON memories(type, project_id)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_memories_strength ON memories(strength)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_memories_search_order ON memories(project_id, confidence DESC, importance DESC)
      WHERE deleted_at IS NULL;
  `);

  // Migration: Add project_id to existing tables if not present
  try { db.exec('ALTER TABLE memories ADD COLUMN project_id TEXT DEFAULT \'global\''); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE edges ADD COLUMN project_id TEXT DEFAULT \'global\''); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE scratchpad ADD COLUMN project_id TEXT DEFAULT \'global\''); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE entities ADD COLUMN project_id TEXT DEFAULT \'global\''); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE entity_relations ADD COLUMN project_id TEXT DEFAULT \'global\''); } catch { /* column exists */ }

  // Migration: Add emotional context columns
  try { db.exec(`ALTER TABLE memories ADD COLUMN sentiment TEXT DEFAULT 'neutral'`); } catch { /* column exists */ }
  try { db.exec(`ALTER TABLE memories ADD COLUMN emotion_intensity REAL DEFAULT 0.0`); } catch { /* column exists */ }
  try { db.exec(`ALTER TABLE memories ADD COLUMN emotion_labels TEXT DEFAULT '[]'`); } catch { /* column exists */ }
  try { db.exec(`ALTER TABLE memories ADD COLUMN user_mood TEXT`); } catch { /* column exists */ }
  try { db.exec(`ALTER TABLE memories ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`); } catch { /* column exists */ }

  // Index for emotion-based queries
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_sentiment ON memories(sentiment)`); } catch { /* index exists */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_emotion_intensity ON memories(emotion_intensity)`); } catch { /* index exists */ }
}

// ============================================================================
// Entity Type Seeding
// ============================================================================

export function seedEntityTypes(db: Database.Database): void {
  const typeCount = (db.prepare('SELECT COUNT(*) as count FROM entity_types').get() as CountRow).count;
  if (typeCount === 0) {
    const defaultTypes = [
      { name: 'concept', parent: null, description: 'Abstract idea or notion' },
      { name: 'person', parent: null, description: 'Human individual' },
      { name: 'organization', parent: null, description: 'Company, team, or group' },
      { name: 'project', parent: null, description: 'Work initiative or codebase' },
      { name: 'technology', parent: null, description: 'Tool, framework, or language' },
      { name: 'location', parent: null, description: 'Physical or virtual place' },
      { name: 'event', parent: null, description: 'Occurrence in time' },
      { name: 'document', parent: null, description: 'File, specification, or record' },
    ];
    const insertType = db.prepare('INSERT OR IGNORE INTO entity_types (name, parent_type, description) VALUES (?, ?, ?)');
    for (const t of defaultTypes) {
      insertType.run(t.name, t.parent, t.description);
    }
  }
}

// ============================================================================
// Legacy Cleanup
// ============================================================================

export function runLegacyCleanup(db: Database.Database): void {
  // Clean up legacy consolidation_run system memories
  const systemBloatCount = (db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE type = 'system' AND content LIKE '%consolidation_run%'
  `).get() as CountRow | undefined)?.count || 0;

  if (systemBloatCount > 20) {
    console.error(`[Just-Memory] Cleaning up ${systemBloatCount} legacy consolidation_run system memories...`);
    db.exec(`
      DELETE FROM memories
      WHERE type = 'system'
        AND content LIKE '%consolidation_run%'
        AND id NOT IN (
          SELECT id FROM memories
          WHERE type = 'system' AND content LIKE '%consolidation_run%'
          ORDER BY created_at DESC
          LIMIT 10
        )
    `);
    console.error('[Just-Memory] Legacy system memory cleanup complete');
  }
}

// ============================================================================
// FTS5
// ============================================================================

export function initFTS5(db: Database.Database): boolean {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        content,
        project_id UNINDEXED,
        content='memories',
        content_rowid='rowid'
      );
    `);

    // Triggers to keep FTS5 in sync with memories table
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, id, content, project_id) VALUES (new.rowid, new.id, new.content, new.project_id);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, project_id) VALUES ('delete', old.rowid, old.id, old.content, old.project_id);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE OF content ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, project_id) VALUES ('delete', old.rowid, old.id, old.content, old.project_id);
        INSERT INTO memories_fts(rowid, id, content, project_id) VALUES (new.rowid, new.id, new.content, new.project_id);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_fts_softdelete AFTER UPDATE OF deleted_at ON memories
        WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
      BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, project_id) VALUES ('delete', old.rowid, old.id, old.content, old.project_id);
      END;
    `);

    // Backfill: populate FTS5 with existing memories if empty
    const ftsCount = (db.prepare('SELECT COUNT(*) as count FROM memories_fts').get() as CountRow).count;
    const memCount = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL').get() as CountRow).count;
    if (ftsCount === 0 && memCount > 0) {
      console.error(`[Just-Memory] Backfilling FTS5 index with ${memCount} memories...`);
      db.exec(`INSERT INTO memories_fts(rowid, id, content, project_id) SELECT rowid, id, content, project_id FROM memories WHERE deleted_at IS NULL`);
      console.error('[Just-Memory] FTS5 backfill complete');
    }
    return true;
  } catch (err: unknown) {
    console.error('[Just-Memory] FTS5 not available, using LIKE fallback:', err instanceof Error ? err.message : err);
    return false;
  }
}
