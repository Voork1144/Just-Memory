"use strict";
/**
 * Just-Memory Contradiction Detection
 *
 * Detects contradicting facts when storing new memories using:
 * - Semantic similarity to find related memories
 * - Negation patterns (antonyms, explicit negation)
 * - Temporal contradiction (newer facts supersede older)
 * - Entity-attribute conflicts
 *
 * Based on research from TACL 2024: "When Can LLMs Actually Correct Their Own Mistakes?"
 * Key differentiator feature for Just-Memory MCP server.
 *
 * @module contradiction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectContradiction = detectContradiction;
exports.checkAndAdjustConfidence = checkAndAdjustConfidence;
exports.flagContradiction = flagContradiction;
exports.resolveContradiction = resolveContradiction;
exports.getUnresolvedContradictions = getUnresolvedContradictions;
exports.getContradictionStats = getContradictionStats;
const database_js_1 = require("./database.js");
const embeddings_js_1 = require("./embeddings.js");
const project_isolation_js_1 = require("./project-isolation.js");
// Negation patterns for direct contradiction detection
const NEGATION_PATTERNS = [
    /\bis not\b/i,
    /\bisn't\b/i,
    /\bwas not\b/i,
    /\bwasn't\b/i,
    /\bdoes not\b/i,
    /\bdoesn't\b/i,
    /\bcan not\b/i,
    /\bcannot\b/i,
    /\bcan't\b/i,
    /\bwill not\b/i,
    /\bwon't\b/i,
    /\bnever\b/i,
    /\bno longer\b/i,
    /\bno\s+\w+\b/i,
];
// Common antonym pairs for contradiction detection
const ANTONYM_PAIRS = new Map([
    ['true', ['false', 'untrue', 'incorrect', 'wrong']],
    ['false', ['true', 'correct', 'right', 'accurate']],
    ['yes', ['no', 'negative', 'nope']],
    ['no', ['yes', 'affirmative', 'positive']],
    ['alive', ['dead', 'deceased', 'passed']],
    ['dead', ['alive', 'living', 'surviving']],
    ['open', ['closed', 'shut', 'locked']],
    ['closed', ['open', 'unlocked', 'ajar']],
    ['hot', ['cold', 'freezing', 'chilly']],
    ['cold', ['hot', 'warm', 'burning']],
    ['high', ['low', 'small', 'little']],
    ['low', ['high', 'tall', 'great']],
    ['good', ['bad', 'poor', 'terrible']],
    ['bad', ['good', 'great', 'excellent']],
    ['big', ['small', 'tiny', 'little']],
    ['small', ['big', 'large', 'huge']],
    ['fast', ['slow', 'sluggish']],
    ['slow', ['fast', 'quick', 'rapid']],
    ['new', ['old', 'ancient', 'outdated']],
    ['old', ['new', 'modern', 'recent']],
    ['start', ['end', 'stop', 'finish']],
    ['end', ['start', 'begin', 'commence']],
    ['increase', ['decrease', 'reduce', 'lower']],
    ['decrease', ['increase', 'raise', 'grow']],
    ['win', ['lose', 'lost', 'defeat']],
    ['lose', ['win', 'won', 'victory']],
    ['success', ['failure', 'fail', 'unsuccessful']],
    ['failure', ['success', 'successful', 'achievement']],
]);
/**
 * Check if a new memory contradicts existing memories
 *
 * @param content - New memory content to check
 * @param options - Detection options
 * @returns Contradiction result with details
 */
async function detectContradiction(content, options = {}) {
    const { similarityThreshold = 0.65, confidenceThreshold = 0.5, maxCandidates = 20, projectId = (0, project_isolation_js_1.getProjectContext)().id, includeGlobal = true, } = options;
    // Step 1: Find semantically similar memories
    const candidates = await findSimilarMemories(content, {
        limit: maxCandidates,
        projectId,
        includeGlobal,
        minSimilarity: similarityThreshold,
    });
    if (candidates.length === 0) {
        return { hasContradiction: false, confidence: 0 };
    }
    // Step 2: Check each candidate for contradictions
    let bestContradiction = { hasContradiction: false, confidence: 0 };
    for (const candidate of candidates) {
        const result = analyzeContradiction(content, candidate.memory.content, candidate.similarity);
        if (result.hasContradiction && result.confidence > bestContradiction.confidence) {
            bestContradiction = {
                ...result,
                conflictingMemory: candidate.memory,
            };
        }
    }
    // Only report if above confidence threshold
    if (bestContradiction.confidence < confidenceThreshold) {
        return { hasContradiction: false, confidence: 0 };
    }
    return bestContradiction;
}
/**
 * Find semantically similar memories using vector search
 */
async function findSimilarMemories(content, options) {
    const db = (0, database_js_1.getDatabase)();
    // Generate embedding for new content
    const embedding = await (0, embeddings_js_1.generateEmbedding)(content);
    if (!embedding) {
        return [];
    }
    // Build project filter
    const projectFilter = (0, project_isolation_js_1.buildProjectFilter)({
        projectId: options.projectId,
        includeGlobal: options.includeGlobal,
        allProjects: false,
    });
    // Query for similar memories
    const query = `
    SELECT 
      m.id,
      m.content,
      m.type,
      m.tags,
      m.importance,
      m.confidence_score,
      m.project_id,
      m.created_at,
      m.updated_at,
      m.deleted_at,
      m.embedding
    FROM memories m
    WHERE m.deleted_at IS NULL
      AND m.embedding IS NOT NULL
      ${projectFilter.clause}
    ORDER BY m.created_at DESC
    LIMIT ?
  `;
    const rows = db.prepare(query).all(...projectFilter.params, options.limit * 3);
    // Calculate cosine similarity for each
    const candidates = [];
    for (const row of rows) {
        if (!row.embedding)
            continue;
        const memoryEmbedding = (0, embeddings_js_1.bufferToEmbedding)(row.embedding);
        if (!memoryEmbedding)
            continue;
        const similarity = (0, embeddings_js_1.cosineSimilarity)(embedding, memoryEmbedding);
        if (similarity >= options.minSimilarity) {
            candidates.push({
                memory: {
                    id: row.id,
                    content: row.content,
                    type: row.type,
                    tags: row.tags ? JSON.parse(row.tags) : [],
                    importance: row.importance,
                    source: null,
                    metadata: {},
                    decayEnabled: false,
                    lastAccessedAt: null,
                    accessCount: 0,
                    projectId: row.project_id,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                    deletedAt: row.deleted_at,
                },
                similarity,
            });
        }
    }
    // Sort by similarity descending and limit
    return candidates
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, options.limit);
}
/**
 * Analyze two pieces of content for contradictions
 */
function analyzeContradiction(newContent, existingContent, similarity) {
    const newLower = newContent.toLowerCase();
    const existingLower = existingContent.toLowerCase();
    // Check for direct negation patterns
    const negationResult = checkNegation(newLower, existingLower);
    if (negationResult.hasContradiction) {
        return {
            ...negationResult,
            confidence: Math.min(negationResult.confidence * similarity * 1.5, 0.95),
        };
    }
    // Check for antonym contradictions
    const antonymResult = checkAntonyms(newLower, existingLower);
    if (antonymResult.hasContradiction) {
        return {
            ...antonymResult,
            confidence: Math.min(antonymResult.confidence * similarity * 1.3, 0.9),
        };
    }
    // Check for numeric contradictions
    const numericResult = checkNumericContradiction(newContent, existingContent);
    if (numericResult.hasContradiction) {
        return {
            ...numericResult,
            confidence: Math.min(numericResult.confidence * similarity * 1.4, 0.92),
        };
    }
    // Check for entity-attribute conflicts
    const entityResult = checkEntityConflict(newLower, existingLower);
    if (entityResult.hasContradiction) {
        return {
            ...entityResult,
            confidence: Math.min(entityResult.confidence * similarity, 0.85),
        };
    }
    return { hasContradiction: false, confidence: 0 };
}
/**
 * Check for direct negation patterns
 */
function checkNegation(newContent, existingContent) {
    // Check if new content negates existing
    const newHasNegation = NEGATION_PATTERNS.some(p => p.test(newContent));
    const existingHasNegation = NEGATION_PATTERNS.some(p => p.test(existingContent));
    // Extract subject from both (simplified entity extraction)
    const newSubject = extractSubject(newContent);
    const existingSubject = extractSubject(existingContent);
    // If same subject but one is negated and one isn't
    if (newSubject && existingSubject && newSubject === existingSubject) {
        if (newHasNegation !== existingHasNegation) {
            return {
                hasContradiction: true,
                confidence: 0.8,
                contradictionType: 'negation',
                explanation: `Direct negation: "${newContent.slice(0, 50)}..." vs "${existingContent.slice(0, 50)}..."`,
                suggestedAction: 'replace',
            };
        }
    }
    // Check for explicit contradiction patterns
    // e.g., "X is Y" vs "X is not Y"
    const patterns = [
        { regex: /(\w+)\s+is\s+(\w+)/, type: 'is' },
        { regex: /(\w+)\s+was\s+(\w+)/, type: 'was' },
        { regex: /(\w+)\s+are\s+(\w+)/, type: 'are' },
    ];
    for (const p of patterns) {
        const newMatch = newContent.match(p.regex);
        const existingMatch = existingContent.match(p.regex);
        if (newMatch && existingMatch && newMatch[1] === existingMatch[1]) {
            // Same subject, check if attributes contradict
            const negatedNew = newContent.includes('not ' + newMatch[2]) ||
                newContent.includes("n't " + newMatch[2]);
            const negatedExisting = existingContent.includes('not ' + existingMatch[2]) ||
                existingContent.includes("n't " + existingMatch[2]);
            if (negatedNew !== negatedExisting && newMatch[2] === existingMatch[2]) {
                return {
                    hasContradiction: true,
                    confidence: 0.85,
                    contradictionType: 'negation',
                    explanation: `"${newMatch[1]} ${p.type} ${newMatch[2]}" contradicts existing memory`,
                    suggestedAction: 'replace',
                };
            }
        }
    }
    return { hasContradiction: false, confidence: 0 };
}
/**
 * Check for antonym contradictions
 */
function checkAntonyms(newContent, existingContent) {
    const newWords = new Set(newContent.split(/\s+/));
    const existingWords = new Set(existingContent.split(/\s+/));
    for (const [word, antonyms] of Array.from(ANTONYM_PAIRS)) {
        // Check if new has word and existing has antonym (or vice versa)
        if (newWords.has(word)) {
            for (const antonym of antonyms) {
                if (existingWords.has(antonym)) {
                    return {
                        hasContradiction: true,
                        confidence: 0.7,
                        contradictionType: 'antonym',
                        explanation: `Antonym conflict: "${word}" vs "${antonym}"`,
                        suggestedAction: 'flag',
                    };
                }
            }
        }
        // Also check reverse
        if (existingWords.has(word)) {
            for (const antonym of antonyms) {
                if (newWords.has(antonym)) {
                    return {
                        hasContradiction: true,
                        confidence: 0.7,
                        contradictionType: 'antonym',
                        explanation: `Antonym conflict: "${antonym}" vs "${word}"`,
                        suggestedAction: 'flag',
                    };
                }
            }
        }
    }
    return { hasContradiction: false, confidence: 0 };
}
/**
 * Check for numeric contradictions
 */
function checkNumericContradiction(newContent, existingContent) {
    // Extract numbers with context
    const newNumbers = extractNumbers(newContent);
    const existingNumbers = extractNumbers(existingContent);
    for (const newNum of newNumbers) {
        for (const existingNum of existingNumbers) {
            // Same context but different values
            if (newNum.context === existingNum.context && newNum.value !== existingNum.value) {
                const percentDiff = Math.abs(newNum.value - existingNum.value) /
                    Math.max(newNum.value, existingNum.value);
                // Only flag significant differences (>10%)
                if (percentDiff > 0.1) {
                    return {
                        hasContradiction: true,
                        confidence: Math.min(0.6 + percentDiff * 0.3, 0.9),
                        contradictionType: 'numeric',
                        explanation: `Numeric disagreement: ${newNum.value} vs ${existingNum.value} (${(percentDiff * 100).toFixed(1)}% difference)`,
                        suggestedAction: percentDiff > 0.5 ? 'replace' : 'flag',
                    };
                }
            }
        }
    }
    return { hasContradiction: false, confidence: 0 };
}
/**
 * Check for entity-attribute conflicts
 */
function checkEntityConflict(newContent, existingContent) {
    // Extract entity-attribute pairs
    const newPairs = extractEntityAttributes(newContent);
    const existingPairs = extractEntityAttributes(existingContent);
    for (const newPair of newPairs) {
        for (const existingPair of existingPairs) {
            // Same entity and attribute type but different value
            if (newPair.entity === existingPair.entity &&
                newPair.attribute === existingPair.attribute &&
                newPair.value !== existingPair.value) {
                return {
                    hasContradiction: true,
                    confidence: 0.75,
                    contradictionType: 'entity_conflict',
                    explanation: `Entity conflict: ${newPair.entity}'s ${newPair.attribute} is "${newPair.value}" vs "${existingPair.value}"`,
                    suggestedAction: 'replace',
                };
            }
        }
    }
    return { hasContradiction: false, confidence: 0 };
}
/** Extract subject from a sentence (simplified) */
function extractSubject(content) {
    const patterns = [
        /^(\w+(?:\s+\w+)?)\s+is\b/i,
        /^(\w+(?:\s+\w+)?)\s+are\b/i,
        /^(\w+(?:\s+\w+)?)\s+was\b/i,
        /^(\w+(?:\s+\w+)?)\s+has\b/i,
    ];
    for (const p of patterns) {
        const match = content.match(p);
        if (match && match[1])
            return match[1].toLowerCase();
    }
    return null;
}
/** Extract numbers with surrounding context */
function extractNumbers(content) {
    const results = [];
    // Pattern to capture number with surrounding words
    const patterns = [
        /(\w+)\s+(?:is|are|was|were|equals?|=)\s+(\d+(?:\.\d+)?)\s*(\w*)/gi,
        /(\d+(?:\.\d+)?)\s+(years?|months?|days?|percent|%|dollars?|\$|euros?|pounds?)\s+(?:of\s+)?(\w+)/gi,
        /(\w+)\s+(?:costs?|prices?|values?)\s+(?:\$|€|£)?(\d+(?:\.\d+)?)/gi,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const numStr = match[2] ?? match[1] ?? '';
            const num = parseFloat(numStr);
            if (!isNaN(num)) {
                results.push({
                    value: num,
                    context: match[0].toLowerCase().replace(/\d+(?:\.\d+)?/, 'X'),
                    unit: match[3] ?? match[2] ?? undefined,
                });
            }
        }
    }
    return results;
}
/** Extract entity-attribute pairs from content */
function extractEntityAttributes(content) {
    const results = [];
    // Common patterns for entity-attribute statements
    const patterns = [
        // "Entity's attribute is value"
        /(\w+(?:\s+\w+)?)'s\s+(\w+)\s+is\s+([^.!?,]+)/gi,
        // "The attribute of entity is value"
        /the\s+(\w+)\s+of\s+(\w+(?:\s+\w+)?)\s+is\s+([^.!?,]+)/gi,
        // "Entity has a attribute of value"
        /(\w+(?:\s+\w+)?)\s+has\s+(?:a\s+)?(\w+)\s+of\s+([^.!?,]+)/gi,
        // "Entity works at/lives in/located at value"
        /(\w+(?:\s+\w+)?)\s+(works at|lives in|located at|born in|based in)\s+([^.!?,]+)/gi,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            if (match[1] && match[2] && match[3]) {
                results.push({
                    entity: match[1].toLowerCase().trim(),
                    attribute: match[2].toLowerCase().trim(),
                    value: match[3].toLowerCase().trim(),
                });
            }
        }
    }
    return results;
}
/**
 * Check for contradictions and update confidence score if found
 *
 * @param memoryId - ID of memory to check against
 * @param newContent - New content being stored
 * @returns Updated confidence score (lowered if contradiction found)
 */
async function checkAndAdjustConfidence(_memoryId, newContent, currentConfidence = 1.0) {
    const result = await detectContradiction(newContent);
    if (!result.hasContradiction) {
        return { confidence: currentConfidence };
    }
    // Lower confidence based on contradiction confidence
    const adjustedConfidence = currentConfidence * (1 - result.confidence * 0.5);
    return {
        confidence: Math.max(adjustedConfidence, 0.1), // Never go below 0.1
        contradiction: result,
    };
}
/**
 * Flag a memory as contradicted
 * Stores contradiction metadata in the database
 */
async function flagContradiction(memoryId, conflictingId, contradictionType, explanation) {
    const db = (0, database_js_1.getDatabase)();
    // Check if contradictions table exists, create if not
    db.exec(`
    CREATE TABLE IF NOT EXISTS contradictions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      conflicting_id TEXT NOT NULL,
      contradiction_type TEXT NOT NULL,
      explanation TEXT,
      resolved BOOLEAN DEFAULT FALSE,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id),
      FOREIGN KEY (conflicting_id) REFERENCES memories(id)
    )
  `);
    const id = `ctr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
    INSERT INTO contradictions (id, memory_id, conflicting_id, contradiction_type, explanation)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, memoryId, conflictingId, contradictionType, explanation);
}
/**
 * Resolve a flagged contradiction
 */
async function resolveContradiction(contradictionId, resolution) {
    const db = (0, database_js_1.getDatabase)();
    db.prepare(`
    UPDATE contradictions
    SET resolved = TRUE, resolved_at = datetime('now')
    WHERE id = ?
  `).run(contradictionId);
    // Get the contradiction details
    const row = db.prepare(`
    SELECT memory_id, conflicting_id FROM contradictions WHERE id = ?
  `).get(contradictionId);
    if (!row)
        return;
    // Apply resolution
    switch (resolution) {
        case 'keep_new':
            // Soft delete the old memory
            db.prepare(`
        UPDATE memories SET deleted_at = datetime('now') WHERE id = ?
      `).run(row.conflicting_id);
            break;
        case 'keep_old':
            // Soft delete the new memory
            db.prepare(`
        UPDATE memories SET deleted_at = datetime('now') WHERE id = ?
      `).run(row.memory_id);
            break;
        // keep_both and merge don't delete anything
    }
}
/**
 * Get all unresolved contradictions
 */
async function getUnresolvedContradictions() {
    const db = (0, database_js_1.getDatabase)();
    const rows = db.prepare(`
    SELECT id, memory_id, conflicting_id, contradiction_type, explanation, created_at
    FROM contradictions
    WHERE resolved = FALSE
    ORDER BY created_at DESC
  `).all();
    return rows.map(row => ({
        id: row.id,
        memoryId: row.memory_id,
        conflictingId: row.conflicting_id,
        contradictionType: row.contradiction_type,
        explanation: row.explanation,
        createdAt: row.created_at,
    }));
}
/**
 * Get contradiction statistics
 */
async function getContradictionStats() {
    const db = (0, database_js_1.getDatabase)();
    // Check if table exists
    try {
        const total = db.prepare(`SELECT COUNT(*) as count FROM contradictions`).get()?.count || 0;
        const unresolved = db.prepare(`SELECT COUNT(*) as count FROM contradictions WHERE resolved = FALSE`).get()?.count || 0;
        const byTypeRows = db.prepare(`
      SELECT contradiction_type, COUNT(*) as count
      FROM contradictions
      GROUP BY contradiction_type
    `).all();
        const byType = {};
        for (const row of byTypeRows) {
            byType[row.contradiction_type] = row.count;
        }
        return { total, unresolved, byType: byType };
    }
    catch {
        return { total: 0, unresolved: 0, byType: {} };
    }
}
//# sourceMappingURL=contradiction.js.map