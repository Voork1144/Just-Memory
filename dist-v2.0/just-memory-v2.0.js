"use strict";
/**
 * Just-Memory v2.0 - Project Isolation
 *
 * Based on v1.9 (30 tools) with P1 project isolation feature:
 * - Project isolation: Memories scoped to projects via project_id
 * - Auto-detection: Detects project from git root, package.json, or env var
 * - Global namespace: 'global' project_id for cross-project memories
 *
 * Tool count: 31 (30 from v1.9 + memory_project_list)
 */
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
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const sqliteVec = __importStar(require("sqlite-vec"));
// ============================================================================
// Embedding Model Setup
// ============================================================================
const MODEL_CACHE = (0, path_1.join)((0, os_1.homedir)(), '.just-memory', 'models');
let embedder = null;
let embedderReady = false;
async function initEmbedder() {
    if (embedder)
        return;
    console.error('[Just-Memory v2.0] Pre-warming embedding model...');
    try {
        const { pipeline, env } = await Promise.resolve().then(() => __importStar(require('@xenova/transformers')));
        env.cacheDir = MODEL_CACHE;
        env.localModelPath = MODEL_CACHE;
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true,
        });
        embedderReady = true;
        console.error('[Just-Memory v2.0] Embedding model ready');
    }
    catch (err) {
        console.error('[Just-Memory v2.0] Failed to load embedding model:', err);
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
        console.error('[Just-Memory v2.0] Embedding generation failed:', err);
        return null;
    }
}
// Pre-warm on startup
initEmbedder();
// ============================================================================
// Constants
// ============================================================================
const MAX_CONTENT_LENGTH = 100000;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;
const MAX_ENTITY_NAME_LENGTH = 200;
const MAX_OBSERVATIONS = 100;
const BACKUP_DIR = (0, path_1.join)((0, os_1.homedir)(), '.just-memory', 'backups');
const EMBEDDING_DIM = 384;
// Global project ID for cross-project memories
const GLOBAL_PROJECT = 'global';
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
// Project Detection
// ============================================================================
let currentProjectId = GLOBAL_PROJECT;
let currentProjectPath = null;
/**
 * Detect project from environment or file system
 * Priority: 1. CLAUDE_PROJECT env var  2. Git root  3. package.json dir  4. 'global'
 */
function detectProject(startPath) {
    // Check env var first
    const envProject = process.env.CLAUDE_PROJECT || process.env.JUST_MEMORY_PROJECT;
    if (envProject) {
        return { id: envProject, path: null, source: 'env' };
    }
    // Determine starting directory
    let searchPath = startPath || process.cwd();
    // Walk up to find project markers
    let current = (0, path_1.resolve)(searchPath);
    const root = (0, os_1.platform)() === 'win32' ? current.split(path_1.sep)[0] + path_1.sep : '/';
    while (current !== root) {
        // Check for .git directory (git repo root)
        const gitPath = (0, path_1.join)(current, '.git');
        if ((0, fs_1.existsSync)(gitPath)) {
            const projectName = (0, path_1.basename)(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            return { id: projectName, path: current, source: 'git' };
        }
        // Check for package.json (node project root)
        const packagePath = (0, path_1.join)(current, 'package.json');
        if ((0, fs_1.existsSync)(packagePath)) {
            try {
                const pkg = JSON.parse((0, fs_1.readFileSync)(packagePath, 'utf-8'));
                const projectName = (pkg.name || (0, path_1.basename)(current)).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
                return { id: projectName, path: current, source: 'package.json' };
            }
            catch {
                // Invalid package.json, continue searching
            }
        }
        // Check for pyproject.toml (Python project root)
        const pyprojectPath = (0, path_1.join)(current, 'pyproject.toml');
        if ((0, fs_1.existsSync)(pyprojectPath)) {
            const projectName = (0, path_1.basename)(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            return { id: projectName, path: current, source: 'pyproject.toml' };
        }
        // Check for Cargo.toml (Rust project root)
        const cargoPath = (0, path_1.join)(current, 'Cargo.toml');
        if ((0, fs_1.existsSync)(cargoPath)) {
            const projectName = (0, path_1.basename)(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            return { id: projectName, path: current, source: 'Cargo.toml' };
        }
        // Move up one directory
        const parent = (0, path_1.dirname)(current);
        if (parent === current)
            break;
        current = parent;
    }
    // No project found - use global
    return { id: GLOBAL_PROJECT, path: null, source: 'default' };
}
// Initialize project on startup
function initProject() {
    const detected = detectProject();
    currentProjectId = detected.id;
    currentProjectPath = detected.path;
    console.error(`[Just-Memory v2.0] Project: ${detected.id} (${detected.source})`);
}
initProject();
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
    console.error('[Just-Memory v2.0] sqlite-vec extension loaded');
}
catch (err) {
    console.error('[Just-Memory v2.0] Warning: sqlite-vec load failed:', err);
}
// Create tables with project_id column
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
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
  CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
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
  CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
  CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
  CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS scratchpad (
    key TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    value TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_scratchpad_project ON scratchpad(project_id);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    name TEXT NOT NULL,
    entity_type TEXT DEFAULT 'concept',
    observations TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id);
  CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS entity_relations (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, from_entity, to_entity, relation_type)
  );
  CREATE INDEX IF NOT EXISTS idx_entity_relations_project ON entity_relations(project_id);
  CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_entity);
  CREATE INDEX IF NOT EXISTS idx_entity_relations_to ON entity_relations(to_entity);
`);
// Migration: Add project_id to existing tables if not present
try {
    db.exec('ALTER TABLE memories ADD COLUMN project_id TEXT DEFAULT \'global\'');
}
catch { }
try {
    db.exec('ALTER TABLE edges ADD COLUMN project_id TEXT DEFAULT \'global\'');
}
catch { }
try {
    db.exec('ALTER TABLE scratchpad ADD COLUMN project_id TEXT DEFAULT \'global\'');
}
catch { }
try {
    db.exec('ALTER TABLE entities ADD COLUMN project_id TEXT DEFAULT \'global\'');
}
catch { }
try {
    db.exec('ALTER TABLE entity_relations ADD COLUMN project_id TEXT DEFAULT \'global\'');
}
catch { }
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id)');
}
catch { }
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id)');
}
catch { }
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_scratchpad_project ON scratchpad(project_id)');
}
catch { }
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id)');
}
catch { }
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_entity_relations_project ON entity_relations(project_id)');
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
function validateEntityName(name) {
    if (!name || typeof name !== 'string') {
        throw new Error('Entity name is required');
    }
    if (name.length > MAX_ENTITY_NAME_LENGTH) {
        throw new Error(`Entity name exceeds maximum length of ${MAX_ENTITY_NAME_LENGTH} characters`);
    }
}
function validateObservations(observations) {
    if (!Array.isArray(observations))
        return [];
    return observations
        .slice(0, MAX_OBSERVATIONS)
        .map(o => String(o).slice(0, MAX_CONTENT_LENGTH))
        .filter(o => o.length > 0);
}
/**
 * Get effective project ID - returns provided project or current auto-detected
 */
function getEffectiveProject(projectId) {
    if (projectId && projectId.trim())
        return projectId.trim().toLowerCase();
    return currentProjectId;
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
        id: m.id,
        project_id: m.project_id,
        content: m.content,
        confidence: calculateEffectiveConfidence(m),
        confidenceLevel: assessment.level,
        ...(assessment.note ? { confidenceNote: assessment.note } : {})
    };
}
// ============================================================================
// Contradiction Detection
// ============================================================================
function findContradictions(content, projectId, limit = 5, excludeId) {
    const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const negations = ['not', "don't", "doesn't", "isn't", "aren't", "won't", "can't", "never", 'no'];
    const hasNegation = negations.some(n => content.toLowerCase().includes(n));
    let sql = 'SELECT * FROM memories WHERE deleted_at IS NULL AND (project_id = ? OR project_id = \'global\')';
    const params = [projectId];
    if (excludeId) {
        sql += ' AND id != ?';
        params.push(excludeId);
    }
    const allMemories = db.prepare(sql).all(...params);
    const scored = allMemories.map((m) => {
        const mWords = m.content.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        const overlap = words.filter(w => mWords.includes(w)).length;
        const mHasNegation = negations.some(n => m.content.toLowerCase().includes(n));
        const potentialContradiction = overlap >= 2 && hasNegation !== mHasNegation;
        return { memory: m, overlap, potentialContradiction };
    });
    return scored.filter(s => s.potentialContradiction).sort((a, b) => b.overlap - a.overlap).slice(0, limit).map(s => s.memory);
}
// ============================================================================
// Core Memory Operations (with project isolation)
// ============================================================================
async function storeMemory(content, type = 'note', tags = [], importance = 0.5, confidence = 0.5, projectId) {
    validateContent(content);
    const validTags = validateTags(tags);
    const project = getEffectiveProject(projectId);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    const contradictions = findContradictions(content, project);
    let adjustedConfidence = confidence;
    if (contradictions.length > 0) {
        adjustedConfidence = Math.max(0.2, confidence - 0.1 * contradictions.length);
    }
    const embedding = await generateEmbedding(content);
    const embeddingBuffer = embedding ? Buffer.from(embedding.buffer) : null;
    db.prepare(`INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, project, content, type, JSON.stringify(validTags), importance, adjustedConfidence, embeddingBuffer);
    for (const c of contradictions) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, ?, 'potential_contradiction', 0.5)`)
            .run(edgeId, project, id, c.id);
    }
    return {
        id, project_id: project, content, type, tags: validTags, importance,
        confidence: adjustedConfidence, strength: 1.0,
        hasEmbedding: embedding !== null,
        potentialContradictions: contradictions.map((c) => ({ id: c.id, content: c.content.slice(0, 100) }))
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
        const contradictions = findContradictions(updates.content, memory.project_id, 5, id);
        for (const c of contradictions) {
            const existingEdge = db.prepare(`SELECT id FROM edges WHERE from_id = ? AND to_id = ? AND relation_type = 'potential_contradiction'`).get(id, c.id);
            if (!existingEdge) {
                const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
                db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, ?, 'potential_contradiction', 0.5)`)
                    .run(edgeId, memory.project_id, id, c.id);
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
        id: updated.id, project_id: updated.project_id, content: updated.content, type: updated.type,
        tags: JSON.parse(updated.tags), importance: updated.importance,
        confidence: updated.confidence, hasEmbedding: updated.embedding !== null, updated: true
    };
}
function deleteMemory(id, permanent = false) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    if (permanent) {
        db.prepare('DELETE FROM edges WHERE from_id = ? OR to_id = ?').run(id, id);
        db.prepare('DELETE FROM memories WHERE id = ?').run(id);
        return { deleted: true, permanent: true, id };
    }
    db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
    return { deleted: true, permanent: false, id, canRestore: true };
}
// ============================================================================
// Search Functions (with project isolation)
// ============================================================================
function keywordSearch(query, projectId, limit, confidenceThreshold) {
    const sanitizedQuery = sanitizeLikePattern(query);
    const rows = db.prepare(`
    SELECT * FROM memories 
    WHERE deleted_at IS NULL 
    AND (project_id = ? OR project_id = 'global') 
    AND content LIKE ? ESCAPE '\\' 
    ORDER BY confidence DESC, importance DESC 
    LIMIT ?
  `).all(projectId, `%${sanitizedQuery}%`, limit * 2);
    return rows
        .map(m => ({ ...m, keywordScore: 1.0 }))
        .filter(m => calculateRetention(m.last_accessed, m.strength) > 0.1 && calculateEffectiveConfidence(m) >= confidenceThreshold);
}
async function semanticSearch(query, projectId, limit, confidenceThreshold) {
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
        console.error('[Just-Memory v2.0] Semantic search unavailable - embedder not ready');
        return [];
    }
    const queryBuffer = Buffer.from(queryEmbedding.buffer);
    try {
        const rows = db.prepare(`
      SELECT m.*, (1 - (vec_distance_cosine(m.embedding, ?) / 2)) as similarity
      FROM memories m
      WHERE m.deleted_at IS NULL 
      AND (m.project_id = ? OR m.project_id = 'global')
      AND m.embedding IS NOT NULL
      ORDER BY similarity DESC
      LIMIT ?
    `).all(queryBuffer, projectId, limit * 2);
        return rows
            .filter(m => m.similarity > 0.3 &&
            calculateRetention(m.last_accessed, m.strength) > 0.1 &&
            calculateEffectiveConfidence(m) >= confidenceThreshold)
            .map(m => ({ ...m, similarity: m.similarity }));
    }
    catch (err) {
        console.error('[Just-Memory v2.0] Semantic search error:', err);
        return [];
    }
}
async function hybridSearch(query, projectId, limit = 10, confidenceThreshold = 0) {
    const [keywordResults, semanticResults] = await Promise.all([
        keywordSearch(query, projectId, limit, confidenceThreshold),
        semanticSearch(query, projectId, limit, confidenceThreshold)
    ]);
    const combined = new Map();
    for (const m of keywordResults) {
        combined.set(m.id, { ...m, keywordScore: 1.0, semanticScore: 0 });
    }
    for (const m of semanticResults) {
        if (combined.has(m.id)) {
            combined.get(m.id).semanticScore = m.similarity || 0;
        }
        else {
            combined.set(m.id, { ...m, keywordScore: 0, semanticScore: m.similarity || 0 });
        }
    }
    const results = Array.from(combined.values())
        .map(m => ({
        ...m,
        combinedScore: (m.keywordScore * 0.4) + (m.semanticScore * 0.6)
    }))
        .sort((a, b) => b.combinedScore - a.combinedScore)
        .slice(0, limit);
    return results.map(m => ({
        id: m.id,
        project_id: m.project_id,
        content: m.content,
        type: m.type,
        tags: JSON.parse(m.tags || '[]'),
        importance: m.importance,
        confidence: calculateEffectiveConfidence(m),
        confidenceLevel: assessConfidence(m).level,
        combinedScore: m.combinedScore,
        keywordScore: m.keywordScore,
        semanticScore: m.semanticScore
    }));
}
// ============================================================================
// Project Management
// ============================================================================
function listProjects() {
    const memoryProjects = db.prepare(`
    SELECT project_id, COUNT(*) as memory_count, MAX(created_at) as last_activity
    FROM memories WHERE deleted_at IS NULL
    GROUP BY project_id
    ORDER BY last_activity DESC
  `).all();
    const entityProjects = db.prepare(`
    SELECT project_id, COUNT(*) as entity_count
    FROM entities
    GROUP BY project_id
  `).all();
    const entityMap = new Map(entityProjects.map((e) => [e.project_id, e.entity_count]));
    return {
        current_project: currentProjectId,
        current_project_path: currentProjectPath,
        projects: memoryProjects.map((p) => ({
            project_id: p.project_id,
            memory_count: p.memory_count,
            entity_count: entityMap.get(p.project_id) || 0,
            last_activity: p.last_activity,
            is_current: p.project_id === currentProjectId
        }))
    };
}
function setCurrentProject(projectId, path) {
    currentProjectId = projectId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    currentProjectPath = path || null;
    return { project_id: currentProjectId, path: currentProjectPath };
}
// ============================================================================
// Entity Operations (Knowledge Graph) with project isolation
// ============================================================================
function createEntity(name, entityType = 'concept', observations = [], projectId) {
    validateEntityName(name);
    const validObs = validateObservations(observations);
    const project = getEffectiveProject(projectId);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    // Check if entity exists in this project
    const existing = db.prepare('SELECT * FROM entities WHERE project_id = ? AND name = ?').get(project, name);
    if (existing) {
        // Merge observations
        const existingObs = JSON.parse(existing.observations || '[]');
        const mergedObs = [...new Set([...existingObs, ...validObs])];
        db.prepare("UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE id = ?")
            .run(JSON.stringify(mergedObs), existing.id);
        return {
            id: existing.id, project_id: project, name, entityType: existing.entity_type,
            observations: mergedObs, merged: true
        };
    }
    db.prepare('INSERT INTO entities (id, project_id, name, entity_type, observations) VALUES (?, ?, ?, ?, ?)')
        .run(id, project, name, entityType, JSON.stringify(validObs));
    return { id, project_id: project, name, entityType, observations: validObs, created: true };
}
function getEntity(name, projectId) {
    const project = getEffectiveProject(projectId);
    // Try project-specific first, then global
    let entity = db.prepare('SELECT * FROM entities WHERE project_id = ? AND name = ?').get(project, name);
    if (!entity && project !== GLOBAL_PROJECT) {
        entity = db.prepare('SELECT * FROM entities WHERE project_id = ? AND name = ?').get(GLOBAL_PROJECT, name);
    }
    if (!entity)
        return { error: 'Entity not found', name, project_id: project };
    // Get relations
    const outgoing = db.prepare('SELECT * FROM entity_relations WHERE project_id = ? AND from_entity = ?').all(entity.project_id, name);
    const incoming = db.prepare('SELECT * FROM entity_relations WHERE project_id = ? AND to_entity = ?').all(entity.project_id, name);
    return {
        id: entity.id,
        project_id: entity.project_id,
        name: entity.name,
        entityType: entity.entity_type,
        observations: JSON.parse(entity.observations || '[]'),
        relations: {
            outgoing: outgoing.map((r) => ({ to: r.to_entity, type: r.relation_type })),
            incoming: incoming.map((r) => ({ from: r.from_entity, type: r.relation_type }))
        },
        created_at: entity.created_at,
        updated_at: entity.updated_at
    };
}
function linkEntities(from, relationType, to, projectId) {
    const project = getEffectiveProject(projectId);
    // Verify both entities exist
    const fromEntity = db.prepare('SELECT * FROM entities WHERE (project_id = ? OR project_id = ?) AND name = ?')
        .get(project, GLOBAL_PROJECT, from);
    const toEntity = db.prepare('SELECT * FROM entities WHERE (project_id = ? OR project_id = ?) AND name = ?')
        .get(project, GLOBAL_PROJECT, to);
    if (!fromEntity)
        return { error: `Entity '${from}' not found`, project_id: project };
    if (!toEntity)
        return { error: `Entity '${to}' not found`, project_id: project };
    // Check for existing relation
    const existing = db.prepare(`
    SELECT * FROM entity_relations 
    WHERE project_id = ? AND from_entity = ? AND to_entity = ? AND relation_type = ?
  `).get(project, from, to, relationType);
    if (existing) {
        return { exists: true, from, to, relationType, project_id: project };
    }
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    db.prepare('INSERT INTO entity_relations (id, project_id, from_entity, to_entity, relation_type) VALUES (?, ?, ?, ?, ?)')
        .run(id, project, from, to, relationType);
    return { id, from, to, relationType, project_id: project, created: true };
}
function searchEntities(query, entityType, projectId, limit = 20) {
    const project = getEffectiveProject(projectId);
    const sanitized = sanitizeLikePattern(query);
    let sql = `
    SELECT * FROM entities 
    WHERE (project_id = ? OR project_id = 'global')
    AND (name LIKE ? ESCAPE '\\' OR observations LIKE ? ESCAPE '\\')
  `;
    const params = [project, `%${sanitized}%`, `%${sanitized}%`];
    if (entityType) {
        sql += ' AND entity_type = ?';
        params.push(entityType);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);
    const results = db.prepare(sql).all(...params);
    return results.map((e) => ({
        id: e.id,
        project_id: e.project_id,
        name: e.name,
        entityType: e.entity_type,
        observations: JSON.parse(e.observations || '[]'),
        updated_at: e.updated_at
    }));
}
function observeEntity(name, observations, projectId) {
    const project = getEffectiveProject(projectId);
    const validObs = validateObservations(observations);
    const entity = db.prepare('SELECT * FROM entities WHERE (project_id = ? OR project_id = ?) AND name = ?')
        .get(project, GLOBAL_PROJECT, name);
    if (!entity)
        return { error: 'Entity not found', name, project_id: project };
    const existingObs = JSON.parse(entity.observations || '[]');
    const mergedObs = [...new Set([...existingObs, ...validObs])];
    db.prepare("UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(mergedObs), entity.id);
    return {
        name, project_id: entity.project_id,
        observations: mergedObs,
        added: validObs.length,
        total: mergedObs.length
    };
}
function deleteEntity(name, projectId) {
    const project = getEffectiveProject(projectId);
    const entity = db.prepare('SELECT * FROM entities WHERE project_id = ? AND name = ?').get(project, name);
    if (!entity)
        return { error: 'Entity not found', name, project_id: project };
    db.prepare('DELETE FROM entity_relations WHERE project_id = ? AND (from_entity = ? OR to_entity = ?)').run(project, name, name);
    db.prepare('DELETE FROM entities WHERE id = ?').run(entity.id);
    return { deleted: true, name, project_id: project };
}
// ============================================================================
// Scratchpad Operations (with project isolation)
// ============================================================================
function scratchSet(key, value, ttlSeconds, projectId) {
    const project = getEffectiveProject(projectId);
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    db.prepare(`
    INSERT INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
  `).run(key, project, value, expiresAt);
    return { key, project_id: project, stored: true, expires_at: expiresAt };
}
function scratchGet(key, projectId) {
    const project = getEffectiveProject(projectId);
    // Try project-specific first, then global
    let row = db.prepare('SELECT * FROM scratchpad WHERE key = ? AND project_id = ?').get(key, project);
    if (!row && project !== GLOBAL_PROJECT) {
        row = db.prepare('SELECT * FROM scratchpad WHERE key = ? AND project_id = ?').get(key, GLOBAL_PROJECT);
    }
    if (!row)
        return { key, project_id: project, value: null, found: false };
    // Check expiration
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?').run(key, row.project_id);
        return { key, project_id: row.project_id, value: null, expired: true };
    }
    return { key, project_id: row.project_id, value: row.value, found: true, expires_at: row.expires_at };
}
function scratchDelete(key, projectId) {
    const project = getEffectiveProject(projectId);
    const result = db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?').run(key, project);
    return { key, project_id: project, deleted: result.changes > 0 };
}
function scratchList(projectId) {
    const project = getEffectiveProject(projectId);
    // Cleanup expired
    db.prepare("DELETE FROM scratchpad WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run();
    const rows = db.prepare('SELECT key, expires_at, created_at FROM scratchpad WHERE project_id = ? OR project_id = ?')
        .all(project, GLOBAL_PROJECT);
    return {
        project_id: project,
        keys: rows.map((r) => ({
            key: r.key,
            expires_at: r.expires_at,
            created_at: r.created_at
        })),
        count: rows.length
    };
}
function scratchClear(projectId) {
    const project = getEffectiveProject(projectId);
    const result = db.prepare('DELETE FROM scratchpad WHERE project_id = ?').run(project);
    return { project_id: project, cleared: result.changes };
}
// ============================================================================
// Edge Operations (Bi-temporal Relations) with project isolation
// ============================================================================
function createEdge(fromId, toId, relationType, confidence = 1.0, metadata = {}, projectId) {
    const project = getEffectiveProject(projectId);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    db.prepare(`
    INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, project, fromId, toId, relationType, confidence, JSON.stringify(metadata));
    return { id, project_id: project, from_id: fromId, to_id: toId, relation_type: relationType, confidence, created: true };
}
function queryEdges(memoryId, direction = 'both', projectId) {
    const project = getEffectiveProject(projectId);
    let edges = [];
    if (direction === 'outgoing' || direction === 'both') {
        const outgoing = db.prepare(`
      SELECT * FROM edges 
      WHERE (project_id = ? OR project_id = 'global') AND from_id = ? AND (valid_to IS NULL OR valid_to > datetime('now'))
    `).all(project, memoryId);
        edges = edges.concat(outgoing.map(e => ({ ...e, direction: 'outgoing' })));
    }
    if (direction === 'incoming' || direction === 'both') {
        const incoming = db.prepare(`
      SELECT * FROM edges 
      WHERE (project_id = ? OR project_id = 'global') AND to_id = ? AND (valid_to IS NULL OR valid_to > datetime('now'))
    `).all(project, memoryId);
        edges = edges.concat(incoming.map(e => ({ ...e, direction: 'incoming' })));
    }
    return edges.map(e => ({
        id: e.id,
        project_id: e.project_id,
        from_id: e.from_id,
        to_id: e.to_id,
        relation_type: e.relation_type,
        direction: e.direction,
        confidence: e.confidence,
        metadata: JSON.parse(e.metadata || '{}'),
        valid_from: e.valid_from,
        valid_to: e.valid_to
    }));
}
function invalidateEdge(edgeId) {
    db.prepare("UPDATE edges SET valid_to = datetime('now') WHERE id = ?").run(edgeId);
    return { id: edgeId, invalidated: true };
}
// ============================================================================
// Backup/Restore with project support
// ============================================================================
function backupMemories(projectId) {
    const project = projectId ? getEffectiveProject(projectId) : null;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = project ? `backup_${project}_${timestamp}.json` : `backup_all_${timestamp}.json`;
    const backupPath = (0, path_1.join)(BACKUP_DIR, filename);
    let memories, entities, edges;
    if (project) {
        memories = db.prepare('SELECT * FROM memories WHERE (project_id = ? OR project_id = ?) AND deleted_at IS NULL').all(project, GLOBAL_PROJECT);
        entities = db.prepare('SELECT * FROM entities WHERE project_id = ? OR project_id = ?').all(project, GLOBAL_PROJECT);
        edges = db.prepare('SELECT * FROM edges WHERE project_id = ? OR project_id = ?').all(project, GLOBAL_PROJECT);
    }
    else {
        memories = db.prepare('SELECT * FROM memories WHERE deleted_at IS NULL').all();
        entities = db.prepare('SELECT * FROM entities').all();
        edges = db.prepare('SELECT * FROM edges').all();
    }
    const backup = {
        version: '2.0',
        timestamp: new Date().toISOString(),
        project_id: project,
        memories: memories.map((m) => ({
            ...m,
            tags: JSON.parse(m.tags || '[]'),
            embedding: m.embedding ? Buffer.from(m.embedding).toString('base64') : null
        })),
        entities: entities.map((e) => ({
            ...e,
            observations: JSON.parse(e.observations || '[]')
        })),
        edges: edges.map((e) => ({
            ...e,
            metadata: JSON.parse(e.metadata || '{}')
        }))
    };
    (0, fs_1.writeFileSync)(backupPath, JSON.stringify(backup, null, 2));
    return {
        path: backupPath,
        project_id: project,
        memories_count: memories.length,
        entities_count: entities.length,
        edges_count: edges.length
    };
}
function restoreMemories(backupPath, mode = 'merge', targetProject) {
    if (!(0, fs_1.existsSync)(backupPath)) {
        return { error: 'Backup file not found', path: backupPath };
    }
    const backup = JSON.parse((0, fs_1.readFileSync)(backupPath, 'utf-8'));
    const project = targetProject || backup.project_id || GLOBAL_PROJECT;
    let memoriesRestored = 0, entitiesRestored = 0, edgesRestored = 0;
    if (mode === 'replace' && project !== GLOBAL_PROJECT) {
        db.prepare('DELETE FROM memories WHERE project_id = ?').run(project);
        db.prepare('DELETE FROM entities WHERE project_id = ?').run(project);
        db.prepare('DELETE FROM edges WHERE project_id = ?').run(project);
    }
    for (const m of backup.memories || []) {
        const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(m.id);
        const embedding = m.embedding ? Buffer.from(m.embedding, 'base64') : null;
        if (!existing) {
            db.prepare(`
        INSERT INTO memories (id, project_id, content, type, tags, importance, strength, access_count, confidence, source_count, contradiction_count, embedding, created_at, last_accessed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(m.id, project, m.content, m.type, JSON.stringify(m.tags), m.importance, m.strength, m.access_count, m.confidence, m.source_count, m.contradiction_count, embedding, m.created_at, m.last_accessed);
            memoriesRestored++;
        }
        else if (mode === 'replace') {
            db.prepare(`
        UPDATE memories SET project_id = ?, content = ?, type = ?, tags = ?, importance = ?, strength = ?, access_count = ?, confidence = ?, source_count = ?, contradiction_count = ?, embedding = ?, created_at = ?, last_accessed = ?, deleted_at = NULL
        WHERE id = ?
      `).run(project, m.content, m.type, JSON.stringify(m.tags), m.importance, m.strength, m.access_count, m.confidence, m.source_count, m.contradiction_count, embedding, m.created_at, m.last_accessed, m.id);
            memoriesRestored++;
        }
    }
    for (const e of backup.entities || []) {
        const existing = db.prepare('SELECT id FROM entities WHERE project_id = ? AND name = ?').get(project, e.name);
        if (!existing) {
            db.prepare('INSERT INTO entities (id, project_id, name, entity_type, observations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(e.id, project, e.name, e.entity_type, JSON.stringify(e.observations), e.created_at, e.updated_at);
            entitiesRestored++;
        }
    }
    for (const edge of backup.edges || []) {
        const existing = db.prepare('SELECT id FROM edges WHERE id = ?').get(edge.id);
        if (!existing) {
            db.prepare('INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata, valid_from, valid_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(edge.id, project, edge.from_id, edge.to_id, edge.relation_type, edge.confidence, JSON.stringify(edge.metadata), edge.valid_from, edge.valid_to, edge.created_at);
            edgesRestored++;
        }
    }
    return {
        restored: true,
        project_id: project,
        mode,
        memories_restored: memoriesRestored,
        entities_restored: entitiesRestored,
        edges_restored: edgesRestored
    };
}
function listBackups() {
    if (!(0, fs_1.existsSync)(BACKUP_DIR))
        return { backups: [] };
    const files = (0, fs_1.readdirSync)(BACKUP_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
        const fullPath = (0, path_1.join)(BACKUP_DIR, f);
        const stats = (0, fs_1.statSync)(fullPath);
        return {
            filename: f,
            path: fullPath,
            size_bytes: stats.size,
            created_at: stats.birthtime.toISOString()
        };
    })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return { backup_dir: BACKUP_DIR, backups: files };
}
// ============================================================================
// Stats with project support
// ============================================================================
function getStats(projectId) {
    const project = projectId ? getEffectiveProject(projectId) : null;
    let memoryStats, entityStats, scratchStats;
    if (project) {
        memoryStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted,
        SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as with_embeddings,
        AVG(confidence) as avg_confidence,
        AVG(importance) as avg_importance
      FROM memories WHERE project_id = ? OR project_id = 'global'
    `).get(project);
        entityStats = db.prepare('SELECT COUNT(*) as count FROM entities WHERE project_id = ? OR project_id = ?').get(project, GLOBAL_PROJECT);
        scratchStats = db.prepare('SELECT COUNT(*) as count FROM scratchpad WHERE project_id = ? OR project_id = ?').get(project, GLOBAL_PROJECT);
    }
    else {
        memoryStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted,
        SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as with_embeddings,
        AVG(confidence) as avg_confidence,
        AVG(importance) as avg_importance
      FROM memories
    `).get();
        entityStats = db.prepare('SELECT COUNT(*) as count FROM entities').get();
        scratchStats = db.prepare('SELECT COUNT(*) as count FROM scratchpad').get();
    }
    const typeBreakdown = db.prepare(`
    SELECT type, COUNT(*) as count FROM memories 
    WHERE deleted_at IS NULL ${project ? "AND (project_id = ? OR project_id = 'global')" : ''}
    GROUP BY type
  `).all(project ? [project] : []);
    return {
        current_project: currentProjectId,
        query_project: project,
        memories: {
            total: memoryStats.total || 0,
            active: memoryStats.active || 0,
            deleted: memoryStats.deleted || 0,
            with_embeddings: memoryStats.with_embeddings || 0,
            avg_confidence: memoryStats.avg_confidence ? Number(memoryStats.avg_confidence.toFixed(3)) : 0,
            avg_importance: memoryStats.avg_importance ? Number(memoryStats.avg_importance.toFixed(3)) : 0,
            by_type: Object.fromEntries(typeBreakdown.map((t) => [t.type, t.count]))
        },
        entities: { count: entityStats.count || 0 },
        scratchpad: { count: scratchStats.count || 0 },
        embedding_model: 'all-MiniLM-L6-v2',
        embedding_ready: embedderReady,
        db_path: DB_PATH,
        version: '2.0'
    };
}
// ============================================================================
// Confidence Tools
// ============================================================================
function confirmMemory(id, sourceId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.CONFIRMATION);
    const newSourceCount = memory.source_count + 1;
    db.prepare('UPDATE memories SET confidence = ?, source_count = ? WHERE id = ?')
        .run(newConfidence, newSourceCount, id);
    if (sourceId) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, ?, 'confirms', 1.0)`)
            .run(edgeId, memory.project_id, sourceId, id);
    }
    return {
        id, project_id: memory.project_id,
        confidence: newConfidence,
        source_count: newSourceCount,
        confirmed: true
    };
}
function contradictMemory(id, contradictingId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newConfidence = Math.max(0, memory.confidence - CONFIDENCE_PENALTY.CONTRADICTION);
    const newContradictionCount = memory.contradiction_count + 1;
    db.prepare('UPDATE memories SET confidence = ?, contradiction_count = ? WHERE id = ?')
        .run(newConfidence, newContradictionCount, id);
    if (contradictingId) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, ?, 'contradicts', 1.0)`)
            .run(edgeId, memory.project_id, contradictingId, id);
    }
    return {
        id, project_id: memory.project_id,
        confidence: newConfidence,
        contradiction_count: newContradictionCount,
        contradicted: true
    };
}
function getConfidentMemories(confidenceThreshold = 0.5, projectId, limit = 20) {
    const project = getEffectiveProject(projectId);
    const memories = db.prepare(`
    SELECT * FROM memories 
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
    ORDER BY confidence DESC, importance DESC
    LIMIT ?
  `).all(project, limit * 2);
    return memories
        .filter(m => calculateEffectiveConfidence(m) >= confidenceThreshold)
        .slice(0, limit)
        .map(m => toConfidentMemory(m));
}
// ============================================================================
// List/Recent memories with project isolation
// ============================================================================
function listMemories(projectId, limit = 20, includeDeleted = false) {
    const project = getEffectiveProject(projectId);
    let sql = `
    SELECT * FROM memories 
    WHERE (project_id = ? OR project_id = 'global')
    ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
    ORDER BY last_accessed DESC
    LIMIT ?
  `;
    const memories = db.prepare(sql).all(project, limit);
    return memories.map(m => ({
        id: m.id,
        project_id: m.project_id,
        content: m.content.slice(0, 200) + (m.content.length > 200 ? '...' : ''),
        type: m.type,
        tags: JSON.parse(m.tags || '[]'),
        importance: m.importance,
        confidence: calculateEffectiveConfidence(m),
        confidenceLevel: assessConfidence(m).level,
        created_at: m.created_at,
        last_accessed: m.last_accessed,
        deleted_at: m.deleted_at
    }));
}
// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new index_js_1.Server({ name: 'just-memory', version: '2.0.0' }, { capabilities: { tools: {} } });
// Tool definitions
const TOOLS = [
    // Memory CRUD
    {
        name: 'memory_store',
        description: 'Store a new memory with optional project isolation. Memories are automatically scoped to the current project unless project_id="global" is specified.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Memory content (max 100KB)' },
                type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'], default: 'note' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Up to 20 tags' },
                importance: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
                confidence: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
                project_id: { type: 'string', description: 'Project to store in. Omit to use current project, "global" for cross-project.' }
            },
            required: ['content']
        }
    },
    {
        name: 'memory_recall',
        description: 'Recall a memory by ID. Strengthens the memory and boosts confidence.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Memory ID' }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_update',
        description: 'Update an existing memory. Re-checks for contradictions if content changes.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                type: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_delete',
        description: 'Delete a memory. Soft delete by default (can restore), permanent with permanent=true.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                permanent: { type: 'boolean', default: false }
            },
            required: ['id']
        }
    },
    // Search
    {
        name: 'memory_search',
        description: 'Search memories using hybrid keyword + semantic search. Automatically searches current project and global memories.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', default: 10 },
                confidenceThreshold: { type: 'number', default: 0, description: 'Minimum confidence (0-1)' },
                project_id: { type: 'string', description: 'Specific project to search, omit for current project' }
            },
            required: ['query']
        }
    },
    {
        name: 'memory_list',
        description: 'List recent memories from current project.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', default: 20 },
                includeDeleted: { type: 'boolean', default: false },
                project_id: { type: 'string' }
            }
        }
    },
    // Confidence
    {
        name: 'memory_confirm',
        description: 'Add confirming source to a memory, increasing its confidence.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                sourceId: { type: 'string', description: 'Optional ID of confirming memory' }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_contradict',
        description: 'Record a contradiction, decreasing the memory confidence.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                contradictingId: { type: 'string', description: 'Optional ID of contradicting memory' }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_confident',
        description: 'Get high-confidence memories.',
        inputSchema: {
            type: 'object',
            properties: {
                confidenceThreshold: { type: 'number', default: 0.5 },
                limit: { type: 'number', default: 20 },
                project_id: { type: 'string' }
            }
        }
    },
    // Edges
    {
        name: 'memory_edge_create',
        description: 'Create a temporal relationship between two memories.',
        inputSchema: {
            type: 'object',
            properties: {
                fromId: { type: 'string' },
                toId: { type: 'string' },
                relationType: { type: 'string' },
                confidence: { type: 'number', default: 1.0 },
                metadata: { type: 'object' },
                project_id: { type: 'string' }
            },
            required: ['fromId', 'toId', 'relationType']
        }
    },
    {
        name: 'memory_edge_query',
        description: 'Query relationships for a memory.',
        inputSchema: {
            type: 'object',
            properties: {
                memoryId: { type: 'string' },
                direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], default: 'both' },
                project_id: { type: 'string' }
            },
            required: ['memoryId']
        }
    },
    {
        name: 'memory_edge_invalidate',
        description: 'Invalidate an edge (set end date).',
        inputSchema: {
            type: 'object',
            properties: {
                edgeId: { type: 'string' }
            },
            required: ['edgeId']
        }
    },
    // Scratchpad
    {
        name: 'memory_scratch_set',
        description: 'Set a scratchpad value with optional TTL. Scoped to current project.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string' },
                value: { type: 'string' },
                ttlSeconds: { type: 'number', description: 'Expiry in seconds' },
                project_id: { type: 'string' }
            },
            required: ['key', 'value']
        }
    },
    {
        name: 'memory_scratch_get',
        description: 'Get a scratchpad value.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string' },
                project_id: { type: 'string' }
            },
            required: ['key']
        }
    },
    {
        name: 'memory_scratch_delete',
        description: 'Delete a scratchpad key.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string' },
                project_id: { type: 'string' }
            },
            required: ['key']
        }
    },
    {
        name: 'memory_scratch_list',
        description: 'List all scratchpad keys.',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_scratch_clear',
        description: 'Clear all scratchpad keys for current project.',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    // Entities (Knowledge Graph)
    {
        name: 'memory_entity_create',
        description: 'Create or update a knowledge graph entity. If entity exists, observations are merged.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Unique entity name' },
                entityType: { type: 'string', description: 'Entity type (person, project, concept, etc.)' },
                observations: { type: 'array', items: { type: 'string' }, description: 'Facts about this entity' },
                project_id: { type: 'string' }
            },
            required: ['name']
        }
    },
    {
        name: 'memory_entity_get',
        description: 'Get an entity by name with all its relations.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                project_id: { type: 'string' }
            },
            required: ['name']
        }
    },
    {
        name: 'memory_entity_link',
        description: 'Create a relation between two entities. Use active voice (e.g., "works_at", "knows").',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string' },
                relationType: { type: 'string' },
                to: { type: 'string' },
                project_id: { type: 'string' }
            },
            required: ['from', 'relationType', 'to']
        }
    },
    {
        name: 'memory_entity_search',
        description: 'Search entities by name or observation content.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                entityType: { type: 'string', description: 'Filter by entity type' },
                limit: { type: 'number', default: 20 },
                project_id: { type: 'string' }
            },
            required: ['query']
        }
    },
    {
        name: 'memory_entity_observe',
        description: 'Add observations to an existing entity.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                observations: { type: 'array', items: { type: 'string' } },
                project_id: { type: 'string' }
            },
            required: ['name', 'observations']
        }
    },
    {
        name: 'memory_entity_delete',
        description: 'Delete an entity and all its relations.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                project_id: { type: 'string' }
            },
            required: ['name']
        }
    },
    // Backup/Restore
    {
        name: 'memory_backup',
        description: 'Create a backup of all memories (or specific project).',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: 'Project to backup, omit for all projects' }
            }
        }
    },
    {
        name: 'memory_restore',
        description: 'Restore memories from a backup file.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to backup file' },
                mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge' },
                target_project: { type: 'string', description: 'Project to restore into' }
            },
            required: ['path']
        }
    },
    {
        name: 'memory_list_backups',
        description: 'List available backup files.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    // Stats
    {
        name: 'memory_stats',
        description: 'Get memory statistics for current project or all projects.',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: 'Project to get stats for, omit for all' }
            }
        }
    },
    // Briefing
    {
        name: 'memory_briefing',
        description: 'Generate a session briefing with recent memories and entities.',
        inputSchema: {
            type: 'object',
            properties: {
                maxTokens: { type: 'number', default: 500 },
                project_id: { type: 'string' }
            }
        }
    },
    // NEW: Project Management
    {
        name: 'memory_project_list',
        description: 'List all projects with memory counts and last activity.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'memory_project_set',
        description: 'Set the current project context for memory operations.',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: 'Project ID to switch to' },
                path: { type: 'string', description: 'Optional project path' }
            },
            required: ['project_id']
        }
    }
];
// Register tools
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
    tools: TOOLS
}));
// Handle tool calls
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = rawArgs; // Cast to any to handle dynamic tool arguments
    try {
        let result;
        switch (name) {
            // Memory CRUD
            case 'memory_store':
                result = await storeMemory(args.content, args.type, args.tags, args.importance, args.confidence, args.project_id);
                break;
            case 'memory_recall':
                result = recallMemory(args.id);
                break;
            case 'memory_update':
                result = await updateMemory(args.id, args);
                break;
            case 'memory_delete':
                result = deleteMemory(args.id, args.permanent);
                break;
            // Search
            case 'memory_search':
                result = await hybridSearch(args.query, getEffectiveProject(args.project_id), args.limit || 10, args.confidenceThreshold || 0);
                break;
            case 'memory_list':
                result = listMemories(args.project_id, args.limit, args.includeDeleted);
                break;
            // Confidence
            case 'memory_confirm':
                result = confirmMemory(args.id, args.sourceId);
                break;
            case 'memory_contradict':
                result = contradictMemory(args.id, args.contradictingId);
                break;
            case 'memory_confident':
                result = getConfidentMemories(args.confidenceThreshold, args.project_id, args.limit);
                break;
            // Edges
            case 'memory_edge_create':
                result = createEdge(args.fromId, args.toId, args.relationType, args.confidence, args.metadata, args.project_id);
                break;
            case 'memory_edge_query':
                result = queryEdges(args.memoryId, args.direction, args.project_id);
                break;
            case 'memory_edge_invalidate':
                result = invalidateEdge(args.edgeId);
                break;
            // Scratchpad
            case 'memory_scratch_set':
                result = scratchSet(args.key, args.value, args.ttlSeconds, args.project_id);
                break;
            case 'memory_scratch_get':
                result = scratchGet(args.key, args.project_id);
                break;
            case 'memory_scratch_delete':
                result = scratchDelete(args.key, args.project_id);
                break;
            case 'memory_scratch_list':
                result = scratchList(args.project_id);
                break;
            case 'memory_scratch_clear':
                result = scratchClear(args.project_id);
                break;
            // Entities
            case 'memory_entity_create':
                result = createEntity(args.name, args.entityType, args.observations, args.project_id);
                break;
            case 'memory_entity_get':
                result = getEntity(args.name, args.project_id);
                break;
            case 'memory_entity_link':
                result = linkEntities(args.from, args.relationType, args.to, args.project_id);
                break;
            case 'memory_entity_search':
                result = searchEntities(args.query, args.entityType, args.project_id, args.limit);
                break;
            case 'memory_entity_observe':
                result = observeEntity(args.name, args.observations, args.project_id);
                break;
            case 'memory_entity_delete':
                result = deleteEntity(args.name, args.project_id);
                break;
            // Backup/Restore
            case 'memory_backup':
                result = backupMemories(args.project_id);
                break;
            case 'memory_restore':
                result = restoreMemories(args.path, args.mode, args.target_project);
                break;
            case 'memory_list_backups':
                result = listBackups();
                break;
            // Stats
            case 'memory_stats':
                result = getStats(args.project_id);
                break;
            // Briefing
            case 'memory_briefing':
                const projectId = getEffectiveProject(args.project_id);
                const recentMemories = listMemories(projectId, 10);
                const recentEntities = searchEntities('', undefined, projectId, 10);
                result = {
                    project_id: projectId,
                    memories: recentMemories,
                    entities: recentEntities,
                    stats: getStats(projectId)
                };
                break;
            // Project Management
            case 'memory_project_list':
                result = listProjects();
                break;
            case 'memory_project_set':
                result = setCurrentProject(args.project_id, args.path);
                break;
            default:
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
                    isError: true
                };
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message || String(error) }) }],
            isError: true
        };
    }
});
// Start server
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('[Just-Memory v2.0] Server started');
    console.error(`[Just-Memory v2.0] Project: ${currentProjectId} (from ${detectProject().source})`);
    console.error(`[Just-Memory v2.0] Database: ${DB_PATH}`);
    console.error(`[Just-Memory v2.0] Tools: ${TOOLS.length}`);
}
main().catch(console.error);
//# sourceMappingURL=just-memory-v2.0.js.map