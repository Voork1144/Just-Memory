/**
 * Test Database Helper
 * Creates an in-memory SQLite database with the full Just-Memory schema.
 */
import Database from 'better-sqlite3';

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Core tables
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
      updated_at TEXT DEFAULT (datetime('now')),
      embedding BLOB,
      sentiment TEXT DEFAULT 'neutral',
      emotion_intensity REAL DEFAULT 0.0,
      emotion_labels TEXT DEFAULT '[]',
      user_mood TEXT
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

  // Seed default entity types
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Chat ingestion tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      source TEXT NOT NULL,
      source_path TEXT,
      source_session_id TEXT,
      project_context TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      message_count INTEGER DEFAULT 0,
      tool_use_count INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      model TEXT,
      version TEXT,
      raw_hash TEXT,
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source, source_session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      project_id TEXT DEFAULT 'global',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT DEFAULT 'text',
      parent_message_id TEXT,
      sequence_num INTEGER,
      timestamp TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      embedding BLOB,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conv_messages_project ON conversation_messages(project_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_tool_uses (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      project_id TEXT DEFAULT 'global',
      tool_name TEXT NOT NULL,
      input_json TEXT,
      output_text TEXT,
      output_truncated INTEGER DEFAULT 0,
      is_error INTEGER DEFAULT 0,
      duration_ms INTEGER,
      sequence_num INTEGER,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conv_tools_conv ON conversation_tool_uses(conversation_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_sources (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      conversation_id TEXT,
      message_id TEXT,
      tool_use_id TEXT,
      extraction_type TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      extracted_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mem_sources_memory ON memory_sources(memory_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      project_id TEXT DEFAULT 'global',
      summary_type TEXT NOT NULL,
      content TEXT NOT NULL,
      model_used TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      embedding BLOB,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_topics (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
    );

    CREATE TABLE IF NOT EXISTS conversation_topic_links (
      conversation_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      relevance REAL DEFAULT 1.0,
      PRIMARY KEY (conversation_id, topic_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES conversation_topics(id) ON DELETE CASCADE
    );
  `);

  return db;
}

/** Insert a test memory directly (bypasses storeMemory logic for setup). */
export function insertTestMemory(
  db: Database.Database,
  overrides: {
    id?: string;
    project_id?: string;
    content?: string;
    type?: string;
    tags?: string[];
    importance?: number;
    strength?: number;
    confidence?: number;
    access_count?: number;
    last_accessed?: string;
    created_at?: string;
    deleted_at?: string | null;
    source_count?: number;
    contradiction_count?: number;
  } = {}
) {
  const id = overrides.id || `test_${Math.random().toString(36).slice(2, 10)}`;
  const projectId = overrides.project_id || 'test-project';
  const content = overrides.content || 'Test memory content';
  const type = overrides.type || 'note';
  const tags = JSON.stringify(overrides.tags || []);
  const importance = overrides.importance ?? 0.5;
  const strength = overrides.strength ?? 1.0;
  const confidence = overrides.confidence ?? 0.5;
  const accessCount = overrides.access_count ?? 0;
  const lastAccessed = overrides.last_accessed || new Date().toISOString();
  const createdAt = overrides.created_at || new Date().toISOString();
  const deletedAt = overrides.deleted_at ?? null;
  const sourceCount = overrides.source_count ?? 1;
  const contradictionCount = overrides.contradiction_count ?? 0;

  db.prepare(`
    INSERT INTO memories (id, project_id, content, type, tags, importance, strength, confidence,
      access_count, last_accessed, created_at, deleted_at, source_count, contradiction_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, content, type, tags, importance, strength, confidence,
    accessCount, lastAccessed, createdAt, deletedAt, sourceCount, contradictionCount);

  return id;
}
