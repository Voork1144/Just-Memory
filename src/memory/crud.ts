/**
 * Just-Command Memory CRUD Operations
 * 
 * Core operations for storing, retrieving, and managing memories.
 * Implements decisions D1-D4, D10, D15 from the spec.
 */

import { getDatabase } from './database.js';
import { 
  generateEmbedding, 
  embeddingToBuffer,
} from './embeddings.js';

/**
 * Memory types
 */
export type MemoryType = 'fact' | 'event' | 'observation' | 'preference' | 'note' | 'decision';

/**
 * Memory input for storing
 */
export interface MemoryInput {
  content: string;
  type?: MemoryType;
  source?: string;
  projectId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  importance?: number;
  decayEnabled?: boolean;
}

/**
 * Stored memory record
 */
export interface Memory {
  id: string;
  content: string;
  type: MemoryType;
  source: string | null;
  projectId: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  importance: number;
  decayEnabled: boolean;
  lastAccessedAt: string | null;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Store a new memory
 */
export async function storeMemory(input: MemoryInput): Promise<Memory> {
  const db = getDatabase();
  
  // Generate embedding for the content
  const embedding = await generateEmbedding(input.content);
  const embeddingBuffer = embeddingToBuffer(embedding);
  
  // Prepare tags and metadata
  const tags = JSON.stringify(input.tags ?? []);
  const metadata = JSON.stringify(input.metadata ?? {});
  
  // Insert memory
  const stmt = db.prepare(`
    INSERT INTO memories (content, embedding, type, source, project_id, tags, metadata, importance, decay_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  
  const row = stmt.get(
    input.content,
    embeddingBuffer,
    input.type ?? 'fact',
    input.source ?? null,
    input.projectId ?? null,
    tags,
    metadata,
    input.importance ?? 0.5,
    input.decayEnabled ? 1 : 0
  ) as MemoryRow;
  
  return rowToMemory(row);
}

/**
 * Recall a memory by ID
 */
export function recallMemory(id: string, updateAccess: boolean = true): Memory | null {
  const db = getDatabase();
  
  const row = db.prepare(`
    SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL
  `).get(id) as MemoryRow | undefined;
  
  if (!row) return null;
  
  // Update access tracking if requested
  if (updateAccess) {
    db.prepare(`
      UPDATE memories 
      SET last_accessed_at = datetime('now'), 
          access_count = access_count + 1 
      WHERE id = ?
    `).run(id);
  }
  
  return rowToMemory(row);
}

/**
 * Update an existing memory
 */
export async function updateMemory(
  id: string, 
  updates: Partial<MemoryInput>
): Promise<Memory | null> {
  const db = getDatabase();
  
  // Check if memory exists
  const existing = recallMemory(id, false);
  if (!existing) return null;
  
  // Build update query dynamically
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: unknown[] = [];
  
  if (updates.content !== undefined) {
    sets.push('content = ?');
    values.push(updates.content);
    
    // Re-generate embedding for new content
    const embedding = await generateEmbedding(updates.content);
    sets.push('embedding = ?');
    values.push(embeddingToBuffer(embedding));
  }
  
  if (updates.type !== undefined) {
    sets.push('type = ?');
    values.push(updates.type);
  }
  
  if (updates.source !== undefined) {
    sets.push('source = ?');
    values.push(updates.source);
  }
  
  if (updates.projectId !== undefined) {
    sets.push('project_id = ?');
    values.push(updates.projectId);
  }
  
  if (updates.tags !== undefined) {
    sets.push('tags = ?');
    values.push(JSON.stringify(updates.tags));
  }
  
  if (updates.metadata !== undefined) {
    sets.push('metadata = ?');
    values.push(JSON.stringify(updates.metadata));
  }
  
  if (updates.importance !== undefined) {
    sets.push('importance = ?');
    values.push(updates.importance);
  }
  
  if (updates.decayEnabled !== undefined) {
    sets.push('decay_enabled = ?');
    values.push(updates.decayEnabled ? 1 : 0);
  }
  
  values.push(id);
  
  const stmt = db.prepare(`
    UPDATE memories SET ${sets.join(', ')} WHERE id = ? RETURNING *
  `);
  
  const row = stmt.get(...values) as MemoryRow;
  return rowToMemory(row);
}

/**
 * Soft delete a memory (D4: recoverable)
 */
export function deleteMemory(id: string): boolean {
  const db = getDatabase();
  
  const result = db.prepare(`
    UPDATE memories SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL
  `).run(id);
  
  return result.changes > 0;
}

/**
 * Recover a soft-deleted memory (D4)
 */
export function recoverMemory(id: string): Memory | null {
  const db = getDatabase();
  
  const row = db.prepare(`
    UPDATE memories SET deleted_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NOT NULL
    RETURNING *
  `).get(id) as MemoryRow | undefined;
  
  return row ? rowToMemory(row) : null;
}

/**
 * Permanently delete a memory (no recovery)
 */
export function purgeMemory(id: string): boolean {
  const db = getDatabase();
  
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * List deleted memories (for recovery UI)
 */
export function listDeletedMemories(
  projectId?: string,
  limit: number = 50
): Memory[] {
  const db = getDatabase();
  
  let query = 'SELECT * FROM memories WHERE deleted_at IS NOT NULL';
  const params: unknown[] = [];
  
  if (projectId) {
    query += ' AND project_id = ?';
    params.push(projectId);
  }
  
  query += ' ORDER BY deleted_at DESC LIMIT ?';
  params.push(limit);
  
  const rows = db.prepare(query).all(...params) as MemoryRow[];
  return rows.map(rowToMemory);
}

/**
 * List recent memories
 */
export function listRecentMemories(
  options: {
    projectId?: string;
    type?: MemoryType;
    limit?: number;
    offset?: number;
  } = {}
): Memory[] {
  const db = getDatabase();
  const { projectId, type, limit = 20, offset = 0 } = options;
  
  let query = 'SELECT * FROM memories WHERE deleted_at IS NULL';
  const params: unknown[] = [];
  
  if (projectId) {
    query += ' AND project_id = ?';
    params.push(projectId);
  }
  
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  const rows = db.prepare(query).all(...params) as MemoryRow[];
  return rows.map(rowToMemory);
}

// =============================================================================
// Internal helpers
// =============================================================================

interface MemoryRow {
  id: string;
  content: string;
  embedding: Buffer | null;
  type: string;
  source: string | null;
  project_id: string | null;
  tags: string;
  metadata: string;
  importance: number;
  decay_enabled: number;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    type: row.type as MemoryType,
    source: row.source,
    projectId: row.project_id,
    tags: JSON.parse(row.tags) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    importance: row.importance,
    decayEnabled: row.decay_enabled === 1,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
