/**
 * Just-Memory Core Memory Operations (v4.2)
 * CRUD, confidence management, retention, re-embedding, proactive contradiction search.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  CONFIDENCE_LEVELS, CONFIDENCE_BOOST, CONFIDENCE_PENALTY,
  CONTRADICTION_CONFIG, DECAY_CONSTANT,
  safeParse,
  type ContradictionResult,
} from './config.js';
import { generateEmbedding } from './models.js';
import { validateContent, validateTags } from './validation.js';
import { EMBEDDING_DIM } from './config.js';

// ============================================================================
// Retention & Strength
// ============================================================================

export function calculateRetention(lastAccessed: string, strength: number): number {
  const hoursSince = (Date.now() - new Date(lastAccessed).getTime()) / 3600000;
  return Math.exp(-hoursSince * DECAY_CONSTANT / (strength * 24));
}

export function updateStrength(currentStrength: number, accessCount: number): number {
  return Math.min(10, currentStrength + 0.2 * Math.log(accessCount + 1));
}

// ============================================================================
// Confidence
// ============================================================================

export function calculateEffectiveConfidence(memory: any): number {
  let conf = memory.confidence;
  const daysSince = (Date.now() - new Date(memory.last_accessed).getTime()) / 86400000;
  conf -= daysSince * CONFIDENCE_PENALTY.DECAY_PER_DAY;
  conf += (memory.source_count - 1) * CONFIDENCE_BOOST.CONFIRMATION;
  // v4.2: Cap contradiction penalty at MAX_CONTRADICTION_COUNT
  conf -= Math.min(memory.contradiction_count, CONFIDENCE_PENALTY.MAX_CONTRADICTION_COUNT) * CONFIDENCE_PENALTY.CONTRADICTION;
  if (memory.importance > 0.7) conf += CONFIDENCE_BOOST.HIGH_IMPORTANCE;
  // v4.2: Importance-based confidence floor
  const floor = memory.importance >= 0.8 ? 0.4 : memory.importance >= 0.5 ? 0.2 : 0.1;
  return Math.max(floor, Math.min(1, conf));
}

export function assessConfidence(memory: any): { level: string; note?: string } {
  const conf = calculateEffectiveConfidence(memory);
  if (conf >= CONFIDENCE_LEVELS.HIGH) return { level: 'high' };
  if (conf >= CONFIDENCE_LEVELS.MEDIUM) return { level: 'medium' };
  if (conf >= CONFIDENCE_LEVELS.LOW) return { level: 'low' };
  return { level: 'uncertain', note: 'Low confidence - may need verification' };
}

export function toConfidentMemory(m: any) {
  const assessment = assessConfidence(m);
  return {
    id: m.id,
    project_id: m.project_id,
    content: m.content,
    confidence: calculateEffectiveConfidence(m),
    confidenceLevel: assessment.level,
    ...(assessment.note ? { confidenceNote: assessment.note } : {}),
  };
}

// ============================================================================
// Type for contradiction finder callback
// ============================================================================

export type ContradictionFinder = (
  content: string,
  projectId: string,
  limit?: number,
  excludeId?: string,
  includeSemanticSearch?: boolean
) => Promise<ContradictionResult[]>;

// ============================================================================
// Core CRUD
// ============================================================================

export async function storeMemory(
  db: Database.Database,
  findContradictions: ContradictionFinder,
  content: string,
  type = 'note',
  tags: string[] = [],
  importance = 0.5,
  confidence = 0.5,
  projectId: string
) {
  validateContent(content);
  const validTags = validateTags(tags);
  const id = randomUUID().replace(/-/g, '');

  // Use enhanced contradiction detection
  const contradictions = await findContradictions(content, projectId, 5);

  let adjustedConfidence = confidence;
  let contradictionPenalty = 0;

  for (const c of contradictions) {
    const penalty = CONTRADICTION_CONFIG.PENALTY[c.contradictionType.toUpperCase() as keyof typeof CONTRADICTION_CONFIG.PENALTY] || 0.1;
    contradictionPenalty += penalty * c.confidence;
  }

  if (contradictions.length > 0) {
    adjustedConfidence = Math.max(0.1, confidence - contradictionPenalty);
  }

  const embedding = await generateEmbedding(content);
  const embeddingBuffer = embedding ? Buffer.from(new Uint8Array(embedding.buffer)) : null;

  if (!embeddingBuffer) {
    console.error(`[Just-Memory v4.0] Warning: Embedding generation failed for memory ${id} - will be invisible to semantic search`);
  }

  // Wrap INSERT + contradiction edges in a transaction
  const doStore = db.transaction(() => {
    db.prepare(`INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, projectId, content, type, JSON.stringify(validTags), importance, adjustedConfidence, embeddingBuffer);

    // Create contradiction edges
    for (const c of contradictions) {
      const edgeId = randomUUID().replace(/-/g, '');
      const metadata = JSON.stringify({
        type: c.contradictionType,
        confidence: c.confidence,
        explanation: c.explanation,
      });
      db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(edgeId, projectId, id, c.id, `contradiction_${c.contradictionType}`, c.confidence, metadata);
    }
  });
  doStore();

  return {
    id, project_id: projectId,
    content: content.length > 200 ? content.slice(0, 200) + '...' : content,
    content_truncated: content.length > 200,
    type, tags: validTags, importance,
    confidence: adjustedConfidence, strength: 1.0,
    embeddingWarning: embedding === null ? 'Embedding generation failed - will be re-embedded during next consolidation.' : undefined,
    contradictions: contradictions.map(c => ({
      id: c.id,
      type: c.contradictionType,
      confidence: c.confidence,
      explanation: c.explanation,
      suggestedAction: c.suggestedAction,
      preview: c.content.slice(0, 100),
    })),
  };
}

export async function reembedOrphaned(
  db: Database.Database,
  projectId: string,
  limit = 50,
  forceRebuild = false
): Promise<number> {
  const CORRECT_EMBEDDING_SIZE = EMBEDDING_DIM * 4;
  const query = forceRebuild
    ? `SELECT id, content FROM memories
       WHERE deleted_at IS NULL
         AND (project_id = ? OR project_id = 'global')
         AND (embedding IS NULL OR length(embedding) != ${CORRECT_EMBEDDING_SIZE})
       LIMIT ?`
    : `SELECT id, content FROM memories
       WHERE deleted_at IS NULL
         AND embedding IS NULL
         AND (project_id = ? OR project_id = 'global')
       LIMIT ?`;

  const orphaned = db.prepare(query).all(projectId, limit) as any[];

  if (orphaned.length === 0) return 0;

  // Phase 1: Generate all embeddings (async)
  const updates: { id: string; embedding: Buffer }[] = [];
  for (const m of orphaned) {
    try {
      const embedding = await generateEmbedding(m.content);
      if (embedding) {
        updates.push({ id: m.id, embedding: Buffer.from(new Uint8Array(embedding.buffer)) });
      }
    } catch (err: any) {
      console.error(`[Just-Memory v4.0] Re-embed failed for ${m.id}: ${err.message}`);
    }
  }

  // Phase 2: Batch-write all updates in a single transaction
  if (updates.length > 0) {
    const batchUpdate = db.transaction((items: { id: string; embedding: Buffer }[]) => {
      const stmt = db.prepare('UPDATE memories SET embedding = ? WHERE id = ?');
      for (const item of items) {
        stmt.run(item.embedding, item.id);
      }
    });
    batchUpdate(updates);
    console.error(`[Just-Memory v4.0] Re-embedded ${updates.length}/${orphaned.length} orphaned memories`);
  }
  return updates.length;
}

export function recallMemory(db: Database.Database, id: string, projectId?: string) {
  let sql = 'SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL';
  const params: any[] = [id];
  if (projectId) {
    sql += " AND (project_id = ? OR project_id = 'global')";
    params.push(projectId);
  }
  const memory = db.prepare(sql).get(...params) as any;
  if (!memory) return { error: 'Memory not found', id };

  const newStrength = updateStrength(memory.strength, memory.access_count);
  const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.RECENT_ACCESS);

  db.prepare(`UPDATE memories SET access_count = access_count + 1, strength = ?, confidence = ?, last_accessed = datetime('now') WHERE id = ?`)
    .run(newStrength, newConfidence, id);

  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;

  // Get related contradictions
  const contradictionEdges = db.prepare(`
    SELECT e.*, m.content as other_content
    FROM edges e
    JOIN memories m ON (e.from_id = m.id OR e.to_id = m.id) AND m.id != ?
    WHERE (e.from_id = ? OR e.to_id = ?)
    AND e.relation_type LIKE 'contradiction_%'
    AND m.deleted_at IS NULL
  `).all(id, id, id) as any[];

  return {
    ...toConfidentMemory(updated),
    type: updated.type, tags: safeParse(updated.tags, []),
    importance: updated.importance, strength: updated.strength,
    access_count: updated.access_count, created_at: updated.created_at,
    last_accessed: updated.last_accessed,
    contradictions: contradictionEdges.map((e: any) => ({
      type: e.relation_type.replace('contradiction_', ''),
      otherMemoryId: e.from_id === id ? e.to_id : e.from_id,
      preview: e.other_content?.slice(0, 100),
      metadata: safeParse(e.metadata, {}),
    })),
  };
}

/** Allowed fields for memory updates — prevents dynamic SQL field injection */
export interface MemoryUpdates {
  content?: string;
  type?: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
}

export async function updateMemory(
  db: Database.Database,
  findContradictions: ContradictionFinder,
  id: string,
  updates: MemoryUpdates,
  projectId?: string
) {
  let sql = 'SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL';
  const params: any[] = [id];
  if (projectId) {
    sql += " AND (project_id = ? OR project_id = 'global')";
    params.push(projectId);
  }
  const memory = db.prepare(sql).get(...params) as any;
  if (!memory) return { error: 'Memory not found', id };

  const fields: string[] = [];
  const values: any[] = [];
  let newContradictions: ContradictionResult[] = [];

  if (updates.content !== undefined) {
    validateContent(updates.content);
    fields.push('content = ?');
    values.push(updates.content);

    const embedding = await generateEmbedding(updates.content);
    if (embedding) {
      fields.push('embedding = ?');
      values.push(Buffer.from(new Uint8Array(embedding.buffer)));
    }

    // Check for new contradictions with enhanced detection
    newContradictions = await findContradictions(updates.content, memory.project_id, 5, id);

    for (const c of newContradictions) {
      const existingEdge = db.prepare(`
        SELECT id FROM edges
        WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
        AND relation_type LIKE 'contradiction_%'
      `).get(id, c.id, c.id, id);

      if (!existingEdge) {
        const edgeId = randomUUID().replace(/-/g, '');
        const metadata = JSON.stringify({
          type: c.contradictionType,
          confidence: c.confidence,
          explanation: c.explanation,
        });
        db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(edgeId, memory.project_id, id, c.id, `contradiction_${c.contradictionType}`, c.confidence, metadata);
      }
    }
  }

  if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(validateTags(updates.tags))); }
  if (updates.importance !== undefined) { fields.push('importance = ?'); values.push(Math.max(0, Math.min(1, updates.importance))); }
  if (updates.confidence !== undefined) { fields.push('confidence = ?'); values.push(Math.max(0, Math.min(1, updates.confidence))); }

  if (fields.length === 0) return { error: 'No valid updates provided', id };

  fields.push("last_accessed = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
  return {
    id: updated.id, project_id: updated.project_id,
    content: updated.content.length > 200 ? updated.content.slice(0, 200) + '...' : updated.content,
    content_truncated: updated.content.length > 200,
    type: updated.type,
    tags: safeParse(updated.tags, []), importance: updated.importance,
    confidence: updated.confidence, updated: true,
    newContradictions: newContradictions.map(c => ({
      id: c.id,
      type: c.contradictionType,
      explanation: c.explanation,
      preview: c.content.slice(0, 100),
    })),
  };
}

export function deleteMemory(db: Database.Database, id: string, permanent = false, projectId?: string) {
  let sql = 'SELECT * FROM memories WHERE id = ?';
  const params: any[] = [id];
  if (projectId) {
    sql += " AND (project_id = ? OR project_id = 'global')";
    params.push(projectId);
  }
  const memory = db.prepare(sql).get(...params) as any;
  if (!memory) return { error: 'Memory not found', id };

  if (permanent) {
    db.prepare('DELETE FROM edges WHERE from_id = ? OR to_id = ?').run(id, id);
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return { deleted: true, permanent: true, id };
  }

  db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return { deleted: true, permanent: false, id, canRestore: true };
}

export function listMemories(db: Database.Database, projectId: string, limit = 20, includeDeleted = false) {
  let sql = `
    SELECT * FROM memories
    WHERE (project_id = ? OR project_id = 'global')
  `;

  if (!includeDeleted) {
    sql += ' AND deleted_at IS NULL';
  }

  sql += ' ORDER BY last_accessed DESC LIMIT ?';

  const memories = db.prepare(sql).all(projectId, limit) as any[];

  return memories.map(m => ({
    id: m.id,
    project_id: m.project_id,
    content: m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content,
    content_truncated: m.content.length > 200,
    type: m.type,
    tags: safeParse(m.tags, []),
    importance: m.importance,
    confidence: calculateEffectiveConfidence(m),
    ...(includeDeleted ? { deleted: m.deleted_at !== null } : {}),
  }));
}

// ============================================================================
// Briefing Memory Selection (Tiered)
// ============================================================================

/**
 * Select memories for briefing using a 2-tier approach:
 * Tier 1 (Core): High-importance memories (>= 0.8) sorted by importance DESC
 * Tier 2 (Recent): Most recently accessed, excluding Tier 1 IDs
 * Content is truncated to save tokens -- use memory_recall for full text.
 */
export function getBriefingMemories(
  db: Database.Database,
  projectId: string,
  coreLimit = 5,
  recentLimit = 5
): { core: any[]; recent: any[] } {
  const mapBriefingMemory = (m: any) => ({
    id: m.id,
    project_id: m.project_id,
    content: m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content,
    content_truncated: m.content.length > 200,
    type: m.type,
    tags: safeParse(m.tags, []),
    importance: m.importance,
    confidence: calculateEffectiveConfidence(m),
  });

  // Tier 1: Core knowledge (high importance)
  const coreMemories = db.prepare(`
    SELECT * FROM memories
    WHERE (project_id = ? OR project_id = 'global')
      AND deleted_at IS NULL
      AND importance >= 0.8
    ORDER BY importance DESC, confidence DESC
    LIMIT ?
  `).all(projectId, coreLimit) as any[];

  const coreIds = new Set(coreMemories.map(m => m.id));

  // Tier 2: Recent context (excluding core IDs)
  let recentSql = `
    SELECT * FROM memories
    WHERE (project_id = ? OR project_id = 'global')
      AND deleted_at IS NULL
  `;
  const recentParams: any[] = [projectId];

  if (coreIds.size > 0) {
    const placeholders = Array.from(coreIds).map(() => '?').join(',');
    recentSql += ` AND id NOT IN (${placeholders})`;
    recentParams.push(...coreIds);
  }

  recentSql += ' ORDER BY last_accessed DESC LIMIT ?';
  recentParams.push(recentLimit);

  const recentMemories = db.prepare(recentSql).all(...recentParams) as any[];

  return {
    core: coreMemories.map(mapBriefingMemory),
    recent: recentMemories.map(mapBriefingMemory),
  };
}

// ============================================================================
// Confidence Operations
// ============================================================================

export function confirmMemory(db: Database.Database, id: string, sourceId?: string, projectId?: string) {
  let sql = 'SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL';
  const params: any[] = [id];
  if (projectId) {
    sql += " AND (project_id = ? OR project_id = 'global')";
    params.push(projectId);
  }
  const memory = db.prepare(sql).get(...params) as any;
  if (!memory) return { error: 'Memory not found', id };

  const newSourceCount = memory.source_count + 1;
  const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.CONFIRMATION);

  db.prepare('UPDATE memories SET source_count = ?, confidence = ? WHERE id = ?')
    .run(newSourceCount, newConfidence, id);

  if (sourceId) {
    const edgeId = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, ?, 'confirms', 1.0)`)
      .run(edgeId, memory.project_id, sourceId, id);
  }

  return {
    id, project_id: memory.project_id, confidence: newConfidence,
    source_count: newSourceCount, confirmed: true,
  };
}

export function contradictMemory(db: Database.Database, id: string, contradictingId?: string, projectId?: string) {
  let sql = 'SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL';
  const params: any[] = [id];
  if (projectId) {
    sql += " AND (project_id = ? OR project_id = 'global')";
    params.push(projectId);
  }
  const memory = db.prepare(sql).get(...params) as any;
  if (!memory) return { error: 'Memory not found', id };

  const newConfidence = Math.max(0, memory.confidence - CONFIDENCE_PENALTY.CONTRADICTION);
  const newContradictionCount = memory.contradiction_count + 1;

  db.prepare('UPDATE memories SET confidence = ?, contradiction_count = ? WHERE id = ?')
    .run(newConfidence, newContradictionCount, id);

  if (contradictingId) {
    const edgeId = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, ?, 'contradicts', 1.0)`)
      .run(edgeId, memory.project_id, contradictingId, id);
  }

  return {
    id, project_id: memory.project_id,
    confidence: newConfidence,
    contradiction_count: newContradictionCount,
    contradicted: true,
  };
}

// ============================================================================
// Proactive Contradiction Finder
// ============================================================================

export async function findContradictionsProactive(
  findContradictions: ContradictionFinder,
  content: string,
  projectId: string,
  limit = 10
) {
  const contradictions = await findContradictions(content, projectId, limit, undefined, true);

  const summary = {
    totalFound: contradictions.length,
    byType: {
      semantic: contradictions.filter(c => c.contradictionType === 'semantic').length,
      factual: contradictions.filter(c => c.contradictionType === 'factual').length,
      negation: contradictions.filter(c => c.contradictionType === 'negation').length,
      antonym: contradictions.filter(c => c.contradictionType === 'antonym').length,
      temporal: contradictions.filter(c => c.contradictionType === 'temporal').length,
    },
    actionRequired: contradictions.filter(c => c.suggestedAction === 'resolve').length,
    reviewSuggested: contradictions.filter(c => c.suggestedAction === 'review').length,
  };

  return {
    query: content.slice(0, 200),
    project_id: projectId,
    summary,
    contradictions: contradictions.map(c => ({
      id: c.id,
      type: c.contradictionType,
      confidence: c.confidence,
      similarity: c.similarity,
      explanation: c.explanation,
      suggestedAction: c.suggestedAction,
      content: c.content.slice(0, 300),
    })),
  };
}

/**
 * Recalibrate contradiction_count for all memories to match actual unresolved edges (v4.2).
 * After resolving contradictions, the count may be stale (still reflects old edges).
 * This resets it to the real count of unresolved contradiction edges per memory.
 */
export function recalibrateContradictionCounts(
  db: Database.Database,
  projectId: string = 'global'
): { recalibrated: number } {
  let recalibrated = 0;

  // Find all memories with contradiction_count > 0
  const memories = db.prepare(`
    SELECT id, contradiction_count FROM memories
    WHERE contradiction_count > 0 AND deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
  `).all(projectId) as Array<{ id: string; contradiction_count: number }>;

  for (const mem of memories) {
    // Count actual unresolved contradiction edges for this memory
    const actualCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM edges e
      LEFT JOIN contradiction_resolutions cr ON
        (cr.memory_id_1 = e.from_id AND cr.memory_id_2 = e.to_id) OR
        (cr.memory_id_1 = e.to_id AND cr.memory_id_2 = e.from_id)
      WHERE e.relation_type LIKE 'contradiction_%'
        AND (e.from_id = ? OR e.to_id = ?)
        AND (cr.id IS NULL OR cr.resolution_type = 'pending')
    `).get(mem.id, mem.id) as { cnt: number };

    if (actualCount.cnt !== mem.contradiction_count) {
      db.prepare(`UPDATE memories SET contradiction_count = ? WHERE id = ?`).run(actualCount.cnt, mem.id);
      recalibrated++;
    }
  }

  return { recalibrated };
}
