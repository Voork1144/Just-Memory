/**
 * Just-Memory Contradiction Detection (v4.0)
 * Semantic similarity, NLI, pattern analysis, factual & antonym conflict detection.
 */
import Database from 'better-sqlite3';
import {
  CONTRADICTION_CONFIG, NEGATION_PATTERNS, FACTUAL_PATTERNS,
  EMBEDDING_DIM, ContradictionResult, ExtractedFact,
} from './config.js';
import { generateEmbedding, checkContradictionNLI, getModelState } from './models.js';

// ============================================================================
// Fact Extraction
// ============================================================================

/**
 * Extract factual claims from text using pattern matching
 */
export function extractFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();

    for (const pattern of FACTUAL_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        if (match.length === 3) {
          facts.push({
            subject: match[1].trim().toLowerCase(),
            predicate: 'is',
            object: match[2].trim().toLowerCase(),
            raw: trimmed,
          });
        } else if (match.length === 4) {
          facts.push({
            subject: `${match[1]} of ${match[2]}`.trim().toLowerCase(),
            predicate: 'is',
            object: match[3].trim().toLowerCase(),
            raw: trimmed,
          });
        }
        break;
      }
    }
  }

  return facts;
}

// ============================================================================
// Negation & Antonym Detection
// ============================================================================

/**
 * Check if text contains explicit negation
 */
export function hasNegation(text: string): { has: boolean; type: 'explicit' | 'implicit' | 'none'; word?: string } {
  const lowerText = text.toLowerCase();
  const words = new Set(lowerText.split(/\W+/));

  // Use word set for exact match to prevent substring false positives
  // e.g. "no" matching "note", "know", "notification"
  for (const neg of NEGATION_PATTERNS.EXPLICIT) {
    if (neg.includes(' ')) {
      if (lowerText.includes(neg)) return { has: true, type: 'explicit', word: neg };
    } else {
      if (words.has(neg)) return { has: true, type: 'explicit', word: neg };
    }
  }

  for (const neg of NEGATION_PATTERNS.IMPLICIT) {
    if (neg.includes(' ')) {
      if (lowerText.includes(neg)) return { has: true, type: 'implicit', word: neg };
    } else {
      if (words.has(neg)) return { has: true, type: 'implicit', word: neg };
    }
  }

  return { has: false, type: 'none' };
}

/**
 * Check if two texts contain antonym pairs in meaningful context.
 * Requires the antonym words to appear near shared topic words (within 5-word window)
 * to reduce false positives from incidental word matches.
 */
export function findAntonymConflict(text1: string, text2: string): { found: boolean; pair?: [string, string] } {
  const words1 = text1.toLowerCase().split(/\W+/).filter(w => w.length > 0);
  const words2 = text2.toLowerCase().split(/\W+/).filter(w => w.length > 0);
  const set1 = new Set(words1);
  const set2 = new Set(words2);

  // Find shared topic words (4+ chars, appear in both texts)
  const sharedTopicWords = words1.filter(w => w.length >= 4 && set2.has(w));

  // If texts share fewer than 2 topic words, antonym match is likely coincidental
  if (sharedTopicWords.length < 2) return { found: false };

  const PROXIMITY_WINDOW = 5;

  for (const [a, b] of NEGATION_PATTERNS.ANTONYMS) {
    const aInText1 = set1.has(a);
    const bInText2 = set2.has(b);
    const bInText1 = set1.has(b);
    const aInText2 = set2.has(a);

    if (!((aInText1 && bInText2) || (bInText1 && aInText2))) continue;

    // Check proximity: is the antonym word near a shared topic word?
    const checkProximity = (words: string[], antonym: string): boolean => {
      const idx = words.indexOf(antonym);
      if (idx === -1) return false;
      const windowStart = Math.max(0, idx - PROXIMITY_WINDOW);
      const windowEnd = Math.min(words.length, idx + PROXIMITY_WINDOW + 1);
      const window = words.slice(windowStart, windowEnd);
      return sharedTopicWords.some(tw => window.includes(tw));
    };

    if (aInText1 && bInText2) {
      if (checkProximity(words1, a) || checkProximity(words2, b)) {
        return { found: true, pair: [a, b] };
      }
    }
    if (bInText1 && aInText2) {
      if (checkProximity(words1, b) || checkProximity(words2, a)) {
        return { found: true, pair: [b, a] };
      }
    }
  }

  return { found: false };
}

// ============================================================================
// Factual Contradiction
// ============================================================================

/**
 * Check if two facts contradict each other
 */
export function factsContradict(fact1: ExtractedFact, fact2: ExtractedFact): boolean {
  // Same subject but different object
  const subject1Clean = fact1.subject.replace(/\s+/g, ' ').trim();
  const subject2Clean = fact2.subject.replace(/\s+/g, ' ').trim();

  // v3.13: Require subjects to have meaningful length (>= 2 words) to prevent fragment matching
  const subjectWords1 = subject1Clean.split(' ').filter(w => w.length > 2);
  const subjectWords2 = subject2Clean.split(' ').filter(w => w.length > 2);

  let subjectSimilar = false;

  if (subjectWords1.length >= 2 && subjectWords2.length >= 2) {
    // Multi-word subjects: require >= 2 overlapping words (original v3.13 logic)
    const subjectOverlap = subjectWords1.filter(w => subjectWords2.includes(w)).length;
    subjectSimilar = subjectOverlap >= 2 && subjectOverlap >= Math.min(subjectWords1.length, subjectWords2.length) * 0.5;
  } else if (subjectWords1.length >= 1 && subjectWords2.length >= 1) {
    // v4.3.1: Short subjects (1 significant word like "python"): require exact match
    subjectSimilar = subject1Clean === subject2Clean;
  } else {
    // No significant words at all — skip
    return false;
  }

  if (subjectSimilar) {
    // Different objects = potential contradiction
    const object1Clean = fact1.object.replace(/\s+/g, ' ').trim();
    const object2Clean = fact2.object.replace(/\s+/g, ' ').trim();

    if (object1Clean !== object2Clean) {
      // Check if objects are numbers (numeric contradiction)
      const num1 = parseFloat(object1Clean.replace(/[^0-9.]/g, ''));
      const num2 = parseFloat(object2Clean.replace(/[^0-9.]/g, ''));

      if (!isNaN(num1) && !isNaN(num2) && num1 !== num2) {
        return true;
      }

      // Check if objects share no words (completely different)
      const objWords1 = object1Clean.split(' ').filter(w => w.length > 2);
      const objWords2 = object2Clean.split(' ').filter(w => w.length > 2);
      const objOverlap = objWords1.filter(w => objWords2.includes(w)).length;

      if (objOverlap === 0 && objWords1.length > 0 && objWords2.length > 0) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// Embedding Utilities
// ============================================================================

/**
 * Validate embedding buffer has correct dimensions for current model.
 * Returns false for legacy 384-dim embeddings or malformed buffers.
 */
export function isValidEmbedding(buffer: Buffer | null | undefined): boolean {
  if (!buffer) return false;
  const expectedBytes = EMBEDDING_DIM * 4; // float32 = 4 bytes
  return buffer.length === expectedBytes;
}

export function cosineSimilarity(a: Buffer, b: Buffer): number {
  if (!a || !b) return 0;

  // Validate both embeddings have correct dimensions
  if (!isValidEmbedding(a) || !isValidEmbedding(b)) {
    // Dimension mismatch - log once and return 0
    if (a.length !== b.length) {
      console.error(`[Just-Memory v4.0] Embedding dimension mismatch: ${a.length / 4} vs ${b.length / 4} (expected ${EMBEDDING_DIM})`);
    }
    return 0;
  }

  // Safe bounds checking for Float32Array construction
  const elementCountA = Math.floor(a.length / 4);
  const elementCountB = Math.floor(b.length / 4);
  if (elementCountA === 0 || elementCountB === 0 || elementCountA !== elementCountB) return 0;

  // Additional bounds validation: ensure buffer has enough bytes for the view
  const requiredBytesA = a.byteOffset + elementCountA * 4;
  const requiredBytesB = b.byteOffset + elementCountB * 4;
  if (requiredBytesA > a.buffer.byteLength || requiredBytesB > b.buffer.byteLength) {
    console.error('[Just-Memory v4.0] Buffer bounds violation in cosineSimilarity');
    return 0;
  }

  const vecA = new Float32Array(a.buffer, a.byteOffset, elementCountA);
  const vecB = new Float32Array(b.buffer, b.byteOffset, elementCountB);

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================================
// Enhanced Contradiction Detection
// ============================================================================

export interface HNSWProvider {
  isReady: () => boolean;
  search: (embedding: Float32Array, limit: number, efSearch: number) => string[];
}

/**
 * ENHANCED: Find contradictions using semantic similarity + NLI + pattern analysis
 * v3.1: Added NLI-based contradiction detection using DeBERTa-v3-base
 */
export async function findContradictionsEnhanced(
  db: Database.Database,
  content: string,
  projectId: string,
  hnsw: HNSWProvider,
  limit = CONTRADICTION_CONFIG.MAX_RESULTS,
  excludeId?: string,
  includeSemanticSearch = true
): Promise<ContradictionResult[]> {
  const results: ContradictionResult[] = [];
  const contentFacts = extractFacts(content);
  const contentNegation = hasNegation(content);
  const contentLower = content.toLowerCase();
  const contentWords = contentLower.split(/\W+/).filter(w => w.length > 3);

  // Get all active memories in project
  let sql = 'SELECT * FROM memories WHERE deleted_at IS NULL AND (project_id = ? OR project_id = \'global\')';
  const params: any[] = [projectId];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }

  // Generate embedding for semantic search if available
  let contentEmbedding: Float32Array | null = null;
  if (includeSemanticSearch && getModelState().embedderReady) {
    contentEmbedding = await generateEmbedding(content);
  }

  // Use HNSW index for fast candidate retrieval if available
  let candidateIds: string[] = [];
  if (hnsw.isReady() && contentEmbedding) {
    // Get top 50 candidates from HNSW (fast O(log n) search)
    candidateIds = hnsw.search(contentEmbedding, 50, 100);
    if (candidateIds.length > 0) {
      sql += ` AND id IN (${candidateIds.map(() => '?').join(',')})`;
      params.push(...candidateIds);
    }
  } else {
    // v3.13: Without HNSW, limit to 200 most recent memories to prevent O(n) at scale
    sql += ' ORDER BY created_at DESC LIMIT 200';
  }

  const allMemories = db.prepare(sql).all(...params) as any[];

  for (const memory of allMemories) {
    const memoryLower = memory.content.toLowerCase();
    const memoryWords = memoryLower.split(/\W+/).filter((w: string) => w.length > 3);

    // Calculate word overlap
    const wordOverlap = contentWords.filter(w => memoryWords.includes(w)).length;
    const overlapRatio = wordOverlap / Math.max(contentWords.length, memoryWords.length);

    // Skip if no meaningful overlap and no embedding
    if (overlapRatio < 0.1 && !contentEmbedding) continue;

    // Calculate semantic similarity if embeddings available (v3.13: validate dimensions)
    let semanticSimilarity = 0;
    if (contentEmbedding && memory.embedding && isValidEmbedding(memory.embedding)) {
      semanticSimilarity = cosineSimilarity(memory.embedding, Buffer.from(new Uint8Array(contentEmbedding.buffer)));
    }

    // Skip if neither semantic nor word overlap
    if (semanticSimilarity < CONTRADICTION_CONFIG.SEMANTIC_SIMILARITY_THRESHOLD && overlapRatio < 0.15) {
      continue;
    }

    const memoryNegation = hasNegation(memory.content);
    const memoryFacts = extractFacts(memory.content);
    const antonymConflict = findAntonymConflict(content, memory.content);

    // Check for different types of contradictions

    // 1. Negation contradiction: one has negation, the other doesn't, but they discuss same topic
    // v3.8: Raised thresholds significantly to reduce false positives
    if ((contentNegation.has !== memoryNegation.has) && overlapRatio >= 0.4 && semanticSimilarity >= 0.75) {
      const explanation = contentNegation.has
        ? `New memory contains negation "${contentNegation.word}" while existing memory is affirmative on similar topic`
        : `Existing memory contains negation "${memoryNegation.word}" while new memory is affirmative on similar topic`;

      results.push({
        id: memory.id,
        content: memory.content,
        contradictionType: 'negation',
        confidence: Math.min(0.9, overlapRatio + semanticSimilarity * 0.5),
        similarity: Math.max(overlapRatio, semanticSimilarity),
        explanation,
        suggestedAction: 'review',
      });
    }

    // 2. Antonym contradiction: texts contain opposing words near shared topic words
    // v3.8: Raised thresholds significantly to reduce false positives
    else if (antonymConflict.found && overlapRatio >= 0.4 && semanticSimilarity >= 0.75) {
      results.push({
        id: memory.id,
        content: memory.content,
        contradictionType: 'antonym',
        confidence: Math.min(0.85, overlapRatio + 0.3),
        similarity: Math.max(overlapRatio, semanticSimilarity),
        explanation: `Contains opposing terms: "${antonymConflict.pair?.[0] ?? 'unknown'}" vs "${antonymConflict.pair?.[1] ?? 'unknown'}"`,
        suggestedAction: 'review',
      });
    }

    // 3. Factual contradiction: same subject, different object
    // v3.13: Require minimum semantic similarity (0.6) to prevent matching unrelated content
    else if (contentFacts.length > 0 && memoryFacts.length > 0 && (semanticSimilarity >= 0.6 || overlapRatio >= 0.3)) {
      for (const fact1 of contentFacts) {
        for (const fact2 of memoryFacts) {
          if (factsContradict(fact1, fact2)) {
            results.push({
              id: memory.id,
              content: memory.content,
              contradictionType: 'factual',
              confidence: 0.9,
              similarity: Math.max(overlapRatio, semanticSimilarity),
              explanation: `Factual conflict: "${fact1.raw}" contradicts "${fact2.raw}"`,
              suggestedAction: 'resolve',
            });
            break;
          }
        }
      }
    }

    // 4. High semantic similarity with low word overlap (possible rephrasing with different meaning)
    // v3.8: Must have BOTH negation (not OR) and very high similarity
    else if (semanticSimilarity >= CONTRADICTION_CONFIG.FACTUAL_SIMILARITY_THRESHOLD &&
             overlapRatio < 0.3 && overlapRatio > 0.1 &&
             contentNegation.has && memoryNegation.has) {
      results.push({
        id: memory.id,
        content: memory.content,
        contradictionType: 'semantic',
        confidence: semanticSimilarity * 0.8,
        similarity: semanticSimilarity,
        explanation: `High semantic similarity (${(semanticSimilarity * 100).toFixed(1)}%) but different wording with potential negation`,
        suggestedAction: 'review',
      });
    }

    // 5. NLI-based contradiction detection (v3.1)
    // Use DeBERTa-v3-base for high-accuracy detection on ambiguous cases
    // v3.8: Raised threshold significantly to reduce false positives
    else if (getModelState().nliReady && semanticSimilarity >= CONTRADICTION_CONFIG.NLI_SIMILARITY_THRESHOLD) {
      // Only run NLI on candidates with HIGH similarity (expensive operation)
      try {
        const nliResult = await checkContradictionNLI(content, memory.content);

        if (nliResult.isContradiction && nliResult.confidence > CONTRADICTION_CONFIG.NLI_CONFIDENCE_THRESHOLD) {
          results.push({
            id: memory.id,
            content: memory.content,
            contradictionType: 'nli',
            confidence: nliResult.confidence,
            similarity: semanticSimilarity,
            explanation: `NLI model detected contradiction with ${(nliResult.confidence * 100).toFixed(1)}% confidence`,
            suggestedAction: nliResult.confidence > 0.8 ? 'resolve' : 'review',
          });
        }
      } catch (nliError: any) {
        // NLI failure is non-fatal - log and continue without NLI result
        console.error(`[Just-Memory v4.0] NLI check failed for memory ${memory.id}: ${nliError.message}`);
      }
    }
  }

  // Sort by confidence and return top results
  return results
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
