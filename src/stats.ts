/**
 * Just-Memory v4.3 — Stats & Projects
 * Memory statistics, project listing, and context-based suggestions.
 * Extracted from monolith — pure functions with db parameter injection.
 */
import Database from 'better-sqlite3';
import { safeParse } from './config.js';
import { sanitizeLikePattern } from './validation.js';

// ============================================================================
// Context Suggestions
// ============================================================================

export function suggestFromContext(db: Database.Database, contextText: string, projectId: string, limit = 10) {
  const words = contextText.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 3).slice(0, 10);
  if (words.length === 0) return { suggestions: [], reason: 'No meaningful keywords in context' };

  const likeConditions = words.map(() => '(content LIKE ? OR tags LIKE ?)').join(' OR ');
  const params: any[] = [];
  for (const word of words) {
    params.push(`%${sanitizeLikePattern(word)}%`, `%${sanitizeLikePattern(word)}%`);
  }

  const memories = db.prepare(`
    SELECT id, content, type, tags, confidence, importance FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global') AND (${likeConditions})
    ORDER BY importance DESC, confidence DESC LIMIT ?
  `).all(projectId, ...params, limit) as any[];

  return {
    context: contextText.slice(0, 100) + (contextText.length > 100 ? '...' : ''),
    keywords: words,
    suggestions: memories.map(m => ({
      id: m.id,
      content: m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content,
      content_truncated: m.content.length > 200,
      type: m.type,
      tags: safeParse(m.tags, []),
      confidence: m.confidence,
    })),
  };
}

// ============================================================================
// Stats
// ============================================================================

export function getStats(db: Database.Database, projectId?: string) {
  const project = projectId || null;

  let memoryCounts, entityCount, edgeCount, avgConfidence, contradictionEdges, withEmbeddings, typeBreakdown;

  if (project) {
    memoryCounts = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active
      FROM memories WHERE (project_id = ? OR project_id = 'global')
    `).get(project) as any;
    entityCount = db.prepare(`
      SELECT COUNT(*) as count FROM entities WHERE (project_id = ? OR project_id = 'global')
    `).get(project) as any;
    edgeCount = db.prepare(`
      SELECT COUNT(*) as count FROM edges WHERE (project_id = ? OR project_id = 'global')
    `).get(project) as any;
    avgConfidence = db.prepare(`
      SELECT AVG(confidence) as avg FROM memories
      WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
    `).get(project) as any;
    contradictionEdges = db.prepare(`
      SELECT COUNT(*) as count FROM edges
      WHERE relation_type LIKE 'contradiction_%' AND (project_id = ? OR project_id = 'global')
    `).get(project) as any;
    withEmbeddings = db.prepare(`
      SELECT COUNT(*) as count FROM memories
      WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global') AND embedding IS NOT NULL
    `).get(project) as any;
    typeBreakdown = db.prepare(`
      SELECT type, COUNT(*) as count FROM memories
      WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
      GROUP BY type ORDER BY count DESC
    `).all(project) as any[];
  } else {
    memoryCounts = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active FROM memories
    `).get() as any;
    entityCount = db.prepare(`SELECT COUNT(*) as count FROM entities`).get() as any;
    edgeCount = db.prepare(`SELECT COUNT(*) as count FROM edges`).get() as any;
    avgConfidence = db.prepare(`SELECT AVG(confidence) as avg FROM memories WHERE deleted_at IS NULL`).get() as any;
    contradictionEdges = db.prepare(`SELECT COUNT(*) as count FROM edges WHERE relation_type LIKE 'contradiction_%'`).get() as any;
    withEmbeddings = db.prepare(`SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND embedding IS NOT NULL`).get() as any;
    typeBreakdown = db.prepare(`SELECT type, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY type ORDER BY count DESC`).all() as any[];
  }

  return {
    project_id: project || 'all',
    memories: {
      total: memoryCounts.total,
      active: memoryCounts.active,
      withEmbeddings: withEmbeddings.count,
      avgConfidence: avgConfidence.avg ? parseFloat(avgConfidence.avg.toFixed(3)) : 0
    },
    entities: entityCount.count,
    edges: {
      total: edgeCount.count,
      contradictions: contradictionEdges.count
    },
    typeBreakdown,
  };
}

// ============================================================================
// Projects
// ============================================================================

export function listProjects(db: Database.Database, currentProjectId: string) {
  const memoryProjects = db.prepare(`
    SELECT project_id, COUNT(*) as memory_count, MAX(created_at) as last_activity
    FROM memories WHERE deleted_at IS NULL
    GROUP BY project_id
    ORDER BY last_activity DESC
  `).all() as any[];

  const entityProjects = db.prepare(`
    SELECT project_id, COUNT(*) as entity_count
    FROM entities
    GROUP BY project_id
  `).all() as any[];

  const entityMap = new Map(entityProjects.map((e: any) => [e.project_id, e.entity_count]));

  return {
    current: currentProjectId,
    projects: memoryProjects.map((p: any) => ({
      id: p.project_id,
      memoryCount: p.memory_count,
      entityCount: entityMap.get(p.project_id) || 0,
      lastActivity: p.last_activity
    }))
  };
}
