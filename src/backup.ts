/**
 * Just-Memory v4.3 — Backup/Restore
 * Memory backup, restore, listing, and cleanup operations.
 * Extracted from monolith — pure functions with db parameter injection.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, realpathSync } from 'fs';
import { join, resolve, sep } from 'path';
import { BACKUP_DIR } from './config.js';

// ============================================================================
// Backup
// ============================================================================

export function backupMemories(db: Database.Database, projectId: string, backupDir = BACKUP_DIR) {
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup_${projectId}_${timestamp}.json`;
  const filepath = join(backupDir, filename);

  const memories = db.prepare('SELECT id, project_id, content, type, tags, importance, confidence, source_count, contradiction_count, created_at FROM memories WHERE deleted_at IS NULL AND (project_id = ? OR project_id = \'global\')').all(projectId);
  const entities = db.prepare('SELECT * FROM entities WHERE project_id = ? OR project_id = \'global\'').all(projectId);
  const relations = db.prepare('SELECT * FROM entity_relations WHERE project_id = ? OR project_id = \'global\'').all(projectId);
  const edges = db.prepare('SELECT id, project_id, from_id, to_id, relation_type, confidence, metadata, valid_from, valid_to FROM edges WHERE project_id = ? OR project_id = \'global\'').all(projectId);

  const backup = {
    version: '4.3.3',
    project_id: projectId,
    created_at: new Date().toISOString(),
    counts: {
      memories: memories.length,
      entities: entities.length,
      relations: relations.length,
      edges: edges.length
    },
    data: { memories, entities, relations, edges }
  };

  writeFileSync(filepath, JSON.stringify(backup, null, 2));

  // Cleanup old backups (keep last 10)
  const cleanup = cleanupOldBackups(backupDir, 10);

  return { filename, filepath, counts: backup.counts, cleanup };
}

// ============================================================================
// Restore
// ============================================================================

export function restoreMemories(
  db: Database.Database,
  backupPath: string,
  mode = 'merge',
  targetProject?: string,
  currentProjectId?: string,
  backupDir = BACKUP_DIR,
) {
  if (!existsSync(backupPath)) {
    return { error: 'Backup file not found', path: backupPath };
  }

  // Path traversal protection: resolve symlinks and verify within BACKUP_DIR
  const resolvedBackupDir = resolve(backupDir);
  let realPath: string;
  try {
    realPath = realpathSync(backupPath);
  } catch {
    return { error: 'Cannot resolve backup path (broken symlink or missing file)', path: backupPath };
  }
  if (!realPath.startsWith(resolvedBackupDir + sep) && realPath !== resolvedBackupDir) {
    return { error: 'Backup path must be within the backup directory', path: backupPath };
  }

  // Validate file size to prevent DoS from huge backup files
  const MAX_BACKUP_SIZE = 100 * 1024 * 1024; // 100MB limit
  const stats = statSync(realPath);
  if (stats.size > MAX_BACKUP_SIZE) {
    return {
      error: 'Backup file too large',
      path: backupPath,
      size: stats.size,
      maxSize: MAX_BACKUP_SIZE
    };
  }

  let backup;
  try {
    backup = JSON.parse(readFileSync(realPath, 'utf-8'));
  } catch (parseError: any) {
    return { error: 'Invalid backup file format', path: backupPath, details: parseError.message };
  }

  // Validate backup schema
  if (!backup || typeof backup !== 'object' || !backup.data) {
    return { error: 'Invalid backup: missing data section', path: backupPath };
  }
  if (!backup.version) {
    return { error: 'Invalid backup: missing version', path: backupPath };
  }
  const project = targetProject || backup.project_id || currentProjectId;

  // Wrap entire restore in a transaction — all-or-nothing
  const doRestore = db.transaction(() => {
    const restored = { memories: 0, entities: 0, relations: 0, edges: 0 };

    if (mode === 'replace') {
      db.prepare('DELETE FROM memories WHERE project_id = ?').run(project);
      db.prepare('DELETE FROM entities WHERE project_id = ?').run(project);
      db.prepare('DELETE FROM entity_relations WHERE project_id = ?').run(project);
      db.prepare('DELETE FROM edges WHERE project_id = ?').run(project);
    }

    const insertMemory = db.prepare(`INSERT OR ${mode === 'merge' ? 'IGNORE' : 'REPLACE'} INTO memories (id, project_id, content, type, tags, importance, confidence, source_count, contradiction_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertEntity = db.prepare(`INSERT OR ${mode === 'merge' ? 'IGNORE' : 'REPLACE'} INTO entities (id, project_id, name, entity_type, observations, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const insertRelation = db.prepare(`INSERT OR IGNORE INTO entity_relations (id, project_id, from_entity, to_entity, relation_type) VALUES (?, ?, ?, ?, ?)`);
    const insertEdge = db.prepare(`INSERT OR ${mode === 'merge' ? 'IGNORE' : 'REPLACE'} INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const m of backup.data.memories || []) {
      const result = insertMemory.run(m.id, project, m.content, m.type, m.tags, m.importance, m.confidence, m.source_count, m.contradiction_count, m.created_at);
      if (result.changes > 0) restored.memories++;
    }

    for (const e of backup.data.entities || []) {
      const result = insertEntity.run(e.id, project, e.name, e.entity_type, e.observations, e.created_at);
      if (result.changes > 0) restored.entities++;
    }

    for (const r of backup.data.relations || []) {
      const result = insertRelation.run(r.id, project, r.from_entity, r.to_entity, r.relation_type);
      if (result.changes > 0) restored.relations++;
    }

    for (const e of backup.data.edges || []) {
      const result = insertEdge.run(e.id, project, e.from_id, e.to_id, e.relation_type, e.confidence, e.metadata, e.valid_from, e.valid_to);
      if (result.changes > 0) restored.edges++;
    }

    return restored;
  });

  try {
    const restored = doRestore();
    // Count memories needing re-embedding after restore
    const needsEmbedding = (db.prepare(`
      SELECT COUNT(*) as count FROM memories
      WHERE deleted_at IS NULL AND embedding IS NULL
      AND (project_id = ? OR project_id = 'global')
    `).get(project) as any)?.count || 0;
    return {
      restored,
      project_id: project,
      mode,
      ...(needsEmbedding > 0 ? { note: `${needsEmbedding} memories need re-embedding. Run memory_rebuild_embeddings to restore semantic search.` } : {}),
    };
  } catch (err: any) {
    return { error: 'Restore failed — no changes made', details: err.message };
  }
}

// ============================================================================
// List & Cleanup
// ============================================================================

export function listBackups(backupDir = BACKUP_DIR) {
  if (!existsSync(backupDir)) return { backups: [] };

  const files = readdirSync(backupDir).filter(f => f.endsWith('.json'));

  const backups = files.map(f => {
    const filepath = join(backupDir, f);
    const stats = statSync(filepath);
    return {
      filename: f,
      filepath,
      size: stats.size,
      created: stats.birthtime.toISOString()
    };
  }).sort((a, b) => b.created.localeCompare(a.created));

  return { backups, directory: backupDir };
}

export function cleanupOldBackups(backupDir = BACKUP_DIR, keepCount = 10) {
  if (!existsSync(backupDir)) return { removed: [], kept: 0 };

  const files = readdirSync(backupDir)
    .filter(f => f.endsWith('.json') && f.startsWith('backup_'))
    .map(f => ({
      filename: f,
      filepath: join(backupDir, f),
      mtime: statSync(join(backupDir, f)).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime); // Newest first

  const removed: string[] = [];

  if (files.length > keepCount) {
    const toRemove = files.slice(keepCount);
    for (const f of toRemove) {
      try {
        unlinkSync(f.filepath);
        removed.push(f.filename);
      } catch (err) {
        console.error(`[Just-Memory] Failed to remove old backup ${f.filename}:`, err);
      }
    }
  }

  return { removed, kept: Math.min(files.length, keepCount) };
}

/**
 * Check if auto-backup is needed (no backups in last 24h)
 */
export function needsAutoBackup(backupDir = BACKUP_DIR): boolean {
  if (!existsSync(backupDir)) return true;

  const files = readdirSync(backupDir)
    .filter(f => f.endsWith('.json') && f.startsWith('backup_'));

  if (files.length === 0) return true;

  const latest = files
    .map(f => statSync(join(backupDir, f)).mtime.getTime())
    .sort((a, b) => b - a)[0];

  const hoursSinceLastBackup = (Date.now() - latest) / (1000 * 60 * 60);
  return hoursSinceLastBackup >= 24;
}
