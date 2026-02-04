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
import * as crypto from 'crypto';

/**
 * Generate a unique ID (hex string)
 */
function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

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
 * If permanent is true, performs hard delete instead
 */
export function deleteMemory(id: string, permanent: boolean = false): boolean {
  const db = getDatabase();
  
  if (permanent) {
    const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }
  
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
 * Can call with (limit) or (projectId, limit)
 */
export function listDeletedMemories(
  limitOrProjectId?: number | string,
  limit: number = 50
): Memory[] {
  const db = getDatabase();
  
  // Handle overloaded signature
  let projectId: string | undefined;
  let actualLimit: number;
  
  if (typeof limitOrProjectId === 'number') {
    actualLimit = limitOrProjectId;
    projectId = undefined;
  } else {
    projectId = limitOrProjectId;
    actualLimit = limit;
  }
  
  let query = 'SELECT * FROM memories WHERE deleted_at IS NOT NULL';
  const params: unknown[] = [];
  
  if (projectId) {
    query += ' AND project_id = ?';
    params.push(projectId);
  }
  
  query += ' ORDER BY deleted_at DESC LIMIT ?';
  params.push(actualLimit);
  
  const rows = db.prepare(query).all(...params) as MemoryRow[];
  return rows.map(rowToMemory);
}

/**
 * List recent memories
 * Can call with (options) object or (limit, offset, type, projectId) args
 */
export function listRecentMemories(
  limitOrOptions?: number | {
    projectId?: string;
    type?: MemoryType;
    limit?: number;
    offset?: number;
  },
  offsetArg?: number,
  typeArg?: MemoryType,
  projectIdArg?: string
): Memory[] {
  const db = getDatabase();
  
  // Handle overloaded signature
  let projectId: string | undefined;
  let type: MemoryType | undefined;
  let limit: number;
  let offset: number;
  
  if (typeof limitOrOptions === 'number') {
    limit = limitOrOptions;
    offset = offsetArg ?? 0;
    type = typeArg;
    projectId = projectIdArg;
  } else {
    const options = limitOrOptions ?? {};
    projectId = options.projectId;
    type = options.type;
    limit = options.limit ?? 20;
    offset = options.offset ?? 0;
  }
  
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


// =============================================================================
// Memory Link Functions
// =============================================================================

/**
 * Link input
 */
export interface MemoryLinkInput {
  memoryId: string;
  filePath?: string;
  commitHash?: string;
  url?: string;
}

/**
 * Link result
 */
export interface MemoryLink {
  id: string;
  memoryId: string;
  filePath: string | null;
  commitHash: string | null;
  url: string | null;
  createdAt: string;
}

/**
 * Link a memory to a file, commit, or URL
 */
export function linkMemory(input: MemoryLinkInput): MemoryLink {
  const db = getDatabase();
  
  // Verify memory exists
  const memory = db.prepare('SELECT id FROM memories WHERE id = ?').get(input.memoryId);
  if (!memory) {
    throw new Error(`Memory not found: ${input.memoryId}`);
  }
  
  if (!input.filePath && !input.commitHash && !input.url) {
    throw new Error('At least one of filePath, commitHash, or url must be provided');
  }
  
  const id = generateId();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  
  db.prepare(`
    INSERT INTO file_associations (id, memory_id, file_path, commit_hash, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.memoryId, input.filePath || null, input.commitHash || null, input.url || null, now);
  
  return {
    id,
    memoryId: input.memoryId,
    filePath: input.filePath || null,
    commitHash: input.commitHash || null,
    url: input.url || null,
    createdAt: now,
  };
}

/**
 * Get links for a memory
 */
export function getMemoryLinks(memoryId: string): MemoryLink[] {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT id, memory_id, file_path, commit_hash, url, created_at
    FROM file_associations
    WHERE memory_id = ?
    ORDER BY created_at DESC
  `).all(memoryId) as Array<{
    id: string;
    memory_id: string;
    file_path: string | null;
    commit_hash: string | null;
    url: string | null;
    created_at: string;
  }>;
  
  return rows.map(row => ({
    id: row.id,
    memoryId: row.memory_id,
    filePath: row.file_path,
    commitHash: row.commit_hash,
    url: row.url,
    createdAt: row.created_at,
  }));
}

// =============================================================================
// Knowledge Graph Entity Functions (Basic v1)
// =============================================================================

/**
 * Entity input
 */
export interface EntityInput {
  name: string;
  type: string;
  description?: string;
  properties?: Record<string, unknown>;
  projectId?: string;
}

/**
 * Entity record
 */
export interface Entity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  properties: Record<string, unknown>;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Create a knowledge graph entity
 */
export function createEntity(input: EntityInput): Entity {
  const db = getDatabase();
  
  const id = generateId();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  
  db.prepare(`
    INSERT INTO entities (id, name, type, description, properties, project_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.type,
    input.description || null,
    JSON.stringify(input.properties || {}),
    input.projectId || null,
    now,
    now
  );
  
  return {
    id,
    name: input.name,
    type: input.type,
    description: input.description || null,
    properties: input.properties || {},
    projectId: input.projectId || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/**
 * Get entity by ID
 */
export function getEntity(id: string): Entity | null {
  const db = getDatabase();
  
  const row = db.prepare(`
    SELECT id, name, type, description, properties, project_id, created_at, updated_at, deleted_at
    FROM entities
    WHERE id = ? AND deleted_at IS NULL
  `).get(id) as {
    id: string;
    name: string;
    type: string;
    description: string | null;
    properties: string;
    project_id: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  } | undefined;
  
  if (!row) return null;
  
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    properties: JSON.parse(row.properties) as Record<string, unknown>,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * List entities
 */
export function listEntities(
  limit: number = 20,
  type?: string,
  projectId?: string
): Entity[] {
  const db = getDatabase();
  
  let query = 'SELECT * FROM entities WHERE deleted_at IS NULL';
  const params: unknown[] = [];
  
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  
  if (projectId) {
    query += ' AND project_id = ?';
    params.push(projectId);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const rows = db.prepare(query).all(...params) as Array<{
    id: string;
    name: string;
    type: string;
    description: string | null;
    properties: string;
    project_id: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    properties: JSON.parse(row.properties) as Record<string, unknown>,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }));
}

// =============================================================================
// Context Refresh Function
// =============================================================================

/**
 * Refresh context result
 */
export interface RefreshContextResult {
  totalMemories: number;
  recentMemories: number;
  highPriorityCount: number;
  suggestedContext: string;
}

/**
 * Refresh and regenerate session context
 */
export function refreshContext(projectId?: string, maxTokens: number = 300): RefreshContextResult {
  const db = getDatabase();
  
  // Get counts
  let countQuery = 'SELECT COUNT(*) as total FROM memories WHERE deleted_at IS NULL';
  const params: unknown[] = [];
  
  if (projectId) {
    countQuery += ' AND project_id = ?';
    params.push(projectId);
  }
  
  const countRow = db.prepare(countQuery).get(...params) as { total: number };
  const totalMemories = countRow.total;
  
  // Get high priority memories (importance >= 0.7)
  let highPriorityQuery = `
    SELECT COUNT(*) as count FROM memories 
    WHERE deleted_at IS NULL AND importance >= 0.7
  `;
  if (projectId) {
    highPriorityQuery += ' AND project_id = ?';
  }
  const highPriorityRow = db.prepare(highPriorityQuery).get(...(projectId ? [projectId] : [])) as { count: number };
  
  // Get recent memories for context
  const recentMemories = listRecentMemories(15, 0, undefined, projectId);
  
  // Build context string
  const charLimit = maxTokens * 4;
  let context = '';
  
  // Add high-importance memories first
  const sorted = recentMemories.sort((a, b) => b.importance - a.importance);
  
  for (const mem of sorted) {
    const line = `[${mem.type}] ${mem.content.slice(0, 150)}${mem.content.length > 150 ? '...' : ''}\n`;
    if (context.length + line.length > charLimit) break;
    context += line;
  }
  
  return {
    totalMemories,
    recentMemories: recentMemories.length,
    highPriorityCount: highPriorityRow.count,
    suggestedContext: context.trim(),
  };
}
