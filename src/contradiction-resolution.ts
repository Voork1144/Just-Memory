/**
 * Just-Memory v4.3 — Contradiction Resolution
 * Pending resolutions, resolve actions, scanning, and auto-resolution.
 * Distinct from contradiction.ts (which handles *detection*).
 * Extracted from monolith — pure functions with db parameter injection.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// ============================================================================
// Pure Helpers
// ============================================================================

/**
 * Detect version-update false positives: two memories about the same topic
 * with different version numbers are not contradictions (v4.2)
 */
export function isVersionUpdateContradiction(content1: string, content2: string): boolean {
  const versionRegex = /v?(\d+\.\d+(?:\.\d+)?)/g;
  const versions1 = [...content1.matchAll(versionRegex)].map(m => m[1]);
  const versions2 = [...content2.matchAll(versionRegex)].map(m => m[1]);
  if (versions1.length === 0 || versions2.length === 0) return false;
  // Must share 3+ significant topic words beyond version numbers
  const words1 = new Set(content1.toLowerCase().replace(/v?\d+\.\d+/g, '').split(/\W+/).filter(w => w.length > 3));
  const words2 = new Set(content2.toLowerCase().replace(/v?\d+\.\d+/g, '').split(/\W+/).filter(w => w.length > 3));
  const overlap = [...words1].filter(w => words2.has(w)).length;
  return overlap >= 3 && versions1.some(v1 => versions2.some(v2 => v1 !== v2));
}

/**
 * Detect temporal supersession: if one memory was created 30+ days before
 * the other and they share high topic overlap, the newer one supersedes (v4.2)
 */
export function isTemporalSupersession(createdAt1: string, createdAt2: string): 'first_newer' | 'second_newer' | false {
  const d1 = new Date(createdAt1).getTime();
  const d2 = new Date(createdAt2).getTime();
  const daysDiff = Math.abs(d1 - d2) / 86400000;
  if (daysDiff < 30) return false;
  return d1 > d2 ? 'first_newer' : 'second_newer';
}

// ============================================================================
// Resolution CRUD (db-injected)
// ============================================================================

/**
 * Get pending contradiction resolutions
 */
export function getPendingResolutions(db: Database.Database, projectId: string, limit = 20) {
  const resolutions = db.prepare(`
    SELECT cr.*,
           m1.content as memory1_content,
           m2.content as memory2_content
    FROM contradiction_resolutions cr
    JOIN memories m1 ON cr.memory_id_1 = m1.id
    JOIN memories m2 ON cr.memory_id_2 = m2.id
    WHERE cr.resolution_type = 'pending'
      AND (cr.project_id = ? OR cr.project_id = 'global')
    ORDER BY cr.created_at DESC
    LIMIT ?
  `).all(projectId, limit) as any[];

  return {
    pending_count: resolutions.length,
    resolutions: resolutions.map(r => ({
      id: r.id,
      memory1: { id: r.memory_id_1, content: r.memory1_content.slice(0, 150) },
      memory2: { id: r.memory_id_2, content: r.memory2_content.slice(0, 150) },
      created_at: r.created_at
    }))
  };
}

/**
 * Resolve a contradiction
 */
export function resolveContradiction(
  db: Database.Database,
  resolutionId: string,
  resolutionType: 'keep_first' | 'keep_second' | 'keep_both' | 'merge' | 'delete_both',
  note?: string,
  mergedContent?: string
) {
  const resolution = db.prepare(`SELECT * FROM contradiction_resolutions WHERE id = ?`).get(resolutionId) as any;
  if (!resolution) return { error: 'Resolution not found', resolutionId };

  if (resolutionType === 'merge' && !mergedContent) {
    return { error: 'Merged content required for merge resolution' };
  }

  // Validate that referenced memories still exist (not permanently deleted)
  const m1Exists = db.prepare(`SELECT id FROM memories WHERE id = ?`).get(resolution.memory_id_1);
  const m2Exists = db.prepare(`SELECT id FROM memories WHERE id = ?`).get(resolution.memory_id_2);

  if (!m1Exists || !m2Exists) {
    return {
      error: 'One or both memories no longer exist',
      memory_id_1: resolution.memory_id_1,
      memory_id_2: resolution.memory_id_2,
      m1_exists: !!m1Exists,
      m2_exists: !!m2Exists
    };
  }

  // Wrap all writes in a transaction for atomicity
  const doResolve = db.transaction(() => {
    let chosenMemory: string | null = null;

    switch (resolutionType) {
      case 'keep_first':
        chosenMemory = resolution.memory_id_1;
        db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`).run(resolution.memory_id_2);
        break;

      case 'keep_second':
        chosenMemory = resolution.memory_id_2;
        db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`).run(resolution.memory_id_1);
        break;

      case 'keep_both':
        break;

      case 'merge': {
        const mergedId = randomUUID().replace(/-/g, '');
        const m1 = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(resolution.memory_id_1) as any;
        if (!m1) {
          throw new Error(`Memory ${resolution.memory_id_1} not found for merge`);
        }
        db.prepare(`
          INSERT INTO memories (id, project_id, content, type, tags, importance, confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(mergedId, m1.project_id, mergedContent, m1.type, m1.tags, m1.importance, Math.max(m1.confidence, 0.7));
        db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id IN (?, ?)`).run(resolution.memory_id_1, resolution.memory_id_2);
        chosenMemory = mergedId;
        break;
      }

      case 'delete_both':
        db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id IN (?, ?)`).run(resolution.memory_id_1, resolution.memory_id_2);
        break;
    }

    // Update resolution record
    db.prepare(`
      UPDATE contradiction_resolutions
      SET resolution_type = ?, chosen_memory = ?, resolution_note = ?, resolved_at = datetime('now')
      WHERE id = ?
    `).run(resolutionType, chosenMemory, note || null, resolutionId);

    return chosenMemory;
  });

  const chosenMemory = doResolve();

  return {
    resolutionId,
    resolutionType,
    chosenMemory,
    note,
    resolved_at: new Date().toISOString()
  };
}

/**
 * Scan for unresolved contradictions.
 * v4.2: Auto-resolves obvious false positives (version updates, temporal supersession).
 */
export function scanContradictions(db: Database.Database, projectId: string, autoCreateResolutions = true) {
  // Get all contradiction edges that don't have resolutions
  // v4.2: Also fetch created_at for temporal supersession detection
  const edges = db.prepare(`
    SELECT e.*, m1.content as from_content, m2.content as to_content,
           m1.created_at as from_created_at, m2.created_at as to_created_at
    FROM edges e
    JOIN memories m1 ON e.from_id = m1.id
    JOIN memories m2 ON e.to_id = m2.id
    LEFT JOIN contradiction_resolutions cr ON
      (cr.memory_id_1 = e.from_id AND cr.memory_id_2 = e.to_id) OR
      (cr.memory_id_1 = e.to_id AND cr.memory_id_2 = e.from_id)
    WHERE e.relation_type LIKE 'contradiction_%'
      AND m1.deleted_at IS NULL
      AND m2.deleted_at IS NULL
      AND cr.id IS NULL
      AND (e.project_id = ? OR e.project_id = 'global')
  `).all(projectId) as any[];

  const newResolutions: any[] = [];
  let autoResolved = 0;

  if (autoCreateResolutions) {
    for (const edge of edges) {
      const id = `res_${randomUUID().slice(0, 8)}`;

      // v4.2: Check for obvious false-positive patterns before creating pending resolution
      if (isVersionUpdateContradiction(edge.from_content, edge.to_content)) {
        db.prepare(`
          INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type, resolution_note, resolved_at)
          VALUES (?, ?, ?, ?, 'keep_both', 'Auto-resolved: version update (not a true contradiction)', datetime('now'))
        `).run(id, projectId, edge.from_id, edge.to_id);
        newResolutions.push({ id, memory_id_1: edge.from_id, memory_id_2: edge.to_id, auto_resolved: 'version_update' });
        autoResolved++;
        continue;
      }

      const supersession = isTemporalSupersession(edge.from_created_at, edge.to_created_at);
      if (supersession) {
        // Check topic overlap to confirm they're about the same thing
        const words1 = new Set<string>(edge.from_content.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3));
        const words2 = new Set<string>(edge.to_content.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3));
        const overlap = [...words1].filter((w: string) => words2.has(w)).length;
        if (overlap >= 3) {
          const resType = supersession === 'first_newer' ? 'keep_first' : 'keep_second';
          db.prepare(`
            INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type, resolution_note, resolved_at)
            VALUES (?, ?, ?, ?, ?, 'Auto-resolved: temporal supersession (newer memory replaces older)', datetime('now'))
          `).run(id, projectId, edge.from_id, edge.to_id, resType);
          // Soft-delete the older memory
          const deleteId = supersession === 'first_newer' ? edge.to_id : edge.from_id;
          db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`).run(deleteId);
          newResolutions.push({ id, memory_id_1: edge.from_id, memory_id_2: edge.to_id, auto_resolved: 'temporal_supersession' });
          autoResolved++;
          continue;
        }
      }

      // Default: create pending resolution for manual review
      db.prepare(`
        INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type)
        VALUES (?, ?, ?, ?, 'pending')
      `).run(id, projectId, edge.from_id, edge.to_id);
      newResolutions.push({ id, memory_id_1: edge.from_id, memory_id_2: edge.to_id });
    }
  }

  return {
    project_id: projectId,
    unresolved_count: edges.length,
    new_resolutions_created: newResolutions.length,
    auto_resolved: autoResolved,
    contradictions: edges.map(e => ({
      edge_id: e.id,
      type: e.relation_type.replace('contradiction_', ''),
      memory1: { id: e.from_id, content: e.from_content.slice(0, 100) },
      memory2: { id: e.to_id, content: e.to_content.slice(0, 100) },
      confidence: e.confidence
    })),
    new_resolutions: newResolutions
  };
}
