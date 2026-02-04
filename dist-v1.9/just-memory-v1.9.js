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
 * Just-Memory v1.9 - Best of Both Worlds
 *
 * Combines v1.7 Knowledge Graph Entities + v1.8 Semantic Search:
 *
 * From v1.7:
 * - Entity-based knowledge graph (people, concepts, projects)
 * - memory_entity_create/get/link/search/observe/delete (6 tools)
 *
 * From v1.8:
 * - Semantic search (embeddings via all-MiniLM-L6-v2)
 * - Hybrid search (keyword + semantic)
 * - Backup/Restore with merge/replace modes
 *
 * Total: 30 tools (24 from v1.8 + 6 entity tools)
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
// Embedding Setup - v1.8
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
    if (embedder) return;
    console.error('[Just-Memory] Pre-warming embedding model...');
    try {
        embedder = await (0, transformers_1.pipeline)('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true,
        });
        embedderReady = true;
        console.error('[Just-Memory] Embedding model ready');
    } catch (err) {
        console.error('[Just-Memory] Failed to load embedding model:', err);
        embedderReady = false;
    }
}

async function generateEmbedding(text) {
    if (!embedderReady || !embedder) return null;
    try {
        const result = await embedder(text, { pooling: 'mean', normalize: true });
        return new Float32Array(result.data);
    } catch (err) {
        console.error('[Just-Memory] Embedding generation failed:', err);
        return null;
    }
}

// ============================================================================
// Constants (merged v1.7 + v1.8)
// ============================================================================
const MAX_CONTENT_LENGTH = 100000;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;
const MAX_ENTITY_NAME_LENGTH = 200;  // v1.7
const MAX_OBSERVATIONS = 100;        // v1.7
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
// Database Setup (merged v1.7 + v1.8)
// ============================================================================
const DB_PATH = (0, path_1.join)((0, os_1.homedir)(), '.just-memory', 'memories.db');
const DB_DIR = (0, path_1.dirname)(DB_PATH);
if (!(0, fs_1.existsSync)(DB_DIR)) (0, fs_1.mkdirSync)(DB_DIR, { recursive: true });
if (!(0, fs_1.existsSync)(MODEL_CACHE)) (0, fs_1.mkdirSync)(MODEL_CACHE, { recursive: true });
if (!(0, fs_1.existsSync)(BACKUP_DIR)) (0, fs_1.mkdirSync)(BACKUP_DIR, { recursive: true });

const db = new better_sqlite3_1.default(DB_PATH);
db.pragma('journal_mode = WAL');

// Load sqlite-vec extension for semantic search
try {
    sqliteVec.load(db);
    console.error('[Just-Memory] sqlite-vec extension loaded');
} catch (err) {
    console.error('[Just-Memory] Warning: sqlite-vec load failed, semantic search disabled:', err);
}

// Memories table (with embedding column from v1.8)
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

// Bi-temporal edges (for memories)
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

// v1.7: Entities table (knowledge graph nodes)
db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    entity_type TEXT DEFAULT 'concept',
    observations TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
  CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
`);

// v1.7: Entity relations table (knowledge graph edges)
db.exec(`
  CREATE TABLE IF NOT EXISTS entity_relations (
    id TEXT PRIMARY KEY,
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_entity) REFERENCES entities(name),
    FOREIGN KEY (to_entity) REFERENCES entities(name)
  );
  CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_entity);
  CREATE INDEX IF NOT EXISTS idx_entity_relations_to ON entity_relations(to_entity);
  CREATE INDEX IF NOT EXISTS idx_entity_relations_type ON entity_relations(relation_type);
`);

// Ensure columns exist for upgrades
try { db.exec('ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 0.5'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN source_count INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN contradiction_count INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN embedding BLOB'); } catch {}

// ============================================================================
// Input Validation (merged)
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
    if (!Array.isArray(tags)) return [];
    return tags.slice(0, MAX_TAGS_COUNT).map(t => String(t).slice(0, MAX_TAG_LENGTH)).filter(t => t.length > 0);
}

// v1.7: Entity validation
function validateEntityName(name) {
    if (!name || typeof name !== 'string') {
        throw new Error('Entity name is required');
    }
    if (name.length > MAX_ENTITY_NAME_LENGTH) {
        throw new Error(`Entity name exceeds maximum length of ${MAX_ENTITY_NAME_LENGTH} characters`);
    }
}

function validateObservations(observations) {
    if (!Array.isArray(observations)) return [];
    return observations
        .slice(0, MAX_OBSERVATIONS)
        .map(o => String(o).slice(0, MAX_CONTENT_LENGTH))
        .filter(o => o.length > 0);
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
    if (memory.importance > 0.7) conf += CONFIDENCE_BOOST.HIGH_IMPORTANCE;
    return Math.max(0, Math.min(1, conf));
}

function assessConfidence(memory) {
    const conf = calculateEffectiveConfidence(memory);
    if (conf >= CONFIDENCE_LEVELS.HIGH) return { level: 'high' };
    if (conf >= CONFIDENCE_LEVELS.MEDIUM) return { level: 'medium' };
    if (conf >= CONFIDENCE_LEVELS.LOW) return { level: 'low' };
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
    if (excludeId) sql += ' AND id != ?';
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
// Core Memory Operations (with embeddings)
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
    if (!memory) return { error: 'Memory not found', id };
    
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
    if (!memory) return { error: 'Memory not found', id };
    
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
    
    if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(validateTags(updates.tags))); }
    if (updates.importance !== undefined) { fields.push('importance = ?'); values.push(Math.max(0, Math.min(1, updates.importance))); }
    if (updates.confidence !== undefined) { fields.push('confidence = ?'); values.push(Math.max(0, Math.min(1, updates.confidence))); }
    
    if (fields.length === 0) return { error: 'No valid updates provided', id };
    
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
// Search Functions (v1.8 - keyword, semantic, hybrid)
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
    } catch (err) {
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
        } else {
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
        case 'keyword': results = keywordSearch(query, limit, confidenceThreshold); break;
        case 'semantic': results = await semanticSearch(query, limit, confidenceThreshold); break;
        case 'hybrid': default: results = await hybridSearch(query, limit, confidenceThreshold, alpha); break;
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
        rows = db.prepare(`SELECT * FROM memories WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`).all(...ids);
    } else {
        rows = db.prepare('SELECT * FROM memories WHERE embedding IS NULL AND deleted_at IS NULL').all();
    }
    let embedded = 0, failed = 0;
    for (const row of rows) {
        const embedding = await generateEmbedding(row.content);
        if (embedding) {
            db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(Buffer.from(embedding.buffer), row.id);
            embedded++;
        } else {
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
    if (permanent) db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    else db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
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
    // v1.7: Entity counts
    const entities = db.prepare('SELECT COUNT(*) as count FROM entities').get().count;
    const entityRelations = db.prepare('SELECT COUNT(*) as count FROM entity_relations').get().count;
    
    return {
        total, withEmbedding, embeddingCoverage: total > 0 ? Math.round(withEmbedding / total * 100) : 0,
        byConfidenceLevel: byConfidence, activeEdges: edges, scratchpadItems: scratch,
        entities, entityRelations,  // v1.7
        embeddingModel: 'all-MiniLM-L6-v2', embeddingDim: EMBEDDING_DIM,
        dbPath: DB_PATH, backupDir: BACKUP_DIR, version: '1.9.0'
    };
}


// ============================================================================
// Confidence Management
// ============================================================================
function confirmMemory(id, sourceId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory) return { error: 'Memory not found', id };
    
    const newSourceCount = memory.source_count + 1;
    const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.CONFIRMATION);
    
    db.prepare('UPDATE memories SET source_count = ?, confidence = ? WHERE id = ?').run(newSourceCount, newConfidence, id);
    
    if (sourceId) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'confirms', 1.0)`).run(edgeId, sourceId, id);
    }
    
    return { id, sourceCount: newSourceCount, confidence: newConfidence, confirmed: true };
}

function contradictMemory(id, contradictingId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory) return { error: 'Memory not found', id };
    
    const newContradictionCount = memory.contradiction_count + 1;
    const newConfidence = Math.max(0, memory.confidence - CONFIDENCE_PENALTY.CONTRADICTION);
    
    db.prepare('UPDATE memories SET contradiction_count = ?, confidence = ? WHERE id = ?').run(newContradictionCount, newConfidence, id);
    
    if (contradictingId) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'contradicts', 1.0)`).run(edgeId, contradictingId, id);
    }
    
    return { id, contradictionCount: newContradictionCount, confidence: newConfidence, contradicted: true };
}

function getConfidentMemories(threshold = 0.5, limit = 20) {
    const rows = db.prepare('SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY confidence DESC LIMIT ?').all(limit * 2);
    return rows.filter(m => calculateEffectiveConfidence(m) >= threshold).slice(0, limit).map(m => toConfidentMemory(m));
}

// ============================================================================
// Edge Operations (Bi-temporal)
// ============================================================================
function createEdge(fromId, toId, relationType, validFrom, validTo, confidence = 1.0, metadata = {}) {
    const fromMem = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(fromId);
    const toMem = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(toId);
    if (!fromMem) return { error: 'Source memory not found', fromId };
    if (!toMem) return { error: 'Target memory not found', toId };
    
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, fromId, toId, relationType, validFrom || new Date().toISOString(), validTo || null, confidence, JSON.stringify(metadata));
    
    return { id, fromId, toId, relationType, validFrom, validTo, confidence, created: true };
}

function queryEdges(memoryId, direction = 'both', relationTypes, asOfDate, includeExpired = false, limit = 50) {
    let sql = 'SELECT * FROM edges WHERE 1=1';
    const params = [];
    
    if (memoryId) {
        if (direction === 'outgoing') { sql += ' AND from_id = ?'; params.push(memoryId); }
        else if (direction === 'incoming') { sql += ' AND to_id = ?'; params.push(memoryId); }
        else { sql += ' AND (from_id = ? OR to_id = ?)'; params.push(memoryId, memoryId); }
    }
    
    if (relationTypes && relationTypes.length > 0) {
        sql += ` AND relation_type IN (${relationTypes.map(() => '?').join(',')})`;
        params.push(...relationTypes);
    }
    
    if (asOfDate) {
        sql += ' AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)';
        params.push(asOfDate, asOfDate);
    } else if (!includeExpired) {
        sql += ' AND valid_to IS NULL';
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    return db.prepare(sql).all(...params).map(e => ({ ...e, metadata: JSON.parse(e.metadata) }));
}

function invalidateEdge(edgeId, validTo) {
    const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
    if (!edge) return { error: 'Edge not found', edgeId };
    
    const endDate = validTo || new Date().toISOString();
    db.prepare('UPDATE edges SET valid_to = ? WHERE id = ?').run(endDate, edgeId);
    
    return { id: edgeId, validTo: endDate, invalidated: true };
}

// ============================================================================
// Graph Traversal (Spreading Activation)
// ============================================================================
function spreadingActivation(seedIds, maxHops = 3, decayFactor = 0.7, inhibitionThreshold = 0.1, minActivation = 0.05, asOfDate) {
    const activation = new Map();
    const visited = new Set();
    
    for (const id of seedIds) {
        activation.set(id, 1.0);
    }
    
    for (let hop = 0; hop < maxHops; hop++) {
        const currentIds = Array.from(activation.keys()).filter(id => !visited.has(id));
        if (currentIds.length === 0) break;
        
        for (const id of currentIds) {
            visited.add(id);
            const currentActivation = activation.get(id) || 0;
            if (currentActivation < minActivation) continue;
            
            const edges = queryEdges(id, 'both', undefined, asOfDate, false, 100);
            const fanOut = edges.length;
            const fanPenalty = fanOut > 10 ? Math.log(10) / Math.log(fanOut) : 1.0;
            
            for (const edge of edges) {
                const neighborId = edge.from_id === id ? edge.to_id : edge.from_id;
                const spreadAmount = currentActivation * decayFactor * edge.confidence * fanPenalty;
                
                if (spreadAmount >= minActivation) {
                    const existing = activation.get(neighborId) || 0;
                    activation.set(neighborId, Math.min(1.0, existing + spreadAmount));
                }
            }
        }
    }
    
    // Apply inhibition
    const results = [];
    for (const [id, act] of activation) {
        if (act >= inhibitionThreshold) {
            const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
            if (memory) {
                results.push({ ...toConfidentMemory(memory), activation: Math.round(act * 1000) / 1000, isSeed: seedIds.includes(id) });
            }
        }
    }
    
    return results.sort((a, b) => b.activation - a.activation);
}


// ============================================================================
// Scratchpad (Working Memory)
// ============================================================================
function scratchSet(key, value, ttlSeconds) {
    if (!key || typeof key !== 'string') throw new Error('Key is required');
    if (value === undefined || value === null) throw new Error('Value is required');
    
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, value, expires_at) VALUES (?, ?, ?)`).run(key, String(value), expiresAt);
    
    return { key, value, expiresAt, set: true };
}

function scratchGet(key) {
    db.prepare("DELETE FROM scratchpad WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run();
    const row = db.prepare('SELECT * FROM scratchpad WHERE key = ?').get(key);
    if (!row) return { error: 'Key not found', key };
    return { key: row.key, value: row.value, expiresAt: row.expires_at, createdAt: row.created_at };
}

function scratchDelete(key) {
    const result = db.prepare('DELETE FROM scratchpad WHERE key = ?').run(key);
    return { key, deleted: result.changes > 0 };
}

function scratchClear() {
    const result = db.prepare('DELETE FROM scratchpad').run();
    return { cleared: result.changes };
}

function scratchList() {
    db.prepare("DELETE FROM scratchpad WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run();
    return db.prepare('SELECT key, expires_at, created_at FROM scratchpad').all();
}

// ============================================================================
// Session Briefing
// ============================================================================
function generateBriefing(maxTokens = 500) {
    const recent = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT 10`).all();
    const important = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND importance >= 0.7 ORDER BY confidence DESC LIMIT 5`).all();
    const scratch = scratchList();
    const recentEntities = db.prepare(`SELECT * FROM entities ORDER BY updated_at DESC LIMIT 5`).all();
    
    const sections = [];
    
    if (recent.length > 0) {
        const items = recent.slice(0, 5).map(m => `- ${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}`);
        sections.push(`**Recent Context:**\n${items.join('\n')}`);
    }
    
    if (important.length > 0) {
        const items = important.slice(0, 3).map(m => `- [${(m.confidence * 100).toFixed(0)}%] ${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}`);
        sections.push(`**Key Facts:**\n${items.join('\n')}`);
    }
    
    if (recentEntities.length > 0) {
        const items = recentEntities.slice(0, 3).map(e => `- ${e.name} (${e.entity_type})`);
        sections.push(`**Known Entities:**\n${items.join('\n')}`);
    }
    
    if (scratch.length > 0) {
        const items = scratch.slice(0, 3).map(s => `- ${s.key}`);
        sections.push(`**Working Memory:**\n${items.join('\n')}`);
    }
    
    const briefing = sections.join('\n\n') || 'No memories to brief.';
    
    return {
        briefing,
        estimatedTokens: Math.ceil(briefing.length / 4),
        memoriesCount: recent.length,
        entitiesCount: recentEntities.length,
        scratchpadCount: scratch.length
    };
}

// ============================================================================
// Entity Operations (v1.7 Knowledge Graph)
// ============================================================================
function createEntity(name, entityType = 'concept', observations = []) {
    validateEntityName(name);
    const validObs = validateObservations(observations);
    
    const existing = db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
    if (existing) {
        const existingObs = JSON.parse(existing.observations);
        const mergedObs = [...new Set([...existingObs, ...validObs])].slice(0, MAX_OBSERVATIONS);
        db.prepare(`UPDATE entities SET entity_type = ?, observations = ?, updated_at = datetime('now') WHERE name = ?`)
            .run(entityType, JSON.stringify(mergedObs), name);
        return { id: existing.id, name, entityType, observations: mergedObs, updated: true, created: false };
    }
    
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    db.prepare(`INSERT INTO entities (id, name, entity_type, observations) VALUES (?, ?, ?, ?)`)
        .run(id, name, entityType, JSON.stringify(validObs));
    return { id, name, entityType, observations: validObs, updated: false, created: true };
}

function getEntity(name) {
    const entity = db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
    if (!entity) return { error: 'Entity not found', name };
    
    const outgoing = db.prepare('SELECT * FROM entity_relations WHERE from_entity = ?').all(name);
    const incoming = db.prepare('SELECT * FROM entity_relations WHERE to_entity = ?').all(name);
    
    return {
        id: entity.id, name: entity.name, entityType: entity.entity_type,
        observations: JSON.parse(entity.observations),
        relations: {
            outgoing: outgoing.map(r => ({ to: r.to_entity, type: r.relation_type })),
            incoming: incoming.map(r => ({ from: r.from_entity, type: r.relation_type }))
        },
        createdAt: entity.created_at, updatedAt: entity.updated_at
    };
}

function createEntityRelation(from, to, relationType) {
    validateEntityName(from);
    validateEntityName(to);
    if (!relationType || typeof relationType !== 'string') throw new Error('Relation type is required');
    
    const fromEntity = db.prepare('SELECT name FROM entities WHERE name = ?').get(from);
    const toEntity = db.prepare('SELECT name FROM entities WHERE name = ?').get(to);
    if (!fromEntity) return { error: `Source entity not found: ${from}` };
    if (!toEntity) return { error: `Target entity not found: ${to}` };
    
    const existing = db.prepare('SELECT id FROM entity_relations WHERE from_entity = ? AND to_entity = ? AND relation_type = ?').get(from, to, relationType);
    if (existing) return { error: 'Relation already exists', from, to, relationType, id: existing.id };
    
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    db.prepare(`INSERT INTO entity_relations (id, from_entity, to_entity, relation_type) VALUES (?, ?, ?, ?)`).run(id, from, to, relationType);
    return { id, from, to, relationType, created: true };
}

function searchEntities(query, entityType, limit = 20) {
    const sanitizedQuery = sanitizeLikePattern(query);
    let sql = `SELECT * FROM entities WHERE (name LIKE ? ESCAPE '\\' OR observations LIKE ? ESCAPE '\\')`;
    const params = [`%${sanitizedQuery}%`, `%${sanitizedQuery}%`];
    
    if (entityType) { sql += ' AND entity_type = ?'; params.push(entityType); }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);
    
    return db.prepare(sql).all(...params).map(e => ({
        id: e.id, name: e.name, entityType: e.entity_type,
        observations: JSON.parse(e.observations),
        createdAt: e.created_at, updatedAt: e.updated_at
    }));
}

function addObservations(name, observations) {
    const entity = db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
    if (!entity) return { error: 'Entity not found', name };
    
    const existingObs = JSON.parse(entity.observations);
    const validObs = validateObservations(observations);
    const mergedObs = [...new Set([...existingObs, ...validObs])].slice(0, MAX_OBSERVATIONS);
    
    db.prepare(`UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE name = ?`).run(JSON.stringify(mergedObs), name);
    return { name, observations: mergedObs, added: validObs.length, total: mergedObs.length };
}

function deleteEntity(name) {
    const entity = db.prepare('SELECT name FROM entities WHERE name = ?').get(name);
    if (!entity) return { error: 'Entity not found', name };
    
    const deletedRelations = db.prepare('DELETE FROM entity_relations WHERE from_entity = ? OR to_entity = ?').run(name, name);
    db.prepare('DELETE FROM entities WHERE name = ?').run(name);
    return { name, deleted: true, relationsDeleted: deletedRelations.changes };
}


// ============================================================================
// Backup/Restore (v1.8)
// ============================================================================
function createBackup(name) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = name || `backup-${timestamp}`;
    const backupPath = (0, path_1.join)(BACKUP_DIR, `${backupName}.json`);
    
    const memories = db.prepare('SELECT * FROM memories WHERE deleted_at IS NULL').all();
    const edges = db.prepare('SELECT * FROM edges').all();
    const scratchpad = db.prepare('SELECT * FROM scratchpad').all();
    const entities = db.prepare('SELECT * FROM entities').all();
    const entityRelations = db.prepare('SELECT * FROM entity_relations').all();
    
    const backup = {
        version: '1.9.0',
        createdAt: new Date().toISOString(),
        memories: memories.map(m => ({ ...m, embedding: null })),  // Don't backup embeddings
        edges, scratchpad, entities, entityRelations
    };
    
    (0, fs_1.writeFileSync)(backupPath, JSON.stringify(backup, null, 2));
    
    return {
        name: backupName, path: backupPath,
        counts: { memories: memories.length, edges: edges.length, scratchpad: scratchpad.length, entities: entities.length, entityRelations: entityRelations.length },
        createdAt: backup.createdAt
    };
}

async function restoreBackup(name, mode = 'merge') {
    const backupPath = (0, path_1.join)(BACKUP_DIR, `${name}.json`);
    if (!(0, fs_1.existsSync)(backupPath)) return { error: 'Backup not found', name };
    
    const backup = JSON.parse((0, fs_1.readFileSync)(backupPath, 'utf8'));
    
    if (mode === 'replace') {
        db.prepare('DELETE FROM memories').run();
        db.prepare('DELETE FROM edges').run();
        db.prepare('DELETE FROM scratchpad').run();
        db.prepare('DELETE FROM entities').run();
        db.prepare('DELETE FROM entity_relations').run();
    }
    
    const stats = { memories: 0, edges: 0, scratchpad: 0, entities: 0, entityRelations: 0, embeddings: 0 };
    
    // Restore memories (regenerate embeddings)
    for (const m of backup.memories || []) {
        if (mode === 'merge') {
            const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(m.id);
            if (existing) continue;
        }
        const embedding = await generateEmbedding(m.content);
        const embeddingBuffer = embedding ? Buffer.from(embedding.buffer) : null;
        
        db.prepare(`INSERT OR REPLACE INTO memories (id, content, type, tags, importance, strength, access_count, created_at, last_accessed, deleted_at, confidence, source_count, contradiction_count, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(m.id, m.content, m.type, m.tags, m.importance, m.strength, m.access_count, m.created_at, m.last_accessed, m.deleted_at, m.confidence, m.source_count, m.contradiction_count, embeddingBuffer);
        stats.memories++;
        if (embeddingBuffer) stats.embeddings++;
    }
    
    // Restore edges
    for (const e of backup.edges || []) {
        if (mode === 'merge') {
            const existing = db.prepare('SELECT id FROM edges WHERE id = ?').get(e.id);
            if (existing) continue;
        }
        db.prepare(`INSERT OR REPLACE INTO edges (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(e.id, e.from_id, e.to_id, e.relation_type, e.valid_from, e.valid_to, e.confidence, e.metadata, e.created_at);
        stats.edges++;
    }
    
    // Restore scratchpad
    for (const s of backup.scratchpad || []) {
        if (mode === 'merge') {
            const existing = db.prepare('SELECT key FROM scratchpad WHERE key = ?').get(s.key);
            if (existing) continue;
        }
        db.prepare(`INSERT OR REPLACE INTO scratchpad (key, value, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(s.key, s.value, s.expires_at, s.created_at);
        stats.scratchpad++;
    }
    
    // Restore entities
    for (const e of backup.entities || []) {
        if (mode === 'merge') {
            const existing = db.prepare('SELECT id FROM entities WHERE id = ?').get(e.id);
            if (existing) continue;
        }
        db.prepare(`INSERT OR REPLACE INTO entities (id, name, entity_type, observations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(e.id, e.name, e.entity_type, e.observations, e.created_at, e.updated_at);
        stats.entities++;
    }
    
    // Restore entity relations
    for (const r of backup.entityRelations || []) {
        if (mode === 'merge') {
            const existing = db.prepare('SELECT id FROM entity_relations WHERE id = ?').get(r.id);
            if (existing) continue;
        }
        db.prepare(`INSERT OR REPLACE INTO entity_relations (id, from_entity, to_entity, relation_type, created_at) VALUES (?, ?, ?, ?, ?)`)
            .run(r.id, r.from_entity, r.to_entity, r.relation_type, r.created_at);
        stats.entityRelations++;
    }
    
    return { name, mode, restored: stats, backupVersion: backup.version, backupCreatedAt: backup.createdAt };
}

function listBackups() {
    if (!(0, fs_1.existsSync)(BACKUP_DIR)) return [];
    return (0, fs_1.readdirSync)(BACKUP_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const fullPath = (0, path_1.join)(BACKUP_DIR, f);
            const stat = (0, fs_1.statSync)(fullPath);
            return { name: f.replace('.json', ''), path: fullPath, size: stat.size, createdAt: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}


// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new index_js_1.Server({ name: 'just-memory', version: '1.9.0' }, { capabilities: { tools: {} } });

const TOOLS = [
    // Core memory (7 tools)
    { name: 'memory_store', description: 'Store memory with auto-contradiction detection and semantic embedding. Max 100KB.', inputSchema: {
            type: 'object', properties: {
                content: { type: 'string', description: 'Memory content (max 100KB)' },
                type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
                tags: { type: 'array', items: { type: 'string' }, description: 'Up to 20 tags' },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
            }, required: ['content']
        } },
    { name: 'memory_recall', description: 'Recall by ID (strengthens memory)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' } }, required: ['id']
        } },
    { name: 'memory_update', description: 'Update memory content, type, tags, importance, or confidence', inputSchema: {
            type: 'object', properties: {
                id: { type: 'string' }, content: { type: 'string' },
                type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
            }, required: ['id']
        } },
    { name: 'memory_search', description: 'Search with keyword, semantic, or hybrid mode', inputSchema: {
            type: 'object', properties: {
                query: { type: 'string' }, limit: { type: 'number', default: 10 },
                confidenceThreshold: { type: 'number', default: 0 },
                mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], default: 'hybrid' },
                alpha: { type: 'number', default: 0.5, description: 'Weight for keyword vs semantic (0=semantic, 1=keyword)' }
            }, required: ['query']
        } },
    { name: 'memory_list', description: 'List recent memories', inputSchema: {
            type: 'object', properties: { limit: { type: 'number', default: 20 }, includeWeak: { type: 'boolean' }, includeUncertain: { type: 'boolean' } }
        } },
    { name: 'memory_delete', description: 'Delete memory', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, permanent: { type: 'boolean' } }, required: ['id']
        } },
    { name: 'memory_stats', description: 'Get statistics including entity and embedding counts', inputSchema: { type: 'object', properties: {} } },
    
    // Confidence (3 tools)
    { name: 'memory_confirm', description: 'Add confirming source (increases confidence)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, sourceId: { type: 'string' } }, required: ['id']
        } },
    { name: 'memory_contradict', description: 'Record contradiction (decreases confidence)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, contradictingId: { type: 'string' } }, required: ['id']
        } },
    { name: 'memory_confident', description: 'Get high-confidence memories', inputSchema: {
            type: 'object', properties: { confidenceThreshold: { type: 'number', default: 0.5 }, limit: { type: 'number', default: 20 } }
        } },
    
    // Edges (3 tools)
    { name: 'memory_edge_create', description: 'Create temporal relationship between memories', inputSchema: {
            type: 'object', properties: {
                fromId: { type: 'string' }, toId: { type: 'string' }, relationType: { type: 'string' },
                validFrom: { type: 'string' }, validTo: { type: 'string' },
                confidence: { type: 'number' }, metadata: { type: 'object' }
            }, required: ['fromId', 'toId', 'relationType']
        } },
    { name: 'memory_edge_query', description: 'Query memory relationships', inputSchema: {
            type: 'object', properties: {
                memoryId: { type: 'string' }, direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'] },
                relationTypes: { type: 'array', items: { type: 'string' } },
                asOfDate: { type: 'string' }, includeExpired: { type: 'boolean' }, limit: { type: 'number' }
            }
        } },
    { name: 'memory_edge_invalidate', description: 'Invalidate edge (set end date)', inputSchema: {
            type: 'object', properties: { edgeId: { type: 'string' }, validTo: { type: 'string' } }, required: ['edgeId']
        } },
    
    // Graph (1 tool)
    { name: 'memory_graph_traverse', description: 'Spreading activation traversal', inputSchema: {
            type: 'object', properties: {
                seedIds: { type: 'array', items: { type: 'string' } },
                maxHops: { type: 'number' }, decayFactor: { type: 'number' },
                inhibitionThreshold: { type: 'number' }, minActivation: { type: 'number' },
                asOfDate: { type: 'string' }, limit: { type: 'number' }
            }, required: ['seedIds']
        } },
    
    // Scratchpad (5 tools)
    { name: 'memory_scratch_set', description: 'Set scratchpad value with optional TTL', inputSchema: {
            type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, ttlSeconds: { type: 'number' } }, required: ['key', 'value']
        } },
    { name: 'memory_scratch_get', description: 'Get scratchpad value', inputSchema: {
            type: 'object', properties: { key: { type: 'string' } }, required: ['key']
        } },
    { name: 'memory_scratch_delete', description: 'Delete scratchpad key', inputSchema: {
            type: 'object', properties: { key: { type: 'string' } }, required: ['key']
        } },
    { name: 'memory_scratch_clear', description: 'Clear all scratchpad', inputSchema: { type: 'object', properties: {} } },
    { name: 'memory_scratch_list', description: 'List scratchpad keys', inputSchema: { type: 'object', properties: {} } },
    
    // Briefing (1 tool)
    { name: 'memory_briefing', description: 'Generate session briefing with memories and entities', inputSchema: {
            type: 'object', properties: { maxTokens: { type: 'number', default: 500 } }
        } },
    
    // Entities (6 tools - from v1.7)
    { name: 'memory_entity_create', description: 'Create or update a knowledge graph entity', inputSchema: {
            type: 'object', properties: {
                name: { type: 'string', description: 'Unique entity name' },
                entityType: { type: 'string', description: 'Entity type (person, project, concept)' },
                observations: { type: 'array', items: { type: 'string' } }
            }, required: ['name']
        } },
    { name: 'memory_entity_get', description: 'Get entity by name with all relations', inputSchema: {
            type: 'object', properties: { name: { type: 'string' } }, required: ['name']
        } },
    { name: 'memory_entity_link', description: 'Create a relation between two entities', inputSchema: {
            type: 'object', properties: {
                from: { type: 'string' }, to: { type: 'string' }, relationType: { type: 'string' }
            }, required: ['from', 'to', 'relationType']
        } },
    { name: 'memory_entity_search', description: 'Search entities by name or observation', inputSchema: {
            type: 'object', properties: {
                query: { type: 'string' }, entityType: { type: 'string' }, limit: { type: 'number', default: 20 }
            }, required: ['query']
        } },
    { name: 'memory_entity_observe', description: 'Add observations to an existing entity', inputSchema: {
            type: 'object', properties: {
                name: { type: 'string' }, observations: { type: 'array', items: { type: 'string' } }
            }, required: ['name', 'observations']
        } },
    { name: 'memory_entity_delete', description: 'Delete an entity and all its relations', inputSchema: {
            type: 'object', properties: { name: { type: 'string' } }, required: ['name']
        } },
    
    // Embeddings (1 tool - from v1.8)
    { name: 'memory_embed', description: 'Generate embeddings for memories without them', inputSchema: {
            type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Memory IDs to embed (empty = all missing)' } }
        } },
    
    // Backup/Restore (2 tools - from v1.8)
    { name: 'memory_backup', description: 'Create a backup of all memories and entities', inputSchema: {
            type: 'object', properties: { name: { type: 'string', description: 'Backup name (auto-generated if empty)' } }
        } },
    { name: 'memory_restore', description: 'Restore from backup with merge or replace mode', inputSchema: {
            type: 'object', properties: {
                name: { type: 'string', description: 'Backup name' },
                mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge' }
            }, required: ['name']
        } }
];


server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({ tools: TOOLS }));

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
            case 'memory_edge_create':
                result = createEdge(a.fromId, a.toId, a.relationType, a.validFrom, a.validTo, a.confidence, a.metadata);
                break;
            case 'memory_edge_query':
                result = queryEdges(a.memoryId, a.direction, a.relationTypes, a.asOfDate, a.includeExpired, a.limit);
                break;
            case 'memory_edge_invalidate':
                result = invalidateEdge(a.edgeId, a.validTo);
                break;
            
            // Graph
            case 'memory_graph_traverse':
                result = spreadingActivation(a.seedIds, a.maxHops, a.decayFactor, a.inhibitionThreshold, a.minActivation, a.asOfDate).slice(0, a.limit || 20);
                break;
            
            // Scratchpad
            case 'memory_scratch_set':
                result = scratchSet(a.key, a.value, a.ttlSeconds);
                break;
            case 'memory_scratch_get':
                result = scratchGet(a.key);
                break;
            case 'memory_scratch_delete':
                result = scratchDelete(a.key);
                break;
            case 'memory_scratch_clear':
                result = scratchClear();
                break;
            case 'memory_scratch_list':
                result = scratchList();
                break;
            
            // Briefing
            case 'memory_briefing':
                result = generateBriefing(a.maxTokens);
                break;
            
            // Entities (v1.7)
            case 'memory_entity_create':
                result = createEntity(a.name, a.entityType, a.observations);
                break;
            case 'memory_entity_get':
                result = getEntity(a.name);
                break;
            case 'memory_entity_link':
                result = createEntityRelation(a.from, a.to, a.relationType);
                break;
            case 'memory_entity_search':
                result = searchEntities(a.query, a.entityType, a.limit);
                break;
            case 'memory_entity_observe':
                result = addObservations(a.name, a.observations);
                break;
            case 'memory_entity_delete':
                result = deleteEntity(a.name);
                break;
            
            // Embeddings (v1.8)
            case 'memory_embed':
                result = await embedMemories(a.ids);
                break;
            
            // Backup/Restore (v1.8)
            case 'memory_backup':
                result = createBackup(a.name);
                break;
            case 'memory_restore':
                result = await restoreBackup(a.name, a.mode);
                break;
            
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
        
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
});

// ============================================================================
// Startup
// ============================================================================
async function main() {
    // Pre-warm embedding model
    await initEmbedder();
    
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('Just-Memory v1.9 running (Best of Both Worlds: Entities + Semantic Search)');
}

main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
