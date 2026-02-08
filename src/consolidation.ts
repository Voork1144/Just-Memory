/**
 * Just-Memory Consolidation (v4.0)
 * Memory decay, strengthening, similarity detection, scratchpad cleanup.
 * v4.0: VectorStore-aware similarity search (Qdrant or sqlite-vec).
 */
import Database from 'better-sqlite3';
import { safeParse, EMBEDDING_DIM } from './config.js';
import type { VectorStore } from './vector-store.js';

// ============================================================================
// Find Similar Memories (for consolidation/merge suggestions)
// v4.0: Uses VectorStore when available, embedding cosine fallback, Jaccard last resort
// ============================================================================

function cosineSimilarityFromBlobs(a: Buffer, b: Buffer): number {
  try {
    const fa = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
    const fb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    if (fa.length !== fb.length || fa.length !== EMBEDDING_DIM) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let k = 0; k < fa.length; k++) {
      dot += fa[k] * fb[k];
      normA += fa[k] * fa[k];
      normB += fb[k] * fb[k];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  } catch {
    return 0;
  }
}

/**
 * Find similar memories using VectorStore KNN when available.
 * At 1M+ memories, this uses Qdrant's HNSW instead of O(n^2) pairwise comparison.
 */
export async function findSimilarMemoriesAsync(
  db: Database.Database,
  projectId: string,
  vectorStore?: VectorStore,
  similarityThreshold = 0.85,
  limit = 20
): Promise<any[]> {
  // v4.0: Use VectorStore for streaming KNN — check each recent memory against the index
  if (vectorStore?.isReady()) {
    const recentMemories = db.prepare(`
      SELECT id, content, type, tags, importance, confidence, access_count, created_at, embedding
      FROM memories
      WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
      ORDER BY created_at DESC
      LIMIT 50
    `).all(projectId) as any[];

    const similar: any[] = [];

    for (const mem of recentMemories) {
      if (similar.length >= limit) break;
      if (!mem.embedding) continue;

      const embedding = new Float32Array(
        mem.embedding.buffer, mem.embedding.byteOffset, mem.embedding.byteLength / 4
      );

      // Find neighbors for this memory via VectorStore
      const neighbors = await vectorStore.search(embedding, 5, {
        projectId,
        excludeDeleted: true,
        excludeIds: [mem.id],
      });

      for (const neighbor of neighbors) {
        if (similar.length >= limit) break;
        if (neighbor.score >= similarityThreshold) {
          // Avoid duplicate pairs
          const pairKey = [mem.id, neighbor.id].sort().join('-');
          if (similar.some(s => [s.memory1.id, s.memory2.id].sort().join('-') === pairKey)) continue;

          similar.push({
            memory1: { id: mem.id, content: mem.content.slice(0, 100) },
            memory2: { id: neighbor.id, content: '(fetched via VectorStore)' },
            similarity: neighbor.score,
            method: `vectorstore:${vectorStore.backend}`,
            suggestion: 'consolidate',
          });
        }
      }
    }

    // Enrich memory2 content for display
    if (similar.length > 0) {
      const mem2Ids = similar.map(s => s.memory2.id);
      const uniqueIds = [...new Set(mem2Ids)];
      const placeholders = uniqueIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id, content FROM memories WHERE id IN (${placeholders})`).all(...uniqueIds) as any[];
      const contentMap = new Map(rows.map(r => [r.id, r.content]));
      for (const s of similar) {
        const content = contentMap.get(s.memory2.id);
        if (content) s.memory2.content = content.slice(0, 100);
      }
    }

    return similar;
  }

  // Fallback: pairwise comparison (works for < 50K memories)
  return findSimilarMemories(db, projectId, similarityThreshold, limit);
}

/**
 * Synchronous pairwise comparison (original v3.13 behavior).
 * Used when VectorStore is not available.
 */
export function findSimilarMemories(
  db: Database.Database,
  projectId: string,
  similarityThreshold = 0.85,
  limit = 20
): any[] {
  const memories = db.prepare(`
    SELECT id, content, type, tags, importance, confidence, access_count, created_at, embedding
    FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
    ORDER BY created_at DESC
    LIMIT 100
  `).all(projectId) as any[];

  // Check if any memories have embeddings
  const hasEmbeddings = memories.some(m => m.embedding != null);

  const similar: any[] = [];
  const checked = new Set<string>();

  for (let i = 0; i < memories.length && similar.length < limit; i++) {
    for (let j = i + 1; j < memories.length && similar.length < limit; j++) {
      const key = `${memories[i].id}-${memories[j].id}`;
      if (checked.has(key)) continue;
      checked.add(key);

      let similarity = 0;
      let method = 'jaccard';

      // v3.13: Prefer embedding cosine similarity over word Jaccard
      if (hasEmbeddings && memories[i].embedding && memories[j].embedding) {
        similarity = cosineSimilarityFromBlobs(memories[i].embedding, memories[j].embedding);
        method = 'cosine';
      } else {
        // Fallback: word-level Jaccard
        const a = memories[i].content.toLowerCase();
        const b = memories[j].content.toLowerCase();
        const wordsA = new Set(a.split(/\s+/).filter((w: string) => w.length > 3));
        const wordsB = new Set(b.split(/\s+/).filter((w: string) => w.length > 3));

        if (wordsA.size === 0 || wordsB.size === 0) continue;

        const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
        const union = new Set([...wordsA, ...wordsB]).size;
        similarity = intersection / union;
      }

      if (similarity >= similarityThreshold) {
        similar.push({
          memory1: { id: memories[i].id, content: memories[i].content.slice(0, 100) },
          memory2: { id: memories[j].id, content: memories[j].content.slice(0, 100) },
          similarity,
          method,
          suggestion: 'consolidate',
        });
      }
    }
  }

  return similar;
}

// ============================================================================
// Strengthen Active Memories
// ============================================================================

export function strengthenActiveMemories(db: Database.Database, projectId: string): number {
  // Increase confidence for memories accessed more than average
  const avgAccess = db.prepare(`
    SELECT AVG(access_count) as avg FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
  `).get(projectId) as any;

  // v3.13: Lowered from 3 to 1 — previously never fired because max access_count was 2
  const threshold = Math.max(avgAccess?.avg || 1, 1);

  const result = db.prepare(`
    UPDATE memories
    SET confidence = MIN(confidence + 0.05, 1.0),
        updated_at = datetime('now')
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND access_count > ?
      AND confidence < 0.95
  `).run(projectId, threshold);

  return result.changes;
}

// ============================================================================
// Memory Decay
// ============================================================================

export function applyMemoryDecay(db: Database.Database, projectId: string): number {
  // v3.13: Shortened from 30 days to 14 days — matches actual usage patterns
  const decayCutoff = new Date();
  decayCutoff.setDate(decayCutoff.getDate() - 14);

  const result = db.prepare(`
    UPDATE memories
    SET strength = MAX(strength - 0.1, 0.1),
        updated_at = datetime('now')
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND last_accessed < ?
      AND strength > 0.2
      AND importance < 0.8
  `).run(projectId, decayCutoff.toISOString());

  return result.changes;
}

// ============================================================================
// Scratchpad Cleanup
// ============================================================================

export function cleanExpiredScratchpad(db: Database.Database, projectId: string): number {
  const result = db.prepare(`
    DELETE FROM scratchpad
    WHERE (project_id = ? OR project_id = 'global')
      AND expires_at IS NOT NULL
      AND expires_at < datetime('now')
  `).run(projectId);

  return result.changes;
}

// ============================================================================
// Tool Log Pruning
// ============================================================================

export function pruneToolLogs(db: Database.Database, daysToKeep: number = 7): number {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM tool_calls WHERE timestamp < ?').run(cutoff);
  return result.changes;
}
