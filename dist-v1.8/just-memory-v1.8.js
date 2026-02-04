"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Just-Memory v1.8 - Backup/Restore
 *
 * New in v1.8:
 * - memory_backup: Export memories, edges, scratchpad to JSON file
 * - memory_restore: Import from backup with merge/replace modes
 *
 * From v1.7:
 * - Semantic search (embeddings)
 * - Hybrid search (keyword + semantic)
 * - 22 tools (now 24)
 */
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
// @ts-ignore - better-sqlite3 types
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
// ============================================================================
// Embedding Setup - v1.7
// ============================================================================
// @ts-ignore - transformers.js types
const transformers_1 = require("@xenova/transformers");
// @ts-ignore - sqlite-vec types
const sqliteVec = __importStar(require("sqlite-vec"));
// Configure transformers cache
const MODEL_CACHE = (0, path_1.join)((0, os_1.homedir)(), '.just-memory', 'models');
transformers_1.env.cacheDir = MODEL_CACHE;
transformers_1.env.localModelPath = MODEL_CACHE;
// Embedding dimension for all-MiniLM-L6-v2
const EMBEDDING_DIM = 384;
// Embedder instance (pre-warmed on startup)
let embedder = null;
let embedderReady = false;
async function initEmbedder() {
    if (embedder)
        return;
    console.error('[Just-Memory] Pre-warming embedding model...');
    try {
        embedder = await (0, transformers_1.pipeline)('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true,
        });
        embedderReady = true;
        console.error('[Just-Memory] Embedding model ready');
    }
    catch (err) {
        console.error('[Just-Memory] Failed to load embedding model:', err);
        embedderReady = false;
    }
}
async function generateEmbedding(text) {
    if (!embedderReady || !embedder)
        return null;
    try {
        const result = await embedder(text, { pooling: 'mean', normalize: true });
        return new Float32Array(result.data);
    }
    catch (err) {
        console.error('[Just-Memory] Embedding generation failed:', err);
        return null;
    }
}
// ============================================================================
// Constants
// ============================================================================
const MAX_CONTENT_LENGTH = 100000;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;
const BACKUP_DIR = (0, path_1.join)((0, os_1.homedir)(), '.just-memory', 'backups');
// ============================================================================
// Confidence Thresholds
// ============================================================================
const CONFIDENCE_LEVELS = {
    HIGH: 0.8,
    MEDIUM: 0.5,
    LOW: 0.3,
    UNCERTAIN: 0.0
};
const CONFIDENCE_BOOST = {
    CONFIRMATION: 0.15,
    RECENT_ACCESS: 0.05,
    HIGH_IMPORTANCE: 0.1,
};
const CONFIDENCE_PENALTY = {
    CONTRADICTION: 0.2,
    DECAY_PER_DAY: 0.01,
};
// ============================================================================
// Database Setup
// ============================================================================
const DB_PATH = (0, path_1.join)((0, os_1.homedir)(), '.just-memory', 'memories.db');
const DB_DIR = (0, path_1.dirname)(DB_PATH);
if (!(0, fs_1.existsSync)(DB_DIR))
    (0, fs_1.mkdirSync)(DB_DIR, { recursive: true });
if (!(0, fs_1.existsSync)(MODEL_CACHE))
    (0, fs_1.mkdirSync)(MODEL_CACHE, { recursive: true });
if (!(0, fs_1.existsSync)(BACKUP_DIR))
    (0, fs_1.mkdirSync)(BACKUP_DIR, { recursive: true });
const db = new better_sqlite3_1.default(DB_PATH);
db.pragma('journal_mode = WAL');
// Load sqlite-vec extension
try {
    sqliteVec.load(db);
    console.error('[Just-Memory] sqlite-vec extension loaded');
}
catch (err) {
    console.error('[Just-Memory] Warning: sqlite-vec load failed, semantic search disabled:', err);
}
// Memories table
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'note',
    tags TEXT DEFAULT '[]',
    importance REAL DEFAULT 0.5,
    strength REAL DEFAULT 1.0,
    access_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_accessed TEXT DEFAULT (datetime('now')),
    deleted_at TEXT,
    confidence REAL DEFAULT 0.5,
    source_count INTEGER DEFAULT 1,
    contradiction_count INTEGER DEFAULT 0,
    embedding BLOB
  );
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
`);
// Bi-temporal edges
db.exec(`
  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    valid_from TEXT DEFAULT (datetime('now')),
    valid_to TEXT,
    confidence REAL DEFAULT 1.0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_id) REFERENCES memories(id),
    FOREIGN KEY (to_id) REFERENCES memories(id)
  );
  CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
  CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
  CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation_type);
`);
// Working memory/scratchpad
db.exec(`
  CREATE TABLE IF NOT EXISTS scratchpad (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
// Ensure columns exist for upgrades
try {
    db.exec('ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 0.5');
}
catch { }
try {
    db.exec('ALTER TABLE memories ADD COLUMN source_count INTEGER DEFAULT 1');
}
catch { }
try {
    db.exec('ALTER TABLE memories ADD COLUMN contradiction_count INTEGER DEFAULT 0');
}
catch { }
try {
    db.exec('ALTER TABLE memories ADD COLUMN embedding BLOB');
}
catch { }
// ============================================================================
// Input Validation
// ============================================================================
function sanitizeLikePattern(input) {
    return input.replace(/[%_]/g, '\\$&');
}
function validateContent(content) {
    if (!content || typeof content !== 'string') {
        throw new Error('Content is required and must be a string');
    }
    if (content.length > MAX_CONTENT_LENGTH) {
        throw new Error(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
    }
}
function validateTags(tags) {
    if (!Array.isArray(tags))
        return [];
    return tags.slice(0, MAX_TAGS_COUNT).map(t => String(t).slice(0, MAX_TAG_LENGTH)).filter(t => t.length > 0);
}
// ============================================================================
// Ebbinghaus Decay
// ============================================================================
const DECAY_CONSTANT = 0.5;
function calculateRetention(lastAccessed, strength) {
    const hoursSince = (Date.now() - new Date(lastAccessed).getTime()) / 3600000;
    return Math.exp(-hoursSince * DECAY_CONSTANT / (strength * 24));
}
function updateStrength(currentStrength, accessCount) {
    return Math.min(10, currentStrength + 0.2 * Math.log(accessCount + 1));
}
// ============================================================================
// Confidence Functions
// ============================================================================
function calculateEffectiveConfidence(memory) {
    let conf = memory.confidence;
    const daysSince = (Date.now() - new Date(memory.last_accessed).getTime()) / 86400000;
    conf -= daysSince * CONFIDENCE_PENALTY.DECAY_PER_DAY;
    conf += (memory.source_count - 1) * CONFIDENCE_BOOST.CONFIRMATION;
    conf -= memory.contradiction_count * CONFIDENCE_PENALTY.CONTRADICTION;
    if (memory.importance > 0.7)
        conf += CONFIDENCE_BOOST.HIGH_IMPORTANCE;
    return Math.max(0, Math.min(1, conf));
}
function assessConfidence(memory) {
    const conf = calculateEffectiveConfidence(memory);
    if (conf >= CONFIDENCE_LEVELS.HIGH)
        return { level: 'high' };
    if (conf >= CONFIDENCE_LEVELS.MEDIUM)
        return { level: 'medium' };
    if (conf >= CONFIDENCE_LEVELS.LOW)
        return { level: 'low' };
    return { level: 'uncertain', note: 'Low confidence - may need verification' };
}
function toConfidentMemory(m) {
    const assessment = assessConfidence(m);
    return {
        id: m.id, content: m.content,
        confidence: calculateEffectiveConfidence(m),
        confidenceLevel: assessment.level,
        ...(assessment.note ? { confidenceNote: assessment.note } : {})
    };
}
// ============================================================================
// Contradiction Detection
// ============================================================================
function findContradictions(content, limit = 5, excludeId) {
    const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const negations = ['not', "don't", "doesn't", "isn't", "aren't", "won't", "can't", "never", 'no'];
    const hasNegation = negations.some(n => content.toLowerCase().includes(n));
    let sql = 'SELECT * FROM memories WHERE deleted_at IS NULL';
    if (excludeId)
        sql += ' AND id != ?';
    const allMemories = (excludeId
        ? db.prepare(sql).all(excludeId)
        : db.prepare(sql).all());
    const scored = allMemories.map(m => {
        const mWords = m.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        const overlap = words.filter(w => mWords.includes(w)).length;
        const mHasNegation = negations.some(n => m.content.toLowerCase().includes(n));
        const potentialContradiction = overlap >= 2 && hasNegation !== mHasNegation;
        return { memory: m, overlap, potentialContradiction };
    });
    return scored.filter(s => s.potentialContradiction).sort((a, b) => b.overlap - a.overlap).slice(0, limit).map(s => s.memory);
}
// ============================================================================
// Core Memory Operations
// ============================================================================
async function storeMemory(content, type = 'note', tags = [], importance = 0.5, confidence = 0.5) {
    validateContent(content);
    const validTags = validateTags(tags);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    const contradictions = findContradictions(content);
    let adjustedConfidence = confidence;
    if (contradictions.length > 0) {
        adjustedConfidence = Math.max(0.2, confidence - 0.1 * contradictions.length);
    }
    const embedding = await generateEmbedding(content);
    const embeddingBuffer = embedding ? Buffer.from(embedding.buffer) : null;
    db.prepare(`INSERT INTO memories (id, content, type, tags, importance, confidence, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, content, type, JSON.stringify(validTags), importance, adjustedConfidence, embeddingBuffer);
    for (const c of contradictions) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'potential_contradiction', 0.5)`)
            .run(edgeId, id, c.id);
    }
    return {
        id, content, type, tags: validTags, importance,
        confidence: adjustedConfidence, strength: 1.0,
        hasEmbedding: embedding !== null,
        potentialContradictions: contradictions.map(c => ({ id: c.id, content: c.content.slice(0, 100) }))
    };
}
function recallMemory(id) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newStrength = updateStrength(memory.strength, memory.access_count);
    const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.RECENT_ACCESS);
    db.prepare(`UPDATE memories SET access_count = access_count + 1, strength = ?, confidence = ?, last_accessed = datetime('now') WHERE id = ?`)
        .run(newStrength, newConfidence, id);
    const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return {
        ...toConfidentMemory(updated),
        type: updated.type, tags: JSON.parse(updated.tags),
        importance: updated.importance, strength: updated.strength,
        access_count: updated.access_count, created_at: updated.created_at,
        last_accessed: updated.last_accessed,
        hasEmbedding: updated.embedding !== null,
        retention: calculateRetention(updated.last_accessed, updated.strength)
    };
}
async function updateMemory(id, updates) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const fields = [];
    const values = [];
    if (updates.content !== undefined) {
        validateContent(updates.content);
        fields.push('content = ?');
        values.push(updates.content);
        const embedding = await generateEmbedding(updates.content);
        if (embedding) {
            fields.push('embedding = ?');
            values.push(Buffer.from(embedding.buffer));
        }
        const contradictions = findContradictions(updates.content, 5, id);
        if (contradictions.length > 0) {
            for (const c of contradictions) {
                const existingEdge = db.prepare(`SELECT id FROM edges WHERE from_id = ? AND to_id = ? AND relation_type = 'potential_contradiction'`).get(id, c.id);
                if (!existingEdge) {
                    const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
                    db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'potential_contradiction', 0.5)`)
                        .run(edgeId, id, c.id);
                }
            }
        }
    }
    if (updates.type !== undefined) {
        fields.push('type = ?');
        values.push(updates.type);
    }
    if (updates.tags !== undefined) {
        fields.push('tags = ?');
        values.push(JSON.stringify(validateTags(updates.tags)));
    }
    if (updates.importance !== undefined) {
        fields.push('importance = ?');
        values.push(Math.max(0, Math.min(1, updates.importance)));
    }
    if (updates.confidence !== undefined) {
        fields.push('confidence = ?');
        values.push(Math.max(0, Math.min(1, updates.confidence)));
    }
    if (fields.length === 0)
        return { error: 'No valid updates provided', id };
    fields.push("last_accessed = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return {
        id: updated.id, content: updated.content, type: updated.type,
        tags: JSON.parse(updated.tags), importance: updated.importance,
        confidence: updated.confidence, hasEmbedding: updated.embedding !== null, updated: true
    };
}
// ============================================================================
// Search Functions
// ============================================================================
function keywordSearch(query, limit, confidenceThreshold) {
    const sanitizedQuery = sanitizeLikePattern(query);
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND content LIKE ? ESCAPE '\\' ORDER BY confidence DESC, importance DESC LIMIT ?`)
        .all(`%${sanitizedQuery}%`, limit * 2);
    return rows
        .map(m => ({ ...m, keywordScore: 1.0 }))
        .filter(m => calculateRetention(m.last_accessed, m.strength) > 0.1 && calculateEffectiveConfidence(m) >= confidenceThreshold);
}
async function semanticSearch(query, limit, confidenceThreshold) {
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
        console.error('[Just-Memory] Semantic search unavailable - embedder not ready');
        return [];
    }
    const queryBuffer = Buffer.from(queryEmbedding.buffer);
    try {
        const rows = db.prepare(`
      SELECT m.*, (1 - (vec_distance_cosine(m.embedding, ?) / 2)) as similarity
      FROM memories m
      WHERE m.deleted_at IS NULL AND m.embedding IS NOT NULL
      ORDER BY similarity DESC
      LIMIT ?
    `).all(queryBuffer, limit * 2);
        return rows
            .filter(m => m.similarity > 0.3 &&
            calculateRetention(m.last_accessed, m.strength) > 0.1 &&
            calculateEffectiveConfidence(m) >= confidenceThreshold)
            .map(m => ({ ...m, similarity: m.similarity }));
    }
    catch (err) {
        console.error('[Just-Memory] Semantic search error:', err);
        return [];
    }
}
async function hybridSearch(query, limit, confidenceThreshold, alpha = 0.5) {
    const [keywordResults, semanticResults] = await Promise.all([
        Promise.resolve(keywordSearch(query, limit, confidenceThreshold)),
        semanticSearch(query, limit, confidenceThreshold)
    ]);
    const merged = new Map();
    for (let i = 0; i < keywordResults.length; i++) {
        const m = keywordResults[i];
        const keywordScore = 1 - (i / keywordResults.length);
        merged.set(m.id, { ...m, keywordScore, hybridScore: alpha * keywordScore });
    }
    for (let i = 0; i < semanticResults.length; i++) {
        const m = semanticResults[i];
        const semanticScore = m.similarity || 0;
        if (merged.has(m.id)) {
            const existing = merged.get(m.id);
            existing.similarity = semanticScore;
            existing.hybridScore = (alpha * (existing.keywordScore || 0)) + ((1 - alpha) * semanticScore);
        }
        else {
            merged.set(m.id, { ...m, similarity: semanticScore, hybridScore: (1 - alpha) * semanticScore });
        }
    }
    return Array.from(merged.values())
        .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))
        .slice(0, limit);
}
async function searchMemories(query, limit = 10, confidenceThreshold = 0, mode = 'hybrid', alpha = 0.5) {
    let results;
    switch (mode) {
        case 'keyword':
            results = keywordSearch(query, limit, confidenceThreshold);
            break;
        case 'semantic':
            results = await semanticSearch(query, limit, confidenceThreshold);
            break;
        case 'hybrid':
        default:
            results = await hybridSearch(query, limit, confidenceThreshold, alpha);
            break;
    }
    return results.map(m => ({
        ...toConfidentMemory(m),
        tags: JSON.parse(m.tags),
        retention: calculateRetention(m.last_accessed, m.strength),
        hasEmbedding: m.embedding !== null,
        ...(m.similarity !== undefined ? { similarity: Math.round(m.similarity * 1000) / 1000 } : {}),
        ...(m.hybridScore !== undefined ? { hybridScore: Math.round(m.hybridScore * 1000) / 1000 } : {})
    })).slice(0, limit);
}
async function embedMemories(ids) {
    let rows;
    if (ids && ids.length > 0) {
        rows = db.prepare(`SELECT * FROM memories WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`)
            .all(...ids);
    }
    else {
        rows = db.prepare('SELECT * FROM memories WHERE embedding IS NULL AND deleted_at IS NULL').all();
    }
    let embedded = 0, failed = 0;
    for (const row of rows) {
        const embedding = await generateEmbedding(row.content);
        if (embedding) {
            db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(Buffer.from(embedding.buffer), row.id);
            embedded++;
        }
        else {
            failed++;
        }
    }
    return { embedded, failed, total: rows.length };
}
// ============================================================================
// List, Delete, Stats
// ============================================================================
function listMemories(limit = 20, includeWeak = false, includeUncertain = false) {
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT ?`).all(limit * 2);
    return rows
        .map(m => ({ ...toConfidentMemory(m), tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength), hasEmbedding: m.embedding !== null }))
        .filter(m => (includeWeak || m.retention > 0.1) && (includeUncertain || m.confidenceLevel !== 'uncertain'))
        .slice(0, limit);
}
function deleteMemory(id, permanent = false) {
    if (permanent)
        db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    else
        db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
    return { deleted: true, permanent };
}
function getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL').get().count;
    const withEmbedding = db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND embedding IS NOT NULL').get().count;
    const byConfidence = db.prepare(`
    SELECT SUM(CASE WHEN confidence >= 0.8 THEN 1 ELSE 0 END) as high,
           SUM(CASE WHEN confidence >= 0.5 AND confidence < 0.8 THEN 1 ELSE 0 END) as medium,
           SUM(CASE WHEN confidence >= 0.3 AND confidence < 0.5 THEN 1 ELSE 0 END) as low,
           SUM(CASE WHEN confidence < 0.3 THEN 1 ELSE 0 END) as uncertain
    FROM memories WHERE deleted_at IS NULL
  `).get();
    const edges = db.prepare('SELECT COUNT(*) as count FROM edges WHERE valid_to IS NULL').get().count;
    const scratch = db.prepare('SELECT COUNT(*) as count FROM scratchpad WHERE expires_at IS NULL OR expires_at > datetime("now")').get().count;
    return {
        total, withEmbedding, embeddingCoverage: total > 0 ? Math.round(withEmbedding / total * 100) : 0,
        byConfidenceLevel: byConfidence, activeEdges: edges, scratchpadItems: scratch,
        embeddingModel: 'all-MiniLM-L6-v2', embeddingDim: EMBEDDING_DIM,
        dbPath: DB_PATH, backupDir: BACKUP_DIR, version: '1.8.0'
    };
}
// ============================================================================
// Confidence Management
// ============================================================================
function confirmMemory(id, sourceId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newSourceCount = memory.source_count + 1;
    const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.CONFIRMATION);
    db.prepare(`UPDATE memories SET source_count = ?, confidence = ? WHERE id = ?`).run(newSourceCount, newConfidence, id);
    if (sourceId) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'confirms', 1.0)`).run(edgeId, sourceId, id);
    }
    return { confirmed: true, newConfidence, sourceCount: newSourceCount };
}
function contradictMemory(id, contradictingId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newCount = memory.contradiction_count + 1;
    const newConfidence = Math.max(0, memory.confidence - CONFIDENCE_PENALTY.CONTRADICTION);
    db.prepare(`UPDATE memories SET contradiction_count = ?, confidence = ? WHERE id = ?`).run(newCount, newConfidence, id);
    if (contradictingId) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'contradicts', 1.0)`).run(edgeId, contradictingId, id);
    }
    return { contradicted: true, newConfidence, contradictionCount: newCount };
}
function getConfidentMemories(threshold = CONFIDENCE_LEVELS.HIGH, limit = 10) {
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY confidence DESC LIMIT ?`).all(limit * 2);
    return rows.filter(m => calculateEffectiveConfidence(m) >= threshold).slice(0, limit).map(m => ({
        ...toConfidentMemory(m), tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength), hasEmbedding: m.embedding !== null
    }));
}
// ============================================================================
// Bi-temporal Edge Operations
// ============================================================================
function createEdge(fromId, toId, relationType, validFrom, validTo, confidence = 1.0, metadata = {}) {
    const fromExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(fromId);
    const toExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(toId);
    if (!fromExists || !toExists)
        return { error: 'Source or target memory not found' };
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, fromId, toId, relationType, validFrom || new Date().toISOString(), validTo || null, confidence, JSON.stringify(metadata));
    return { id, fromId, toId, relationType, validFrom, validTo, confidence };
}
function queryEdges(memoryId, direction = 'both', relationTypes, asOfDate, includeExpired = false) {
    const asOf = asOfDate || new Date().toISOString();
    const typeFilter = relationTypes?.length ? `AND relation_type IN (${relationTypes.map(() => '?').join(',')})` : '';
    const timeFilter = includeExpired ? '' : `AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)`;
    let results = [];
    const params = relationTypes?.length ? [...relationTypes] : [];
    if (!includeExpired) {
        params.push(asOf, asOf);
    }
    if (direction === 'outgoing' || direction === 'both') {
        const sql = `SELECT * FROM edges WHERE from_id = ? ${typeFilter} ${timeFilter}`;
        results.push(...db.prepare(sql).all(memoryId, ...params));
    }
    if (direction === 'incoming' || direction === 'both') {
        const sql = `SELECT * FROM edges WHERE to_id = ? ${typeFilter} ${timeFilter}`;
        results.push(...db.prepare(sql).all(memoryId, ...params));
    }
    return results.map(e => ({ ...e, metadata: JSON.parse(e.metadata) }));
}
function invalidateEdge(edgeId, validTo) {
    const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
    if (!edge)
        return { error: 'Edge not found', edgeId };
    db.prepare('UPDATE edges SET valid_to = ? WHERE id = ?').run(validTo || new Date().toISOString(), edgeId);
    return { invalidated: true, edgeId, validTo };
}
// ============================================================================
// Graph Traversal
// ============================================================================
function traverseGraph(seedIds, maxHops = 2, decayFactor = 0.5, inhibitionThreshold = 0.1, minActivation = 0.1) {
    const activation = new Map();
    const visited = new Set();
    for (const id of seedIds)
        activation.set(id, 1.0);
    for (let hop = 0; hop < maxHops; hop++) {
        const toProcess = [...activation.entries()].filter(([id, a]) => a >= inhibitionThreshold && !visited.has(id));
        for (const [nodeId, currentActivation] of toProcess) {
            visited.add(nodeId);
            const edges = db.prepare('SELECT * FROM edges WHERE (from_id = ? OR to_id = ?) AND (valid_to IS NULL OR valid_to > datetime("now"))').all(nodeId, nodeId);
            for (const edge of edges) {
                const neighborId = edge.from_id === nodeId ? edge.to_id : edge.from_id;
                const spread = currentActivation * decayFactor * edge.confidence;
                if (spread >= minActivation) {
                    const existing = activation.get(neighborId) || 0;
                    activation.set(neighborId, Math.max(existing, spread));
                }
            }
        }
    }
    const sortedIds = [...activation.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 20);
    const memories = db.prepare(`SELECT * FROM memories WHERE id IN (${sortedIds.map(() => '?').join(',')}) AND deleted_at IS NULL`).all(...sortedIds);
    return memories.map(m => ({
        ...toConfidentMemory(m), activation: activation.get(m.id), tags: JSON.parse(m.tags),
        retention: calculateRetention(m.last_accessed, m.strength), hasEmbedding: m.embedding !== null
    })).sort((a, b) => (b.activation || 0) - (a.activation || 0));
}
// ============================================================================
// Scratchpad (Working Memory)
// ============================================================================
function scratchSet(key, value, ttlSeconds) {
    const expires = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, value, expires_at, created_at) VALUES (?, ?, ?, datetime('now'))`).run(key, value, expires);
    return { key, set: true, expires };
}
function scratchGet(key) {
    const row = db.prepare('SELECT * FROM scratchpad WHERE key = ? AND (expires_at IS NULL OR expires_at > datetime("now"))').get(key);
    return row ? { key, value: row.value, expires: row.expires_at } : { key, error: 'Not found or expired' };
}
function scratchDelete(key) {
    db.prepare('DELETE FROM scratchpad WHERE key = ?').run(key);
    return { key, deleted: true };
}
function scratchClear() {
    const result = db.prepare('DELETE FROM scratchpad').run();
    return { cleared: true, count: result.changes };
}
function scratchList() {
    const rows = db.prepare('SELECT * FROM scratchpad WHERE expires_at IS NULL OR expires_at > datetime("now")').all();
    return rows.map(r => ({ key: r.key, preview: r.value.slice(0, 100), expires: r.expires_at }));
}
// ============================================================================
// Session Briefing
// ============================================================================
function generateBriefing(maxTokens = 2000) {
    const recentHigh = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND confidence >= 0.7 ORDER BY last_accessed DESC LIMIT 5`).all();
    const scratch = db.prepare('SELECT * FROM scratchpad WHERE expires_at IS NULL OR expires_at > datetime("now") ORDER BY created_at DESC LIMIT 3').all();
    const contradictions = db.prepare(`SELECT m.* FROM memories m JOIN edges e ON m.id = e.from_id OR m.id = e.to_id WHERE e.relation_type = 'potential_contradiction' AND e.valid_to IS NULL AND m.deleted_at IS NULL LIMIT 3`).all();
    const stats = getStats();
    return {
        summary: {
            totalMemories: stats.total,
            withEmbeddings: stats.withEmbedding,
            embeddingCoverage: `${stats.embeddingCoverage}%`,
            confidenceBreakdown: stats.byConfidenceLevel,
            scratchpadItems: stats.scratchpadItems
        },
        recentImportant: recentHigh.map(m => ({ id: m.id, preview: m.content.slice(0, 150), confidence: calculateEffectiveConfidence(m), type: m.type })),
        workingMemory: scratch.map(s => ({ key: s.key, preview: s.value.slice(0, 100) })),
        needsAttention: contradictions.length > 0 ? contradictions.map(m => ({ id: m.id, preview: m.content.slice(0, 100), issue: 'potential_contradiction' })) : [],
        version: '1.8.0'
    };
}
// ============================================================================
// v1.8: Backup/Restore Operations
// ============================================================================
function backupMemories(path, includeDeleted = false, includeScratchpad = true, includeEmbeddings = false) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path ? (0, path_1.resolve)(path) : (0, path_1.join)(BACKUP_DIR, `backup-${timestamp}.json`);
    // Ensure parent directory exists
    const parentDir = (0, path_1.dirname)(backupPath);
    if (!(0, fs_1.existsSync)(parentDir)) {
        (0, fs_1.mkdirSync)(parentDir, { recursive: true });
    }
    // Get memories
    const memorySql = includeDeleted
        ? 'SELECT * FROM memories'
        : 'SELECT * FROM memories WHERE deleted_at IS NULL';
    const memories = db.prepare(memorySql).all();
    // Get edges
    const edges = db.prepare('SELECT * FROM edges').all();
    // Get scratchpad
    const scratchpad = includeScratchpad
        ? db.prepare('SELECT * FROM scratchpad').all()
        : [];
    // Build backup data
    const backup = {
        version: '1.8.0',
        created_at: new Date().toISOString(),
        memories: memories.map(m => {
            const { embedding, ...rest } = m;
            const result = { ...rest };
            if (includeEmbeddings && embedding) {
                result.embedding_base64 = embedding.toString('base64');
            }
            return result;
        }),
        edges,
        scratchpad
    };
    // Write file
    (0, fs_1.writeFileSync)(backupPath, JSON.stringify(backup, null, 2), 'utf-8');
    return {
        success: true,
        path: backupPath,
        stats: {
            memories: memories.length,
            edges: edges.length,
            scratchpad: scratchpad.length,
            includeDeleted,
            includeScratchpad,
            includeEmbeddings,
            sizeBytes: JSON.stringify(backup).length
        }
    };
}
async function restoreMemories(path, mode = 'merge') {
    const backupPath = (0, path_1.resolve)(path);
    if (!(0, fs_1.existsSync)(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
    }
    const content = (0, fs_1.readFileSync)(backupPath, 'utf-8');
    let backup;
    try {
        backup = JSON.parse(content);
    }
    catch (err) {
        throw new Error('Invalid backup file format - not valid JSON');
    }
    // Validate backup format
    if (!backup.version || !backup.memories || !Array.isArray(backup.memories)) {
        throw new Error('Invalid backup file format - missing required fields');
    }
    const stats = {
        mode,
        memoriesProcessed: 0,
        memoriesInserted: 0,
        memoriesSkipped: 0,
        edgesProcessed: 0,
        edgesInserted: 0,
        edgesSkipped: 0,
        scratchpadProcessed: 0,
        scratchpadInserted: 0,
        embeddingsRestored: 0,
        embeddingsRegenerated: 0
    };
    // Use transaction for atomicity
    const restoreTransaction = db.transaction(async () => {
        // Clear existing data if replace mode
        if (mode === 'replace') {
            db.prepare('DELETE FROM edges').run();
            db.prepare('DELETE FROM scratchpad').run();
            db.prepare('DELETE FROM memories').run();
        }
        // Restore memories
        for (const m of backup.memories) {
            stats.memoriesProcessed++;
            // Check if memory exists
            const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(m.id);
            if (existing && mode === 'merge') {
                stats.memoriesSkipped++;
                continue;
            }
            // Handle embedding
            let embeddingBuffer = null;
            if (m.embedding_base64) {
                embeddingBuffer = Buffer.from(m.embedding_base64, 'base64');
                stats.embeddingsRestored++;
            }
            if (mode === 'replace' || !existing) {
                db.prepare(`
          INSERT OR REPLACE INTO memories 
          (id, content, type, tags, importance, strength, access_count, created_at, last_accessed, deleted_at, confidence, source_count, contradiction_count, embedding)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(m.id, m.content, m.type, m.tags, m.importance, m.strength, m.access_count, m.created_at, m.last_accessed, m.deleted_at, m.confidence, m.source_count, m.contradiction_count, embeddingBuffer);
                stats.memoriesInserted++;
            }
        }
        // Restore edges
        if (backup.edges) {
            for (const e of backup.edges) {
                stats.edgesProcessed++;
                const existing = db.prepare('SELECT id FROM edges WHERE id = ?').get(e.id);
                if (existing && mode === 'merge') {
                    stats.edgesSkipped++;
                    continue;
                }
                if (mode === 'replace' || !existing) {
                    db.prepare(`
            INSERT OR REPLACE INTO edges 
            (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(e.id, e.from_id, e.to_id, e.relation_type, e.valid_from, e.valid_to, e.confidence, e.metadata, e.created_at);
                    stats.edgesInserted++;
                }
            }
        }
        // Restore scratchpad
        if (backup.scratchpad) {
            for (const s of backup.scratchpad) {
                stats.scratchpadProcessed++;
                const existing = db.prepare('SELECT key FROM scratchpad WHERE key = ?').get(s.key);
                if (existing && mode === 'merge') {
                    continue;
                }
                if (mode === 'replace' || !existing) {
                    db.prepare(`
            INSERT OR REPLACE INTO scratchpad (key, value, expires_at, created_at)
            VALUES (?, ?, ?, ?)
          `).run(s.key, s.value, s.expires_at, s.created_at);
                    stats.scratchpadInserted++;
                }
            }
        }
    });
    // Execute transaction (note: transaction itself is sync, embedding gen is separate)
    restoreTransaction();
    // Regenerate missing embeddings if embedder is ready
    if (embedderReady) {
        const noEmbedding = db.prepare('SELECT * FROM memories WHERE embedding IS NULL AND deleted_at IS NULL').all();
        for (const m of noEmbedding) {
            const embedding = await generateEmbedding(m.content);
            if (embedding) {
                db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(Buffer.from(embedding.buffer), m.id);
                stats.embeddingsRegenerated++;
            }
        }
    }
    return { success: true, stats };
}
// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new index_js_1.Server({ name: 'just-memory', version: '1.8.0' }, { capabilities: { tools: {} } });
// Tool schemas - 24 tools (22 from v1.7 + memory_backup + memory_restore)
const TOOLS = {
    // Core Memory (8)
    memory_store: { name: 'memory_store', description: 'Store a new memory with optional embedding generation', inputSchema: {
            type: 'object', properties: {
                content: { type: 'string', description: 'Content to remember' },
                type: { type: 'string', default: 'note' },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
            }, required: ['content']
        } },
    memory_recall: { name: 'memory_recall', description: 'Retrieve a memory by ID (boosts strength)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' } }, required: ['id']
        } },
    memory_update: { name: 'memory_update', description: 'Edit existing memory (content, type, tags, importance, confidence). Regenerates embedding if content changes.', inputSchema: {
            type: 'object', properties: {
                id: { type: 'string' }, content: { type: 'string' }, type: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
            }, required: ['id']
        } },
    memory_search: { name: 'memory_search', description: 'Search memories. Modes: keyword (LIKE), semantic (embeddings), hybrid (both). Hybrid recommended.', inputSchema: {
            type: 'object', properties: {
                query: { type: 'string' },
                limit: { type: 'number', default: 10 },
                confidenceThreshold: { type: 'number', default: 0, description: 'Min confidence (0-1)' },
                mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], default: 'hybrid' },
                alpha: { type: 'number', default: 0.5, description: 'Hybrid weight: 0=pure semantic, 1=pure keyword' }
            }, required: ['query']
        } },
    memory_list: { name: 'memory_list', description: 'List recent memories', inputSchema: {
            type: 'object', properties: {
                limit: { type: 'number', default: 20 },
                includeWeak: { type: 'boolean', default: false },
                includeUncertain: { type: 'boolean', default: false }
            }
        } },
    memory_delete: { name: 'memory_delete', description: 'Soft-delete memory (or permanent)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, permanent: { type: 'boolean', default: false } }, required: ['id']
        } },
    memory_stats: { name: 'memory_stats', description: 'Database statistics including embedding coverage', inputSchema: {
            type: 'object', properties: {}
        } },
    memory_embed: { name: 'memory_embed', description: 'Generate embeddings for existing memories. Omit IDs to embed all without embeddings.', inputSchema: {
            type: 'object', properties: {
                ids: { type: 'array', items: { type: 'string' } }
            }
        } },
    // v1.8: Backup/Restore (2)
    memory_backup: { name: 'memory_backup', description: 'Export memories, edges, and scratchpad to JSON backup file. Default path: ~/.just-memory/backups/', inputSchema: {
            type: 'object', properties: {
                path: { type: 'string', description: 'Custom backup file path (optional)' },
                includeDeleted: { type: 'boolean', default: false, description: 'Include soft-deleted memories' },
                includeScratchpad: { type: 'boolean', default: true, description: 'Include working memory' },
                includeEmbeddings: { type: 'boolean', default: false, description: 'Include embedding vectors (larger file)' }
            }
        } },
    memory_restore: { name: 'memory_restore', description: 'Import memories from backup file. Merge keeps existing, replace clears first.', inputSchema: {
            type: 'object', properties: {
                path: { type: 'string', description: 'Backup file path to restore from' },
                restoreMode: { type: 'string', enum: ['merge', 'replace'], default: 'merge', description: 'merge=keep existing, replace=clear first' }
            }, required: ['path']
        } },
    // Confidence (3)
    memory_confirm: { name: 'memory_confirm', description: 'Confirm memory with additional source', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, sourceId: { type: 'string' } }, required: ['id']
        } },
    memory_contradict: { name: 'memory_contradict', description: 'Record contradiction to memory', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, contradictingId: { type: 'string' } }, required: ['id']
        } },
    memory_confident: { name: 'memory_confident', description: 'Get high-confidence memories', inputSchema: {
            type: 'object', properties: { confidenceThreshold: { type: 'number', default: 0.8 }, limit: { type: 'number', default: 10 } }
        } },
    // Edges (3)
    edge_create: { name: 'edge_create', description: 'Create bi-temporal edge between memories', inputSchema: {
            type: 'object', properties: {
                fromId: { type: 'string' }, toId: { type: 'string' }, relationType: { type: 'string' },
                validFrom: { type: 'string' }, validTo: { type: 'string' },
                confidence: { type: 'number', default: 1 }, metadata: { type: 'object' }
            }, required: ['fromId', 'toId', 'relationType']
        } },
    edge_query: { name: 'edge_query', description: 'Query edges for a memory', inputSchema: {
            type: 'object', properties: {
                memoryId: { type: 'string' },
                direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], default: 'both' },
                relationTypes: { type: 'array', items: { type: 'string' } },
                asOfDate: { type: 'string' }, includeExpired: { type: 'boolean', default: false }
            }, required: ['memoryId']
        } },
    edge_invalidate: { name: 'edge_invalidate', description: 'Invalidate an edge', inputSchema: {
            type: 'object', properties: { edgeId: { type: 'string' }, validTo: { type: 'string' } }, required: ['edgeId']
        } },
    // Graph (1)
    graph_traverse: { name: 'graph_traverse', description: 'Traverse graph with spreading activation from seed memories', inputSchema: {
            type: 'object', properties: {
                seedIds: { type: 'array', items: { type: 'string' } },
                maxHops: { type: 'number', default: 2 },
                decayFactor: { type: 'number', default: 0.5 },
                inhibitionThreshold: { type: 'number', default: 0.1 },
                minActivation: { type: 'number', default: 0.1 }
            }, required: ['seedIds']
        } },
    // Scratchpad (5)
    scratch_set: { name: 'scratch_set', description: 'Set working memory value with optional TTL', inputSchema: {
            type: 'object', properties: {
                key: { type: 'string' }, value: { type: 'string' }, ttlSeconds: { type: 'number' }
            }, required: ['key', 'value']
        } },
    scratch_get: { name: 'scratch_get', description: 'Get working memory value', inputSchema: {
            type: 'object', properties: { key: { type: 'string' } }, required: ['key']
        } },
    scratch_delete: { name: 'scratch_delete', description: 'Delete working memory key', inputSchema: {
            type: 'object', properties: { key: { type: 'string' } }, required: ['key']
        } },
    scratch_clear: { name: 'scratch_clear', description: 'Clear all working memory', inputSchema: {
            type: 'object', properties: {}
        } },
    scratch_list: { name: 'scratch_list', description: 'List working memory keys', inputSchema: {
            type: 'object', properties: {}
        } },
    // Session (1)
    memory_briefing: { name: 'memory_briefing', description: 'Generate session briefing with recent important memories and items needing attention', inputSchema: {
            type: 'object', properties: { maxTokens: { type: 'number', default: 2000 } }
        } }
};
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({ tools: Object.values(TOOLS) }));
// Tool request handler
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args || {});
    try {
        let result;
        switch (name) {
            // Core memory
            case 'memory_store':
                result = await storeMemory(a.content, a.type, a.tags, a.importance, a.confidence);
                break;
            case 'memory_recall':
                result = recallMemory(a.id);
                break;
            case 'memory_update':
                result = await updateMemory(a.id, { content: a.content, type: a.type, tags: a.tags, importance: a.importance, confidence: a.confidence });
                break;
            case 'memory_search':
                result = await searchMemories(a.query, a.limit, a.confidenceThreshold, a.mode, a.alpha);
                break;
            case 'memory_list':
                result = listMemories(a.limit, a.includeWeak, a.includeUncertain);
                break;
            case 'memory_delete':
                result = deleteMemory(a.id, a.permanent);
                break;
            case 'memory_stats':
                result = getStats();
                break;
            case 'memory_embed':
                result = await embedMemories(a.ids);
                break;
            // v1.8: Backup/Restore
            case 'memory_backup':
                result = backupMemories(a.path, a.includeDeleted, a.includeScratchpad, a.includeEmbeddings);
                break;
            case 'memory_restore':
                result = await restoreMemories(a.path, a.restoreMode);
                break;
            // Confidence
            case 'memory_confirm':
                result = confirmMemory(a.id, a.sourceId);
                break;
            case 'memory_contradict':
                result = contradictMemory(a.id, a.contradictingId);
                break;
            case 'memory_confident':
                result = getConfidentMemories(a.confidenceThreshold, a.limit);
                break;
            // Edges
            case 'edge_create':
                result = createEdge(a.fromId, a.toId, a.relationType, a.validFrom, a.validTo, a.confidence, a.metadata);
                break;
            case 'edge_query':
                result = queryEdges(a.memoryId, a.direction, a.relationTypes, a.asOfDate, a.includeExpired);
                break;
            case 'edge_invalidate':
                result = invalidateEdge(a.edgeId, a.validTo);
                break;
            // Graph
            case 'graph_traverse':
                result = traverseGraph(a.seedIds, a.maxHops, a.decayFactor, a.inhibitionThreshold, a.minActivation);
                break;
            // Scratchpad
            case 'scratch_set':
                result = scratchSet(a.key, a.value, a.ttlSeconds);
                break;
            case 'scratch_get':
                result = scratchGet(a.key);
                break;
            case 'scratch_delete':
                result = scratchDelete(a.key);
                break;
            case 'scratch_clear':
                result = scratchClear();
                break;
            case 'scratch_list':
                result = scratchList();
                break;
            // Session
            case 'memory_briefing':
                result = generateBriefing(a.maxTokens);
                break;
            default:
                return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ error: errorMsg }) }] };
    }
});
// ============================================================================
// Main
// ============================================================================
async function main() {
    console.error('[Just-Memory v1.8] Starting...');
    await initEmbedder();
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('[Just-Memory v1.8] Server running - 24 tools available');
}
main().catch(err => {
    console.error('[Just-Memory v1.8] Fatal error:', err);
    process.exit(1);
});
