/**
 * Just-Command Agents CRUD Operations
 *
 * Core operations for creating, managing, and querying AI agents.
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
 * Agent types
 */
export type AgentType = 'assistant' | 'specialist' | 'coordinator' | 'custom';

/**
 * Agent status
 */
export type AgentStatus = 'active' | 'inactive' | 'archived';

/**
 * Agent input for creating/updating
 */
export interface AgentInput {
  name: string;
  type?: AgentType;
  description?: string;
  systemPrompt?: string;
  projectId?: string;
  capabilities?: string[];
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  status?: AgentStatus;
}

/**
 * Stored agent record
 */
export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  description: string | null;
  systemPrompt: string | null;
  projectId: string | null;
  capabilities: string[];
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Create a new agent
 */
export async function createAgent(input: AgentInput): Promise<Agent> {
  const db = getDatabase();

  // Generate embedding for description if provided
  let embeddingBuffer: Buffer | null = null;
  if (input.description) {
    const embedding = await generateEmbedding(input.description);
    embeddingBuffer = embeddingToBuffer(embedding);
  }

  // Prepare JSON fields
  const capabilities = JSON.stringify(input.capabilities ?? []);
  const config = JSON.stringify(input.config ?? {});
  const metadata = JSON.stringify(input.metadata ?? {});

  const id = generateId();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`
    INSERT INTO agents (id, name, type, description, system_prompt, embedding, project_id, capabilities, config, metadata, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.type ?? 'assistant',
    input.description ?? null,
    input.systemPrompt ?? null,
    embeddingBuffer,
    input.projectId ?? null,
    capabilities,
    config,
    metadata,
    input.status ?? 'active',
    now,
    now
  );

  return {
    id,
    name: input.name,
    type: (input.type ?? 'assistant') as AgentType,
    description: input.description ?? null,
    systemPrompt: input.systemPrompt ?? null,
    projectId: input.projectId ?? null,
    capabilities: input.capabilities ?? [],
    config: input.config ?? {},
    metadata: input.metadata ?? {},
    status: (input.status ?? 'active') as AgentStatus,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/**
 * Get an agent by ID
 */
export function getAgent(id: string): Agent | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT * FROM agents WHERE id = ? AND deleted_at IS NULL
  `).get(id) as AgentRow | undefined;

  if (!row) return null;

  return rowToAgent(row);
}

/**
 * Get an agent by name (within a project)
 */
export function getAgentByName(name: string, projectId?: string): Agent | null {
  const db = getDatabase();

  let query = 'SELECT * FROM agents WHERE name = ? AND deleted_at IS NULL';
  const params: unknown[] = [name];

  if (projectId) {
    query += ' AND project_id = ?';
    params.push(projectId);
  } else {
    query += ' AND project_id IS NULL';
  }

  const row = db.prepare(query).get(...params) as AgentRow | undefined;

  if (!row) return null;

  return rowToAgent(row);
}

/**
 * Update an existing agent
 */
export async function updateAgent(
  id: string,
  updates: Partial<AgentInput>
): Promise<Agent | null> {
  const db = getDatabase();

  // Check if agent exists
  const existing = getAgent(id);
  if (!existing) return null;

  // Build update query dynamically
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }

  if (updates.type !== undefined) {
    sets.push('type = ?');
    values.push(updates.type);
  }

  if (updates.description !== undefined) {
    sets.push('description = ?');
    values.push(updates.description);

    // Re-generate embedding for new description
    if (updates.description) {
      const embedding = await generateEmbedding(updates.description);
      sets.push('embedding = ?');
      values.push(embeddingToBuffer(embedding));
    } else {
      sets.push('embedding = NULL');
    }
  }

  if (updates.systemPrompt !== undefined) {
    sets.push('system_prompt = ?');
    values.push(updates.systemPrompt);
  }

  if (updates.projectId !== undefined) {
    sets.push('project_id = ?');
    values.push(updates.projectId);
  }

  if (updates.capabilities !== undefined) {
    sets.push('capabilities = ?');
    values.push(JSON.stringify(updates.capabilities));
  }

  if (updates.config !== undefined) {
    sets.push('config = ?');
    values.push(JSON.stringify(updates.config));
  }

  if (updates.metadata !== undefined) {
    sets.push('metadata = ?');
    values.push(JSON.stringify(updates.metadata));
  }

  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }

  values.push(id);

  const stmt = db.prepare(`
    UPDATE agents SET ${sets.join(', ')} WHERE id = ? RETURNING *
  `);

  const row = stmt.get(...values) as AgentRow;
  return rowToAgent(row);
}

/**
 * List agents with optional filtering
 */
export function listAgents(options: {
  projectId?: string;
  type?: AgentType;
  status?: AgentStatus;
  limit?: number;
  offset?: number;
} = {}): Agent[] {
  const db = getDatabase();

  const { projectId, type, status, limit = 20, offset = 0 } = options;

  let query = 'SELECT * FROM agents WHERE deleted_at IS NULL';
  const params: unknown[] = [];

  if (projectId !== undefined) {
    query += ' AND project_id = ?';
    params.push(projectId);
  }

  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as AgentRow[];
  return rows.map(rowToAgent);
}

/**
 * Soft delete an agent (D4: recoverable)
 * If permanent is true, performs hard delete instead
 */
export function deleteAgent(id: string, permanent: boolean = false): boolean {
  const db = getDatabase();

  if (permanent) {
    const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    return result.changes > 0;
  }

  const result = db.prepare(`
    UPDATE agents SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL
  `).run(id);

  return result.changes > 0;
}

/**
 * Recover a soft-deleted agent (D4)
 */
export function recoverAgent(id: string): Agent | null {
  const db = getDatabase();

  const row = db.prepare(`
    UPDATE agents SET deleted_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NOT NULL
    RETURNING *
  `).get(id) as AgentRow | undefined;

  return row ? rowToAgent(row) : null;
}

/**
 * Get agent statistics
 */
export function getAgentStats(projectId?: string): {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const db = getDatabase();

  let countQuery = 'SELECT COUNT(*) as total FROM agents WHERE deleted_at IS NULL';
  let typeQuery = 'SELECT type, COUNT(*) as count FROM agents WHERE deleted_at IS NULL';
  let statusQuery = 'SELECT status, COUNT(*) as count FROM agents WHERE deleted_at IS NULL';
  const params: unknown[] = [];

  if (projectId) {
    countQuery += ' AND project_id = ?';
    typeQuery += ' AND project_id = ?';
    statusQuery += ' AND project_id = ?';
    params.push(projectId);
  }

  typeQuery += ' GROUP BY type';
  statusQuery += ' GROUP BY status';

  const totalRow = db.prepare(countQuery).get(...params) as { total: number };
  const typeRows = db.prepare(typeQuery).all(...params) as Array<{ type: string; count: number }>;
  const statusRows = db.prepare(statusQuery).all(...params) as Array<{ status: string; count: number }>;

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.type] = row.count;
  }

  const byStatus: Record<string, number> = {};
  for (const row of statusRows) {
    byStatus[row.status] = row.count;
  }

  return {
    total: totalRow.total,
    byType,
    byStatus,
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

interface AgentRow {
  id: string;
  name: string;
  type: string;
  description: string | null;
  system_prompt: string | null;
  embedding: Buffer | null;
  project_id: string | null;
  capabilities: string;
  config: string;
  metadata: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AgentType,
    description: row.description,
    systemPrompt: row.system_prompt,
    projectId: row.project_id,
    capabilities: JSON.parse(row.capabilities) as string[],
    config: JSON.parse(row.config) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    status: row.status as AgentStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
