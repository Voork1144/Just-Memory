/**
 * Just-Command Memory Database Schema
 * 
 * Implements decisions:
 * - D1: Basic entities v1 (full Knowledge Graph deferred to v2)
 * - D3: Search returns 100-char snippets (implemented at query time)
 * - D4: Soft delete with recovery (deleted_at column)
 * - D5: Store both absolute/relative paths
 * - D10: Memory decay opt-in (decay_enabled flag)
 * - D15: Project isolation via project_id column
 * - D20: SQLite WAL mode + busy_timeout (in sqlite-config.ts)
 */

/**
 * Schema version for migrations
 */
export const SCHEMA_VERSION = 1;

/**
 * SQL statements to create the memory database schema
 */
export const SCHEMA_SQL = `
-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert initial version if not exists
INSERT OR IGNORE INTO schema_version (version) VALUES (${SCHEMA_VERSION});

-- =============================================================================
-- MEMORIES TABLE
-- Core storage for all memories (facts, events, observations, preferences)
-- =============================================================================
CREATE TABLE IF NOT EXISTS memories (
  -- Primary key
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  -- Content
  content TEXT NOT NULL,
  
  -- Embedding vector (stored as BLOB, 384 dimensions for all-MiniLM-L6-v2)
  embedding BLOB,
  
  -- Type: 'fact', 'event', 'observation', 'preference', 'note', 'decision'
  type TEXT NOT NULL DEFAULT 'fact',
  
  -- Optional: associate memory with a source (file path, URL, etc.)
  source TEXT,
  
  -- Project isolation (D15)
  project_id TEXT,
  
  -- Tags for categorization (JSON array)
  tags TEXT DEFAULT '[]',
  
  -- Arbitrary metadata (JSON object)
  metadata TEXT DEFAULT '{}',
  
  -- Importance score (0.0 to 1.0, higher = more important)
  importance REAL NOT NULL DEFAULT 0.5,
  
  -- Decay settings (D10: opt-in memory decay)
  decay_enabled INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- Soft delete (D4)
  deleted_at TEXT
);

-- Indexes for memories
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at) WHERE deleted_at IS NOT NULL;

-- Full-text search for BM25 ranking
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  tags,
  metadata,
  content='memories',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags, metadata) 
  VALUES (NEW.rowid, NEW.content, NEW.tags, NEW.metadata);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags, metadata) 
  VALUES ('delete', OLD.rowid, OLD.content, OLD.tags, OLD.metadata);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags, metadata) 
  VALUES ('delete', OLD.rowid, OLD.content, OLD.tags, OLD.metadata);
  INSERT INTO memories_fts(rowid, content, tags, metadata) 
  VALUES (NEW.rowid, NEW.content, NEW.tags, NEW.metadata);
END;

-- =============================================================================
-- ENTITIES TABLE (D1: Basic v1)
-- Named things that can be referenced across memories
-- =============================================================================
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  -- Name of the entity (e.g., "John", "ProjectX", "React")
  name TEXT NOT NULL,
  
  -- Type: 'person', 'project', 'technology', 'organization', 'concept', 'place', 'other'
  type TEXT NOT NULL DEFAULT 'other',
  
  -- Description/notes about the entity
  description TEXT,
  
  -- Embedding for semantic search
  embedding BLOB,
  
  -- Project isolation (D15)
  project_id TEXT,
  
  -- Arbitrary metadata (JSON object)
  metadata TEXT DEFAULT '{}',
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- Soft delete (D4)
  deleted_at TEXT,
  
  -- Unique constraint on name within project
  UNIQUE(name, project_id)
);

-- Indexes for entities
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id) WHERE deleted_at IS NULL;

-- =============================================================================
-- RELATIONS TABLE
-- Links between memories and/or entities
-- =============================================================================
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  -- Source: can be memory or entity ID
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('memory', 'entity')),
  
  -- Target: can be memory or entity ID
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('memory', 'entity')),
  
  -- Relation type: 'related_to', 'mentions', 'depends_on', 'precedes', 'follows', etc.
  relation TEXT NOT NULL DEFAULT 'related_to',
  
  -- Optional weight/strength (0.0 to 1.0)
  weight REAL NOT NULL DEFAULT 1.0,
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- Prevent duplicate relations
  UNIQUE(source_id, target_id, relation)
);

-- Indexes for relations
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation);

-- =============================================================================
-- FILE_ASSOCIATIONS TABLE (D5: Store both paths)
-- Links memories to file paths
-- =============================================================================
CREATE TABLE IF NOT EXISTS file_associations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  -- The memory this file is associated with
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  
  -- File paths (D5: store both for resilience)
  absolute_path TEXT NOT NULL,
  relative_path TEXT,
  
  -- Optional: specific location within file
  line_start INTEGER,
  line_end INTEGER,
  
  -- File metadata at time of association
  file_hash TEXT,
  file_size INTEGER,
  file_modified_at TEXT,
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- Prevent duplicate associations
  UNIQUE(memory_id, absolute_path)
);

-- Indexes for file associations
CREATE INDEX IF NOT EXISTS idx_file_assoc_memory ON file_associations(memory_id);
CREATE INDEX IF NOT EXISTS idx_file_assoc_absolute ON file_associations(absolute_path);
CREATE INDEX IF NOT EXISTS idx_file_assoc_relative ON file_associations(relative_path);

-- =============================================================================
-- BACKUPS TABLE (D14: Auto backup on SessionEnd)
-- Track backup history
-- =============================================================================
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  -- Backup file path
  path TEXT NOT NULL,
  
  -- Size in bytes
  size_bytes INTEGER NOT NULL,
  
  -- Counts at time of backup
  memory_count INTEGER NOT NULL DEFAULT 0,
  entity_count INTEGER NOT NULL DEFAULT 0,
  relation_count INTEGER NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Keep only last 10 backups (D14)
CREATE TRIGGER IF NOT EXISTS limit_backups AFTER INSERT ON backups BEGIN
  DELETE FROM backups WHERE id IN (
    SELECT id FROM backups ORDER BY created_at DESC LIMIT -1 OFFSET 10
  );
END;
`;

/**
 * SQL to create vector search virtual table (requires sqlite-vec extension)
 */
export const VECTOR_TABLE_SQL = `
-- Vector similarity search for embeddings
-- Note: This requires the sqlite-vec extension to be loaded first
CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
  embedding float[384]
);
`;

/**
 * SQL to drop all tables (for testing/reset)
 */
export const DROP_ALL_SQL = `
DROP TABLE IF EXISTS backups;
DROP TABLE IF EXISTS file_associations;
DROP TABLE IF EXISTS relations;
DROP TABLE IF EXISTS entities;
DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_ad;
DROP TRIGGER IF EXISTS memories_au;
DROP TABLE IF EXISTS memories_fts;
DROP TABLE IF EXISTS memories;
DROP TABLE IF EXISTS memories_vec;
DROP TABLE IF EXISTS schema_version;
`;
