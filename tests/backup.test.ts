/**
 * Tests for src/backup.ts
 * Backup creation, restore (merge/replace), path traversal, schema validation, cleanup.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import { backupMemories, restoreMemories, listBackups, cleanupOldBackups, needsAutoBackup } from '../src/backup.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const projectId = 'test-project';
let testBackupDir: string;

before(() => {
  testBackupDir = join(tmpdir(), `jm-backup-test-${Date.now()}`);
  mkdirSync(testBackupDir, { recursive: true });
});

after(() => {
  db?.close();
  try { rmSync(testBackupDir, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  db = createTestDb();
});

describe('backupMemories', () => {
  it('should create a backup file with correct structure', () => {
    insertTestMemory(db, { id: 'mem1', project_id: projectId, content: 'hello world' });
    insertTestMemory(db, { id: 'mem2', project_id: projectId, content: 'second memory' });

    const result = backupMemories(db, projectId, testBackupDir);
    assert.ok(result.filename, 'Should return filename');
    assert.ok(result.filepath, 'Should return filepath');
    assert.strictEqual(result.counts.memories, 2);

    // Verify file content
    const content = JSON.parse(readFileSync(result.filepath, 'utf-8'));
    assert.strictEqual(content.version, '5.0.0');
    assert.strictEqual(content.project_id, projectId);
    assert.ok(content.data.memories);
    assert.strictEqual(content.data.memories.length, 2);
  });

  it('should include entities and edges in backup', () => {
    insertTestMemory(db, { id: 'mem1', project_id: projectId });

    db.prepare(`INSERT INTO entities (id, project_id, name, entity_type) VALUES (?, ?, ?, ?)`).run('ent1', projectId, 'TestEntity', 'concept');
    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type) VALUES (?, ?, ?, ?, ?)`).run('edge1', projectId, 'mem1', 'mem1', 'self');

    const result = backupMemories(db, projectId, testBackupDir);
    assert.strictEqual(result.counts.entities, 1);
    assert.strictEqual(result.counts.edges, 1);
  });

  it('should exclude soft-deleted memories', () => {
    insertTestMemory(db, { id: 'active', project_id: projectId, content: 'active' });
    insertTestMemory(db, { id: 'deleted', project_id: projectId, content: 'deleted', deleted_at: new Date().toISOString() });

    const result = backupMemories(db, projectId, testBackupDir);
    assert.strictEqual(result.counts.memories, 1);
  });

  it('should create backup directory if it does not exist', () => {
    const newDir = join(testBackupDir, 'subdir-' + Date.now());
    insertTestMemory(db, { id: 'mem1', project_id: projectId });
    const result = backupMemories(db, projectId, newDir);
    assert.ok(existsSync(newDir));
    assert.ok(result.filepath);
  });
});

describe('restoreMemories', () => {
  function createValidBackupFile(memories: any[], dir?: string) {
    const backupDir = dir || testBackupDir;
    const filename = `backup_test_${Date.now()}.json`;
    const filepath = join(backupDir, filename);
    const backup = {
      version: '4.3.1',
      project_id: projectId,
      created_at: new Date().toISOString(),
      counts: { memories: memories.length, entities: 0, relations: 0, edges: 0 },
      data: {
        memories: memories.map((m, i) => ({
          id: m.id || `restore_${i}`,
          content: m.content || `restored memory ${i}`,
          type: m.type || 'note',
          tags: m.tags || '[]',
          importance: m.importance ?? 0.5,
          confidence: m.confidence ?? 0.5,
          source_count: 1,
          contradiction_count: 0,
          created_at: new Date().toISOString(),
        })),
        entities: [],
        relations: [],
        edges: [],
      },
    };
    writeFileSync(filepath, JSON.stringify(backup));
    return filepath;
  }

  it('should restore memories in merge mode (INSERT OR IGNORE)', () => {
    const filepath = createValidBackupFile([
      { id: 'r1', content: 'restored 1' },
      { id: 'r2', content: 'restored 2' },
    ]);

    const result = restoreMemories(db, filepath, 'merge', projectId, projectId, testBackupDir);
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.restored.memories, 2);

    const rows = db.prepare('SELECT * FROM memories WHERE project_id = ?').all(projectId);
    assert.strictEqual(rows.length, 2);
  });

  it('should skip existing IDs in merge mode', () => {
    insertTestMemory(db, { id: 'existing', project_id: projectId, content: 'original' });

    const filepath = createValidBackupFile([
      { id: 'existing', content: 'should be ignored' },
      { id: 'new1', content: 'new memory' },
    ]);

    const result = restoreMemories(db, filepath, 'merge', projectId, projectId, testBackupDir);
    assert.strictEqual(result.restored.memories, 1); // only new1

    const existing = db.prepare('SELECT content FROM memories WHERE id = ?').get('existing') as any;
    assert.strictEqual(existing.content, 'original'); // not overwritten
  });

  it('should clear and replace in replace mode', () => {
    insertTestMemory(db, { id: 'old1', project_id: projectId, content: 'old' });

    const filepath = createValidBackupFile([
      { id: 'new1', content: 'replacement' },
    ]);

    const result = restoreMemories(db, filepath, 'replace', projectId, projectId, testBackupDir);
    assert.strictEqual(result.restored.memories, 1);

    const all = db.prepare('SELECT * FROM memories WHERE project_id = ?').all(projectId);
    assert.strictEqual(all.length, 1);
    assert.strictEqual((all[0] as any).id, 'new1');
  });

  it('should return error for missing file', () => {
    const result = restoreMemories(db, '/nonexistent/backup.json', 'merge', projectId, projectId, testBackupDir);
    assert.ok(result.error);
    assert.match(result.error, /not found/i);
  });

  it('should reject path traversal (file outside backup dir)', () => {
    const outsideDir = join(tmpdir(), `jm-outside-${Date.now()}`);
    mkdirSync(outsideDir, { recursive: true });
    const outsideFile = join(outsideDir, 'evil.json');
    writeFileSync(outsideFile, JSON.stringify({ version: '4.3.1', data: { memories: [] } }));

    const result = restoreMemories(db, outsideFile, 'merge', projectId, projectId, testBackupDir);
    assert.ok(result.error);
    assert.match(result.error, /within the backup directory/i);

    try { rmSync(outsideDir, { recursive: true, force: true }); } catch {}
  });

  it('should reject invalid JSON', () => {
    const filepath = join(testBackupDir, `bad_${Date.now()}.json`);
    writeFileSync(filepath, 'not valid json {{{');

    const result = restoreMemories(db, filepath, 'merge', projectId, projectId, testBackupDir);
    assert.ok(result.error);
    assert.match(result.error, /Invalid backup file format/i);
  });

  it('should reject valid JSON without data section', () => {
    const filepath = join(testBackupDir, `nodata_${Date.now()}.json`);
    writeFileSync(filepath, JSON.stringify({ version: '4.3.1', notData: true }));

    const result = restoreMemories(db, filepath, 'merge', projectId, projectId, testBackupDir);
    assert.ok(result.error);
    assert.match(result.error, /missing data section/i);
  });

  it('should reject valid JSON without version', () => {
    const filepath = join(testBackupDir, `noversion_${Date.now()}.json`);
    writeFileSync(filepath, JSON.stringify({ data: { memories: [] } }));

    const result = restoreMemories(db, filepath, 'merge', projectId, projectId, testBackupDir);
    assert.ok(result.error);
    assert.match(result.error, /missing version/i);
  });

  it('should include re-embedding note when memories lack embeddings', () => {
    const filepath = createValidBackupFile([
      { id: 'noEmbed1', content: 'needs embedding' },
    ]);

    const result = restoreMemories(db, filepath, 'merge', projectId, projectId, testBackupDir);
    assert.ok(result.note);
    assert.match(result.note, /re-embedding/i);
  });
});

describe('listBackups', () => {
  it('should list backup files sorted newest first', () => {
    const dir = join(testBackupDir, `list-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, 'backup1.json'), '{}');
    // Small delay to ensure different timestamps
    writeFileSync(join(dir, 'backup2.json'), '{}');

    const result = listBackups(dir);
    assert.strictEqual(result.backups.length, 2);
    assert.ok(result.backups[0].filename);
    assert.ok(result.backups[0].size >= 0);
  });

  it('should return empty list for nonexistent directory', () => {
    const result = listBackups('/nonexistent/path');
    assert.deepStrictEqual(result.backups, []);
  });
});

describe('cleanupOldBackups', () => {
  it('should keep only keepCount newest backups', () => {
    const dir = join(testBackupDir, `cleanup-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    // Create 5 backup files with slightly different names
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `backup_test_${Date.now() + i}.json`), `{"i":${i}}`);
    }

    const result = cleanupOldBackups(dir, 2);
    assert.strictEqual(result.removed.length, 3);
    assert.strictEqual(result.kept, 2);

    const remaining = readdirSync(dir).filter(f => f.endsWith('.json'));
    assert.strictEqual(remaining.length, 2);
  });

  it('should not remove anything if under keepCount', () => {
    const dir = join(testBackupDir, `noclean-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, 'backup_test_1.json'), '{}');

    const result = cleanupOldBackups(dir, 10);
    assert.strictEqual(result.removed.length, 0);
    assert.strictEqual(result.kept, 1);
  });

  it('should handle nonexistent directory', () => {
    const result = cleanupOldBackups('/nonexistent/dir', 10);
    assert.deepStrictEqual(result.removed, []);
    assert.strictEqual(result.kept, 0);
  });
});

describe('needsAutoBackup', () => {
  it('should return true for nonexistent directory', () => {
    assert.strictEqual(needsAutoBackup('/nonexistent/dir'), true);
  });

  it('should return true for empty directory', () => {
    const dir = join(testBackupDir, `empty-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    assert.strictEqual(needsAutoBackup(dir), true);
  });

  it('should return false if recent backup exists', () => {
    const dir = join(testBackupDir, `recent-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'backup_test_recent.json'), '{}');
    assert.strictEqual(needsAutoBackup(dir), false);
  });
});
