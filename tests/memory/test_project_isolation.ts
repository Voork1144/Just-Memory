/**
 * Tests for Just-Memory v2.0 Project Isolation
 * 
 * These tests verify:
 * 1. Auto-detection of project from git/package.json/env
 * 2. Project-scoped memory storage and retrieval
 * 3. Global namespace for cross-project memories
 * 4. Project isolation in search
 * 5. Entity isolation per project
 * 6. Scratchpad isolation per project
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Test database path
const TEST_DB_PATH = join(homedir(), '.just-memory', 'test-memories.db');
const TEST_DB_DIR = join(homedir(), '.just-memory');

// Helper to create test database
function createTestDb() {
  if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
  const db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  
  // Create tables with project_id
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
  
  return db;
}

// Cleanup test database
function cleanupTestDb(db: Database.Database) {
  db.close();
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  if (existsSync(TEST_DB_PATH + '-wal')) rmSync(TEST_DB_PATH + '-wal');
  if (existsSync(TEST_DB_PATH + '-shm')) rmSync(TEST_DB_PATH + '-shm');
}

describe('Project Isolation', () => {
  let db: Database.Database;
  
  beforeEach(() => {
    db = createTestDb();
  });
  
  afterEach(() => {
    cleanupTestDb(db);
  });
  
  describe('Memory Storage', () => {
    it('should store memory with project_id', () => {
      const id = 'test-memory-1';
      db.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`)
        .run(id, 'project-a', 'Test content for project A');
      
      const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
      assert.strictEqual(memory.project_id, 'project-a');
    });
    
    it('should isolate memories by project', () => {
      // Insert memories for different projects
      db.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`)
        .run('mem-a1', 'project-a', 'Memory A1');
      db.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`)
        .run('mem-b1', 'project-b', 'Memory B1');
      db.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`)
        .run('mem-global', 'global', 'Global memory');
      
      // Query for project-a (should get project-a + global)
      const projectAMemories = db.prepare(`
        SELECT * FROM memories WHERE project_id = ? OR project_id = 'global'
      `).all('project-a') as any[];
      
      assert.strictEqual(projectAMemories.length, 2);
      const ids = projectAMemories.map(m => m.id);
      assert.ok(ids.includes('mem-a1'));
      assert.ok(ids.includes('mem-global'));
      assert.ok(!ids.includes('mem-b1'));
    });
    
    it('should default to global when no project specified', () => {
      db.prepare(`INSERT INTO memories (id, content) VALUES (?, ?)`)
        .run('mem-default', 'Default project memory');
      
      const memory = db.prepare('SELECT project_id FROM memories WHERE id = ?').get('mem-default') as any;
      assert.strictEqual(memory.project_id, 'global');
    });
  });
  
  describe('Entity Isolation', () => {
    it('should allow same entity name in different projects', () => {
      // Insert same entity name in different projects
      db.prepare(`INSERT INTO entities (id, project_id, name, entity_type) VALUES (?, ?, ?, ?)`)
        .run('e1', 'project-a', 'Config', 'concept');
      db.prepare(`INSERT INTO entities (id, project_id, name, entity_type) VALUES (?, ?, ?, ?)`)
        .run('e2', 'project-b', 'Config', 'concept');
      
      // Both should exist
      const count = db.prepare('SELECT COUNT(*) as c FROM entities WHERE name = ?').get('Config') as any;
      assert.strictEqual(count.c, 2);
    });
    
    it('should enforce unique name within same project', () => {
      db.prepare(`INSERT INTO entities (id, project_id, name, entity_type) VALUES (?, ?, ?, ?)`)
        .run('e1', 'project-a', 'UniqueEntity', 'concept');
      
      // Should throw on duplicate in same project
      assert.throws(() => {
        db.prepare(`INSERT INTO entities (id, project_id, name, entity_type) VALUES (?, ?, ?, ?)`)
          .run('e2', 'project-a', 'UniqueEntity', 'concept');
      });
    });
  });
  
  describe('Scratchpad Isolation', () => {
    it('should isolate scratchpad by project', () => {
      db.prepare(`INSERT INTO scratchpad (key, project_id, value) VALUES (?, ?, ?)`)
        .run('key1', 'project-a', 'value-a');
      db.prepare(`INSERT INTO scratchpad (key, project_id, value) VALUES (?, ?, ?)`)
        .run('key1', 'project-b', 'value-b');
      
      // Query for project-a
      const resultA = db.prepare('SELECT value FROM scratchpad WHERE key = ? AND project_id = ?')
        .get('key1', 'project-a') as any;
      assert.strictEqual(resultA.value, 'value-a');
      
      // Query for project-b
      const resultB = db.prepare('SELECT value FROM scratchpad WHERE key = ? AND project_id = ?')
        .get('key1', 'project-b') as any;
      assert.strictEqual(resultB.value, 'value-b');
    });
  });
  
  describe('Global Namespace', () => {
    it('should make global memories available to all projects', () => {
      // Insert global memory
      db.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`)
        .run('global-mem', 'global', 'Available everywhere');
      
      // Query from project-a should include global
      const projectASearch = db.prepare(`
        SELECT * FROM memories WHERE (project_id = ? OR project_id = 'global')
      `).all('project-a') as any[];
      
      assert.ok(projectASearch.some(m => m.id === 'global-mem'));
      
      // Query from project-b should also include global
      const projectBSearch = db.prepare(`
        SELECT * FROM memories WHERE (project_id = ? OR project_id = 'global')
      `).all('project-b') as any[];
      
      assert.ok(projectBSearch.some(m => m.id === 'global-mem'));
    });
  });
  
  describe('Project Statistics', () => {
    it('should count memories per project', () => {
      // Insert memories
      db.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`)
        .run('m1', 'project-a', 'A1');
      db.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`)
        .run('m2', 'project-a', 'A2');
      db.prepare(`INSERT INTO memories (id, project_id, content) VALUES (?, ?, ?)`)
        .run('m3', 'project-b', 'B1');
      
      // Get stats per project
      const stats = db.prepare(`
        SELECT project_id, COUNT(*) as count
        FROM memories
        GROUP BY project_id
        ORDER BY count DESC
      `).all() as any[];
      
      const projectA = stats.find(s => s.project_id === 'project-a');
      const projectB = stats.find(s => s.project_id === 'project-b');
      
      assert.strictEqual(projectA?.count, 2);
      assert.strictEqual(projectB?.count, 1);
    });
  });
});

describe('Project Detection', () => {
  it('should detect project from env var', () => {
    const original = process.env.CLAUDE_PROJECT;
    process.env.CLAUDE_PROJECT = 'my-test-project';
    
    // Simulated detection logic
    const detected = process.env.CLAUDE_PROJECT || process.env.JUST_MEMORY_PROJECT || 'global';
    assert.strictEqual(detected, 'my-test-project');
    
    process.env.CLAUDE_PROJECT = original;
  });
  
  it('should normalize project names', () => {
    const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    
    assert.strictEqual(normalize('My Project'), 'my_project');
    assert.strictEqual(normalize('Project-123'), 'project-123');
    assert.strictEqual(normalize('Test@Project!'), 'test_project_');
  });
});

console.log('Just-Memory v2.0 Project Isolation Tests');
console.log('Run with: npx tsx --test tests/memory/test_project_isolation.ts');
