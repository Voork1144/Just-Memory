"use strict";
/**
 * Just-Memory v2.9 - Intent Prediction
 *
 * New in v2.9:
 * - User intent detection from text patterns
 * - Intent inference from access patterns
 * - Memory suggestions based on detected intent
 * - Intent tracking and lifecycle (active -> completed)
 * - 10 intent types: learning, planning, debugging, building, reviewing,
 *   documenting, searching, comparing, deciding, refactoring
 * - New tools: memory_predict_intent, memory_infer_intent, memory_create_intent,
 *   memory_active_intents, memory_complete_intent, memory_suggest_for_intent
 *
 * Previous v2.8 features:
 * - Enhanced contradiction resolution workflow
 *
 * Previous v2.7 features:
 * - Scheduled tasks with cron & natural language
 *
 * Tool count: 71
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
    console.error('[Just-Memory v2.1] Pre-warming embedding model...');
    try {
        const { pipeline, env } = await Promise.resolve().then(() => __importStar(require('@xenova/transformers')));
        env.cacheDir = MODEL_CACHE;
        env.localModelPath = MODEL_CACHE;
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true,
        });
        embedderReady = true;
        console.error('[Just-Memory v2.1] Embedding model ready');
    }
    catch (err) {
        console.error('[Just-Memory v2.1] Failed to load embedding model:', err);
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
        console.error('[Just-Memory v2.1] Embedding generation failed:', err);
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
// Contradiction Detection Constants
// ============================================================================
const CONTRADICTION_CONFIG = {
    // Semantic similarity threshold for related memories
    SEMANTIC_SIMILARITY_THRESHOLD: 0.6,
    // Minimum similarity for factual comparison
    FACTUAL_SIMILARITY_THRESHOLD: 0.7,
    // Confidence penalty for different contradiction types
    PENALTY: {
        SEMANTIC: 0.15,
        FACTUAL: 0.25,
        TEMPORAL: 0.10,
        NEGATION: 0.20,
    },
    // Maximum contradictions to return
    MAX_RESULTS: 10,
};
// Negation patterns (expanded from basic)
const NEGATION_PATTERNS = {
    EXPLICIT: ['not', "n't", "don't", "doesn't", "isn't", "aren't", "won't", "can't", "never", 'no', 'none', 'neither', 'nor', 'nothing', 'nobody', 'nowhere', 'hardly', 'barely', 'scarcely'],
    IMPLICIT: ['fail', 'failed', 'unable', 'impossible', 'false', 'wrong', 'incorrect', 'untrue', 'refuse', 'refused', 'deny', 'denied', 'reject', 'rejected', 'stop', 'stopped', 'end', 'ended', 'cease', 'ceased', 'lack', 'lacking', 'absent', 'missing', 'without', 'free from', 'devoid'],
    // Antonym pairs for contradiction detection
    ANTONYMS: [
        ['true', 'false'], ['yes', 'no'], ['good', 'bad'], ['right', 'wrong'],
        ['up', 'down'], ['in', 'out'], ['on', 'off'], ['start', 'stop'],
        ['open', 'close'], ['begin', 'end'], ['love', 'hate'], ['like', 'dislike'],
        ['hot', 'cold'], ['fast', 'slow'], ['big', 'small'], ['large', 'small'],
        ['high', 'low'], ['new', 'old'], ['young', 'old'], ['alive', 'dead'],
        ['success', 'failure'], ['win', 'lose'], ['increase', 'decrease'],
        ['accept', 'reject'], ['agree', 'disagree'], ['allow', 'forbid'],
        ['always', 'never'], ['before', 'after'], ['buy', 'sell'],
        ['create', 'destroy'], ['early', 'late'], ['easy', 'hard'],
        ['empty', 'full'], ['enter', 'exit'], ['first', 'last'],
        ['give', 'take'], ['happy', 'sad'], ['include', 'exclude'],
        ['inside', 'outside'], ['more', 'less'], ['possible', 'impossible'],
        ['present', 'absent'], ['push', 'pull'], ['remember', 'forget'],
        ['safe', 'dangerous'], ['same', 'different'], ['strong', 'weak'],
    ],
};
// Factual claim patterns for entity extraction
const FACTUAL_PATTERNS = [
    // "X is Y" patterns
    /^(.+?)\s+(?:is|are|was|were)\s+(?:a|an|the)?\s*(.+)$/i,
    // "X has Y" patterns
    /^(.+?)\s+(?:has|have|had)\s+(?:a|an|the)?\s*(.+)$/i,
    // "X = Y" patterns
    /^(.+?)\s*(?:=|equals?)\s*(.+)$/i,
    // "The capital of X is Y" patterns
    /^(?:the\s+)?(\w+)\s+(?:of|for)\s+(.+?)\s+(?:is|was|are|were)\s+(.+)$/i,
    // "X lives in Y" patterns
    /^(.+?)\s+(?:lives?|resides?|works?|stays?)\s+(?:in|at)\s+(.+)$/i,
    // "X was born in Y" patterns
    /^(.+?)\s+(?:was\s+born|born|died|started|ended)\s+(?:in|on|at)\s+(.+)$/i,
    // Numeric facts: "X costs Y", "X weighs Y"
    /^(.+?)\s+(?:costs?|weighs?|measures?|contains?)\s+(.+)$/i,
];
// ============================================================================
// Project Detection
// ============================================================================
let currentProjectId = GLOBAL_PROJECT;
let currentProjectPath = null;
function detectProject(startPath) {
    const envProject = process.env.CLAUDE_PROJECT || process.env.JUST_MEMORY_PROJECT;
    if (envProject) {
        return { id: envProject, path: null, source: 'env' };
    }
    let searchPath = startPath || process.cwd();
    let current = (0, path_1.resolve)(searchPath);
    const root = (0, os_1.platform)() === 'win32' ? current.split(path_1.sep)[0] + path_1.sep : '/';
    while (current !== root) {
        const gitPath = (0, path_1.join)(current, '.git');
        if ((0, fs_1.existsSync)(gitPath)) {
            const projectName = (0, path_1.basename)(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            return { id: projectName, path: current, source: 'git' };
        }
        const packagePath = (0, path_1.join)(current, 'package.json');
        if ((0, fs_1.existsSync)(packagePath)) {
            try {
                const pkg = JSON.parse((0, fs_1.readFileSync)(packagePath, 'utf-8'));
                const projectName = (pkg.name || (0, path_1.basename)(current)).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
                return { id: projectName, path: current, source: 'package.json' };
            }
            catch { }
        }
        const pyprojectPath = (0, path_1.join)(current, 'pyproject.toml');
        if ((0, fs_1.existsSync)(pyprojectPath)) {
            const projectName = (0, path_1.basename)(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            return { id: projectName, path: current, source: 'pyproject.toml' };
        }
        const cargoPath = (0, path_1.join)(current, 'Cargo.toml');
        if ((0, fs_1.existsSync)(cargoPath)) {
            const projectName = (0, path_1.basename)(current).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            return { id: projectName, path: current, source: 'Cargo.toml' };
        }
        const parent = (0, path_1.dirname)(current);
        if (parent === current)
            break;
        current = parent;
    }
    return { id: GLOBAL_PROJECT, path: null, source: 'default' };
}
function initProject() {
    const detected = detectProject();
    currentProjectId = detected.id;
    currentProjectPath = detected.path;
    console.error(`[Just-Memory v2.1] Project: ${detected.id} (${detected.source})`);
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
try {
    sqliteVec.load(db);
    console.error('[Just-Memory v2.1] sqlite-vec extension loaded');
}
catch (err) {
    console.error('[Just-Memory v2.1] Warning: sqlite-vec load failed:', err);
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
  CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation_type);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS scratchpad (
    key TEXT NOT NULL,
    project_id TEXT DEFAULT 'global',
    value TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (key, project_id)
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
// Entity type hierarchy table - supports inheritance like Person > Developer > Senior Developer
db.exec(`
  CREATE TABLE IF NOT EXISTS entity_types (
    name TEXT PRIMARY KEY,
    parent_type TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (parent_type) REFERENCES entity_types(name)
  );
  CREATE INDEX IF NOT EXISTS idx_entity_types_parent ON entity_types(parent_type);
`);
// Seed default types if table is empty
const typeCount = db.prepare('SELECT COUNT(*) as count FROM entity_types').get().count;
if (typeCount === 0) {
    const defaultTypes = [
        { name: 'concept', parent: null, description: 'Abstract idea or notion' },
        { name: 'person', parent: null, description: 'Human individual' },
        { name: 'organization', parent: null, description: 'Company, team, or group' },
        { name: 'project', parent: null, description: 'Work initiative or codebase' },
        { name: 'technology', parent: null, description: 'Tool, framework, or language' },
        { name: 'location', parent: null, description: 'Physical or virtual place' },
        { name: 'event', parent: null, description: 'Occurrence in time' },
        { name: 'document', parent: null, description: 'File, specification, or record' },
    ];
    const insertType = db.prepare('INSERT OR IGNORE INTO entity_types (name, parent_type, description) VALUES (?, ?, ?)');
    for (const t of defaultTypes) {
        insertType.run(t.name, t.parent, t.description);
    }
}
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
// Memory access sequences table - tracks which memories are accessed together
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_access_sequences (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    project_id TEXT DEFAULT 'global',
    memory_ids TEXT NOT NULL,
    context TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_access_seq_session ON memory_access_sequences(session_id);
  CREATE INDEX IF NOT EXISTS idx_access_seq_project ON memory_access_sequences(project_id);
`);
// Memory co-access table - pre-computed co-occurrence counts for fast suggestions
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_coaccess (
    memory_id_a TEXT NOT NULL,
    memory_id_b TEXT NOT NULL,
    project_id TEXT DEFAULT 'global',
    coaccess_count INTEGER DEFAULT 1,
    last_accessed TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (memory_id_a, memory_id_b, project_id)
  );
  CREATE INDEX IF NOT EXISTS idx_coaccess_a ON memory_coaccess(memory_id_a);
  CREATE INDEX IF NOT EXISTS idx_coaccess_b ON memory_coaccess(memory_id_b);
`);
// Migration: Add emotional context columns to memories table
try {
    db.exec(`ALTER TABLE memories ADD COLUMN sentiment TEXT DEFAULT 'neutral'`);
}
catch { }
try {
    db.exec(`ALTER TABLE memories ADD COLUMN emotion_intensity REAL DEFAULT 0.0`);
}
catch { }
try {
    db.exec(`ALTER TABLE memories ADD COLUMN emotion_labels TEXT DEFAULT '[]'`);
}
catch { }
try {
    db.exec(`ALTER TABLE memories ADD COLUMN user_mood TEXT`);
}
catch { }
// Index for emotion-based queries
try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_sentiment ON memories(sentiment)`);
}
catch { }
try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_emotion_intensity ON memories(emotion_intensity)`);
}
catch { }
// User intent tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_intents (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    intent_type TEXT NOT NULL,
    description TEXT,
    confidence REAL DEFAULT 0.5,
    context_keywords TEXT DEFAULT '[]',
    related_memories TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    last_observed TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_intent_project ON user_intents(project_id);
  CREATE INDEX IF NOT EXISTS idx_intent_type ON user_intents(intent_type);
  CREATE INDEX IF NOT EXISTS idx_intent_status ON user_intents(status);
`);
// Intent signals table (for learning)
db.exec(`
  CREATE TABLE IF NOT EXISTS intent_signals (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    intent_id TEXT,
    signal_type TEXT NOT NULL,
    signal_data TEXT DEFAULT '{}',
    strength REAL DEFAULT 0.5,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (intent_id) REFERENCES user_intents(id)
  );
  CREATE INDEX IF NOT EXISTS idx_signal_intent ON intent_signals(intent_id);
`);
// Contradiction resolutions table
db.exec(`
  CREATE TABLE IF NOT EXISTS contradiction_resolutions (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    memory_id_1 TEXT NOT NULL,
    memory_id_2 TEXT NOT NULL,
    resolution_type TEXT DEFAULT 'pending',
    chosen_memory TEXT,
    resolution_note TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (memory_id_1) REFERENCES memories(id),
    FOREIGN KEY (memory_id_2) REFERENCES memories(id)
  );
  CREATE INDEX IF NOT EXISTS idx_resolution_project ON contradiction_resolutions(project_id);
  CREATE INDEX IF NOT EXISTS idx_resolution_type ON contradiction_resolutions(resolution_type);
`);
// Scheduled tasks table
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    title TEXT NOT NULL,
    description TEXT,
    cron_expression TEXT,
    next_run TEXT,
    last_run TEXT,
    status TEXT DEFAULT 'pending',
    recurring INTEGER DEFAULT 0,
    memory_id TEXT,
    action_type TEXT DEFAULT 'reminder',
    action_data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (memory_id) REFERENCES memories(id)
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_project ON scheduled_tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_scheduled_next_run ON scheduled_tasks(next_run);
`);
// Counterfactual reasoning table
db.exec(`
  CREATE TABLE IF NOT EXISTS causal_relationships (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    cause_id TEXT NOT NULL,
    effect_id TEXT NOT NULL,
    relationship_type TEXT DEFAULT 'causes',
    strength REAL DEFAULT 0.7,
    confidence REAL DEFAULT 0.5,
    context TEXT,
    conditions TEXT DEFAULT '[]',
    counterfactual_tested INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (cause_id) REFERENCES memories(id),
    FOREIGN KEY (effect_id) REFERENCES memories(id)
  );
  CREATE INDEX IF NOT EXISTS idx_causal_project ON causal_relationships(project_id);
  CREATE INDEX IF NOT EXISTS idx_causal_cause ON causal_relationships(cause_id);
  CREATE INDEX IF NOT EXISTS idx_causal_effect ON causal_relationships(effect_id);
`);
// Alternative outcomes table for "what if" analysis
db.exec(`
  CREATE TABLE IF NOT EXISTS alternative_outcomes (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    causal_id TEXT NOT NULL,
    alternative_cause TEXT NOT NULL,
    predicted_outcome TEXT NOT NULL,
    actual_outcome TEXT,
    likelihood REAL DEFAULT 0.5,
    explored INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (causal_id) REFERENCES causal_relationships(id)
  );
  CREATE INDEX IF NOT EXISTS idx_alt_causal ON alternative_outcomes(causal_id);
`);
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
// ENHANCED Contradiction Detection (v2.1)
// ============================================================================
/**
 * Extract factual claims from text using pattern matching
 */
function extractFacts(text) {
    const facts = [];
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
                        raw: trimmed
                    });
                }
                else if (match.length === 4) {
                    facts.push({
                        subject: `${match[1]} of ${match[2]}`.trim().toLowerCase(),
                        predicate: 'is',
                        object: match[3].trim().toLowerCase(),
                        raw: trimmed
                    });
                }
                break;
            }
        }
    }
    return facts;
}
/**
 * Check if text contains explicit negation
 */
function hasNegation(text) {
    const lowerText = text.toLowerCase();
    for (const neg of NEGATION_PATTERNS.EXPLICIT) {
        if (lowerText.includes(neg)) {
            return { has: true, type: 'explicit', word: neg };
        }
    }
    for (const neg of NEGATION_PATTERNS.IMPLICIT) {
        if (lowerText.includes(neg)) {
            return { has: true, type: 'implicit', word: neg };
        }
    }
    return { has: false, type: 'none' };
}
/**
 * Check if two texts contain antonym pairs
 */
function findAntonymConflict(text1, text2) {
    const words1 = text1.toLowerCase().split(/\W+/);
    const words2 = text2.toLowerCase().split(/\W+/);
    for (const [word1, word2] of NEGATION_PATTERNS.ANTONYMS) {
        if ((words1.includes(word1) && words2.includes(word2)) ||
            (words1.includes(word2) && words2.includes(word1))) {
            return { found: true, pair: [word1, word2] };
        }
    }
    return { found: false };
}
/**
 * Check if two facts contradict each other
 */
function factsContradict(fact1, fact2) {
    // Same subject but different object
    const subject1Clean = fact1.subject.replace(/\s+/g, ' ').trim();
    const subject2Clean = fact2.subject.replace(/\s+/g, ' ').trim();
    // Check for similar subjects
    const subjectWords1 = subject1Clean.split(' ').filter(w => w.length > 2);
    const subjectWords2 = subject2Clean.split(' ').filter(w => w.length > 2);
    const subjectOverlap = subjectWords1.filter(w => subjectWords2.includes(w)).length;
    const subjectSimilar = subjectOverlap >= Math.min(subjectWords1.length, subjectWords2.length) * 0.5;
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
/**
 * Calculate cosine similarity between two embedding buffers
 */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length)
        return 0;
    const vecA = new Float32Array(a.buffer, a.byteOffset, a.length / 4);
    const vecB = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
/**
 * ENHANCED: Find contradictions using semantic similarity + pattern analysis
 * This is the main improvement in v2.1
 */
async function findContradictionsEnhanced(content, projectId, limit = CONTRADICTION_CONFIG.MAX_RESULTS, excludeId, includeSemanticSearch = true) {
    const results = [];
    const contentFacts = extractFacts(content);
    const contentNegation = hasNegation(content);
    const contentLower = content.toLowerCase();
    const contentWords = contentLower.split(/\W+/).filter(w => w.length > 3);
    // Get all active memories in project
    let sql = 'SELECT * FROM memories WHERE deleted_at IS NULL AND (project_id = ? OR project_id = \'global\')';
    const params = [projectId];
    if (excludeId) {
        sql += ' AND id != ?';
        params.push(excludeId);
    }
    const allMemories = db.prepare(sql).all(...params);
    // Generate embedding for semantic search if available
    let contentEmbedding = null;
    if (includeSemanticSearch && embedderReady) {
        contentEmbedding = await generateEmbedding(content);
    }
    for (const memory of allMemories) {
        const memoryLower = memory.content.toLowerCase();
        const memoryWords = memoryLower.split(/\W+/).filter((w) => w.length > 3);
        // Calculate word overlap
        const wordOverlap = contentWords.filter(w => memoryWords.includes(w)).length;
        const overlapRatio = wordOverlap / Math.max(contentWords.length, memoryWords.length);
        // Skip if no meaningful overlap and no embedding
        if (overlapRatio < 0.1 && !contentEmbedding)
            continue;
        // Calculate semantic similarity if embeddings available
        let semanticSimilarity = 0;
        if (contentEmbedding && memory.embedding) {
            semanticSimilarity = cosineSimilarity(memory.embedding, Buffer.from(contentEmbedding.buffer));
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
        if ((contentNegation.has !== memoryNegation.has) && (overlapRatio >= 0.2 || semanticSimilarity >= 0.5)) {
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
                suggestedAction: 'review'
            });
        }
        // 2. Antonym contradiction: texts contain opposing words
        else if (antonymConflict.found && (overlapRatio >= 0.15 || semanticSimilarity >= 0.4)) {
            results.push({
                id: memory.id,
                content: memory.content,
                contradictionType: 'antonym',
                confidence: Math.min(0.85, overlapRatio + 0.3),
                similarity: Math.max(overlapRatio, semanticSimilarity),
                explanation: `Contains opposing terms: "${antonymConflict.pair[0]}" vs "${antonymConflict.pair[1]}"`,
                suggestedAction: 'review'
            });
        }
        // 3. Factual contradiction: same subject, different object
        else if (contentFacts.length > 0 && memoryFacts.length > 0) {
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
                            suggestedAction: 'resolve'
                        });
                        break;
                    }
                }
            }
        }
        // 4. High semantic similarity with low word overlap (possible rephrasing with different meaning)
        else if (semanticSimilarity >= CONTRADICTION_CONFIG.FACTUAL_SIMILARITY_THRESHOLD &&
            overlapRatio < 0.3 &&
            (contentNegation.has || memoryNegation.has)) {
            results.push({
                id: memory.id,
                content: memory.content,
                contradictionType: 'semantic',
                confidence: semanticSimilarity * 0.8,
                similarity: semanticSimilarity,
                explanation: `High semantic similarity (${(semanticSimilarity * 100).toFixed(1)}%) but different wording with potential negation`,
                suggestedAction: 'review'
            });
        }
    }
    // Sort by confidence and return top results
    return results
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);
}
/**
 * Legacy findContradictions for backward compatibility
 */
function findContradictions(content, projectId, limit = 5, excludeId) {
    const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const negations = ['not', "don't", "doesn't", "isn't", "aren't", "won't", "can't", "never", 'no'];
    const hasNegationSimple = negations.some(n => content.toLowerCase().includes(n));
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
        const potentialContradiction = overlap >= 2 && hasNegationSimple !== mHasNegation;
        return { memory: m, overlap, potentialContradiction };
    });
    return scored.filter(s => s.potentialContradiction).sort((a, b) => b.overlap - a.overlap).slice(0, limit).map(s => s.memory);
}
// ============================================================================
// Core Memory Operations (with enhanced contradiction detection)
// ============================================================================
async function storeMemory(content, type = 'note', tags = [], importance = 0.5, confidence = 0.5, projectId) {
    validateContent(content);
    const validTags = validateTags(tags);
    const project = getEffectiveProject(projectId);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    // Use enhanced contradiction detection
    const contradictions = await findContradictionsEnhanced(content, project, 5);
    let adjustedConfidence = confidence;
    let contradictionPenalty = 0;
    for (const c of contradictions) {
        const penalty = CONTRADICTION_CONFIG.PENALTY[c.contradictionType.toUpperCase()] || 0.1;
        contradictionPenalty += penalty * c.confidence;
    }
    if (contradictions.length > 0) {
        adjustedConfidence = Math.max(0.1, confidence - contradictionPenalty);
    }
    const embedding = await generateEmbedding(content);
    const embeddingBuffer = embedding ? Buffer.from(embedding.buffer) : null;
    db.prepare(`INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, project, content, type, JSON.stringify(validTags), importance, adjustedConfidence, embeddingBuffer);
    // Create contradiction edges
    for (const c of contradictions) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        const metadata = JSON.stringify({
            type: c.contradictionType,
            confidence: c.confidence,
            explanation: c.explanation
        });
        db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(edgeId, project, id, c.id, `contradiction_${c.contradictionType}`, c.confidence, metadata);
    }
    return {
        id, project_id: project, content, type, tags: validTags, importance,
        confidence: adjustedConfidence, strength: 1.0,
        hasEmbedding: embedding !== null,
        contradictions: contradictions.map(c => ({
            id: c.id,
            type: c.contradictionType,
            confidence: c.confidence,
            explanation: c.explanation,
            suggestedAction: c.suggestedAction,
            preview: c.content.slice(0, 100)
        }))
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
    // Get related contradictions
    const contradictionEdges = db.prepare(`
    SELECT e.*, m.content as other_content 
    FROM edges e 
    JOIN memories m ON (e.from_id = m.id OR e.to_id = m.id) AND m.id != ?
    WHERE (e.from_id = ? OR e.to_id = ?) 
    AND e.relation_type LIKE 'contradiction_%'
    AND m.deleted_at IS NULL
  `).all(id, id, id);
    return {
        ...toConfidentMemory(updated),
        type: updated.type, tags: JSON.parse(updated.tags),
        importance: updated.importance, strength: updated.strength,
        access_count: updated.access_count, created_at: updated.created_at,
        last_accessed: updated.last_accessed,
        hasEmbedding: updated.embedding !== null,
        retention: calculateRetention(updated.last_accessed, updated.strength),
        contradictions: contradictionEdges.map((e) => ({
            type: e.relation_type.replace('contradiction_', ''),
            otherMemoryId: e.from_id === id ? e.to_id : e.from_id,
            preview: e.other_content?.slice(0, 100),
            metadata: JSON.parse(e.metadata || '{}')
        }))
    };
}
async function updateMemory(id, updates) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const fields = [];
    const values = [];
    let newContradictions = [];
    if (updates.content !== undefined) {
        validateContent(updates.content);
        fields.push('content = ?');
        values.push(updates.content);
        const embedding = await generateEmbedding(updates.content);
        if (embedding) {
            fields.push('embedding = ?');
            values.push(Buffer.from(embedding.buffer));
        }
        // Check for new contradictions with enhanced detection
        newContradictions = await findContradictionsEnhanced(updates.content, memory.project_id, 5, id);
        for (const c of newContradictions) {
            const existingEdge = db.prepare(`
        SELECT id FROM edges 
        WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
        AND relation_type LIKE 'contradiction_%'
      `).get(id, c.id, c.id, id);
            if (!existingEdge) {
                const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
                const metadata = JSON.stringify({
                    type: c.contradictionType,
                    confidence: c.confidence,
                    explanation: c.explanation
                });
                db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                    .run(edgeId, memory.project_id, id, c.id, `contradiction_${c.contradictionType}`, c.confidence, metadata);
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
        confidence: updated.confidence, hasEmbedding: updated.embedding !== null, updated: true,
        newContradictions: newContradictions.map(c => ({
            id: c.id,
            type: c.contradictionType,
            explanation: c.explanation,
            preview: c.content.slice(0, 100)
        }))
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
function listMemories(projectId, limit = 20, includeDeleted = false) {
    const project = getEffectiveProject(projectId);
    let sql = `
    SELECT * FROM memories 
    WHERE (project_id = ? OR project_id = 'global')
  `;
    if (!includeDeleted) {
        sql += ' AND deleted_at IS NULL';
    }
    sql += ' ORDER BY last_accessed DESC LIMIT ?';
    const memories = db.prepare(sql).all(project, limit);
    return memories.map(m => ({
        id: m.id,
        project_id: m.project_id,
        content: m.content,
        type: m.type,
        tags: JSON.parse(m.tags || '[]'),
        importance: m.importance,
        confidence: calculateEffectiveConfidence(m),
        confidenceLevel: assessConfidence(m).level,
        hasEmbedding: m.embedding !== null,
        deleted: m.deleted_at !== null
    }));
}
// ============================================================================
// Search Functions
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
        console.error('[Just-Memory v2.1] Semantic search unavailable - embedder not ready');
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
        console.error('[Just-Memory v2.1] Semantic search error:', err);
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
// Confidence Functions
// ============================================================================
function confirmMemory(id, sourceId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newSourceCount = memory.source_count + 1;
    const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.CONFIRMATION);
    db.prepare('UPDATE memories SET source_count = ?, confidence = ? WHERE id = ?')
        .run(newSourceCount, newConfidence, id);
    if (sourceId) {
        const edgeId = (0, crypto_1.randomUUID)().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, ?, 'confirms', 1.0)`)
            .run(edgeId, memory.project_id, sourceId, id);
    }
    return {
        id, project_id: memory.project_id, confidence: newConfidence,
        source_count: newSourceCount, confirmed: true
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
// NEW: Proactive Contradiction Finder Tool (v2.1)
// ============================================================================
async function findContradictionsProactive(content, projectId, limit = 10) {
    const project = getEffectiveProject(projectId);
    const contradictions = await findContradictionsEnhanced(content, project, limit, undefined, true);
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
        project_id: project,
        summary,
        contradictions: contradictions.map(c => ({
            id: c.id,
            type: c.contradictionType,
            confidence: c.confidence,
            similarity: c.similarity,
            explanation: c.explanation,
            suggestedAction: c.suggestedAction,
            content: c.content.slice(0, 300)
        }))
    };
}
// ============================================================================
// Edge Functions
// ============================================================================
function createEdge(fromId, toId, relationType, confidence = 1.0, metadata = {}, projectId) {
    const project = getEffectiveProject(projectId);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, project, fromId, toId, relationType, confidence, JSON.stringify(metadata));
    return { id, project_id: project, from_id: fromId, to_id: toId, relation_type: relationType, confidence };
}
function queryEdges(memoryId, direction = 'both', projectId) {
    const project = getEffectiveProject(projectId);
    let sql = 'SELECT * FROM edges WHERE (project_id = ? OR project_id = \'global\')';
    const params = [project];
    if (direction === 'outgoing') {
        sql += ' AND from_id = ?';
        params.push(memoryId);
    }
    else if (direction === 'incoming') {
        sql += ' AND to_id = ?';
        params.push(memoryId);
    }
    else {
        sql += ' AND (from_id = ? OR to_id = ?)';
        params.push(memoryId, memoryId);
    }
    const edges = db.prepare(sql).all(...params);
    return edges.map(e => ({
        ...e,
        metadata: JSON.parse(e.metadata || '{}')
    }));
}
function invalidateEdge(edgeId) {
    db.prepare("UPDATE edges SET valid_to = datetime('now') WHERE id = ?").run(edgeId);
    return { id: edgeId, invalidated: true };
}
// ============================================================================
// Scratchpad Functions
// ============================================================================
function scratchSet(key, value, ttlSeconds, projectId) {
    const project = getEffectiveProject(projectId);
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    db.prepare(`
    INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, ?)
  `).run(key, project, value, expiresAt);
    return { key, project_id: project, stored: true, expiresAt };
}
function scratchGet(key, projectId) {
    const project = getEffectiveProject(projectId);
    const row = db.prepare(`
    SELECT * FROM scratchpad 
    WHERE key = ? AND (project_id = ? OR project_id = 'global')
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(key, project, project);
    if (!row)
        return { key, value: null };
    return { key, value: row.value, expiresAt: row.expires_at, createdAt: row.created_at };
}
function scratchDelete(key, projectId) {
    const project = getEffectiveProject(projectId);
    db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?').run(key, project);
    return { key, deleted: true };
}
function scratchList(projectId) {
    const project = getEffectiveProject(projectId);
    const rows = db.prepare(`
    SELECT key, expires_at, created_at FROM scratchpad 
    WHERE (project_id = ? OR project_id = 'global')
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at DESC
  `).all(project);
    return { project_id: project, keys: rows };
}
function scratchClear(projectId) {
    const project = getEffectiveProject(projectId);
    const result = db.prepare('DELETE FROM scratchpad WHERE project_id = ?').run(project);
    return { project_id: project, cleared: result.changes };
}
// ============================================================================
// Entity Functions
// ============================================================================
function createEntity(name, entityType = 'concept', observations = [], projectId) {
    validateEntityName(name);
    const project = getEffectiveProject(projectId);
    const validObs = validateObservations(observations);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    try {
        db.prepare(`INSERT INTO entities (id, project_id, name, entity_type, observations) VALUES (?, ?, ?, ?, ?)`)
            .run(id, project, name, entityType, JSON.stringify(validObs));
        return { id, project_id: project, name, entityType, observations: validObs, created: true };
    }
    catch (err) {
        if (err.message.includes('UNIQUE')) {
            const existing = db.prepare('SELECT * FROM entities WHERE project_id = ? AND name = ?').get(project, name);
            const existingObs = JSON.parse(existing.observations || '[]');
            const mergedObs = [...new Set([...existingObs, ...validObs])];
            db.prepare(`UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(JSON.stringify(mergedObs), existing.id);
            return { id: existing.id, project_id: project, name, entityType: existing.entity_type, observations: mergedObs, merged: true };
        }
        throw err;
    }
}
function getEntity(name, projectId) {
    const project = getEffectiveProject(projectId);
    const entity = db.prepare(`
    SELECT * FROM entities WHERE name = ? AND (project_id = ? OR project_id = 'global')
    ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(name, project, project);
    if (!entity)
        return { error: 'Entity not found', name };
    const relations = db.prepare(`
    SELECT * FROM entity_relations 
    WHERE (from_entity = ? OR to_entity = ?) AND (project_id = ? OR project_id = 'global')
  `).all(entity.name, entity.name, project);
    return {
        id: entity.id,
        project_id: entity.project_id,
        name: entity.name,
        entityType: entity.entity_type,
        observations: JSON.parse(entity.observations || '[]'),
        relations: relations.map(r => ({
            from: r.from_entity,
            to: r.to_entity,
            type: r.relation_type
        }))
    };
}
function linkEntities(from, relationType, to, projectId) {
    const project = getEffectiveProject(projectId);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    try {
        db.prepare(`INSERT INTO entity_relations (id, project_id, from_entity, to_entity, relation_type) VALUES (?, ?, ?, ?, ?)`)
            .run(id, project, from, relationType, to);
        return { id, project_id: project, from, relationType, to, linked: true };
    }
    catch (err) {
        if (err.message.includes('UNIQUE')) {
            return { from, relationType, to, alreadyExists: true };
        }
        throw err;
    }
}
function searchEntities(query, entityType, projectId, limit = 20) {
    const project = getEffectiveProject(projectId);
    let sql = `
    SELECT * FROM entities 
    WHERE (project_id = ? OR project_id = 'global')
  `;
    const params = [project];
    if (query) {
        sql += ` AND (name LIKE ? OR observations LIKE ?)`;
        params.push(`%${sanitizeLikePattern(query)}%`, `%${sanitizeLikePattern(query)}%`);
    }
    if (entityType) {
        sql += ` AND entity_type = ?`;
        params.push(entityType);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);
    const entities = db.prepare(sql).all(...params);
    return entities.map(e => ({
        id: e.id,
        project_id: e.project_id,
        name: e.name,
        entityType: e.entity_type,
        observations: JSON.parse(e.observations || '[]')
    }));
}
function observeEntity(name, observations, projectId) {
    const project = getEffectiveProject(projectId);
    const entity = db.prepare(`
    SELECT * FROM entities WHERE name = ? AND (project_id = ? OR project_id = 'global')
    ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(name, project, project);
    if (!entity)
        return { error: 'Entity not found', name };
    const existingObs = JSON.parse(entity.observations || '[]');
    const newObs = validateObservations(observations);
    const mergedObs = [...new Set([...existingObs, ...newObs])];
    db.prepare(`UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(JSON.stringify(mergedObs), entity.id);
    return { id: entity.id, name, observations: mergedObs, added: newObs.length };
}
function deleteEntity(name, projectId) {
    const project = getEffectiveProject(projectId);
    const entity = db.prepare('SELECT * FROM entities WHERE name = ? AND project_id = ?').get(name, project);
    if (!entity)
        return { error: 'Entity not found', name };
    db.prepare('DELETE FROM entity_relations WHERE (from_entity = ? OR to_entity = ?) AND project_id = ?').run(name, name, project);
    db.prepare('DELETE FROM entities WHERE id = ?').run(entity.id);
    return { name, deleted: true };
}
// ============================================================================
// Entity Type Hierarchy Functions
// ============================================================================
/**
 * Define an entity type with optional parent for inheritance
 * Examples:
 *   defineEntityType('developer', 'person', 'Software developer')
 *   defineEntityType('senior_developer', 'developer', 'Senior software developer')
 */
function defineEntityType(name, parentType, description) {
    if (!name || typeof name !== 'string') {
        throw new Error('Entity type name is required');
    }
    const normalizedName = name.toLowerCase().replace(/\s+/g, '_');
    // Validate parent exists if specified
    if (parentType) {
        const parent = db.prepare('SELECT name FROM entity_types WHERE name = ?').get(parentType);
        if (!parent) {
            return { error: `Parent type '${parentType}' does not exist`, name: normalizedName };
        }
        // Prevent circular inheritance
        const ancestors = getTypeAncestors(parentType);
        if (ancestors.includes(normalizedName)) {
            return { error: `Circular inheritance detected: '${normalizedName}' is already an ancestor of '${parentType}'` };
        }
    }
    try {
        db.prepare('INSERT INTO entity_types (name, parent_type, description) VALUES (?, ?, ?)')
            .run(normalizedName, parentType || null, description || null);
        return { name: normalizedName, parentType: parentType || null, description, created: true };
    }
    catch (err) {
        if (err.message.includes('UNIQUE') || err.message.includes('PRIMARY KEY')) {
            // Update existing
            db.prepare('UPDATE entity_types SET parent_type = ?, description = ? WHERE name = ?')
                .run(parentType || null, description || null, normalizedName);
            return { name: normalizedName, parentType: parentType || null, description, updated: true };
        }
        throw err;
    }
}
/**
 * Get all ancestor types (parent chain) for a type
 */
function getTypeAncestors(typeName) {
    const ancestors = [];
    let current = typeName;
    const visited = new Set();
    while (current) {
        if (visited.has(current))
            break; // Prevent infinite loop
        visited.add(current);
        const type = db.prepare('SELECT parent_type FROM entity_types WHERE name = ?').get(current);
        if (type?.parent_type) {
            ancestors.push(type.parent_type);
            current = type.parent_type;
        }
        else {
            break;
        }
    }
    return ancestors;
}
/**
 * Get all descendant types (children, grandchildren, etc.) for a type
 */
function getTypeDescendants(typeName) {
    const descendants = [];
    const queue = [typeName];
    const visited = new Set();
    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current))
            continue;
        visited.add(current);
        const children = db.prepare('SELECT name FROM entity_types WHERE parent_type = ?').all(current);
        for (const child of children) {
            descendants.push(child.name);
            queue.push(child.name);
        }
    }
    return descendants;
}
/**
 * Get the full type hierarchy for a type (ancestors + self + descendants)
 */
function getTypeHierarchy(typeName) {
    const type = db.prepare('SELECT * FROM entity_types WHERE name = ?').get(typeName);
    if (!type) {
        return { error: `Entity type '${typeName}' not found` };
    }
    const ancestors = getTypeAncestors(typeName);
    const descendants = getTypeDescendants(typeName);
    return {
        name: type.name,
        description: type.description,
        parentType: type.parent_type,
        ancestors,
        descendants,
        depth: ancestors.length,
        subtypeCount: descendants.length
    };
}
/**
 * List all entity types with their hierarchy info
 */
function listEntityTypes() {
    const types = db.prepare('SELECT * FROM entity_types ORDER BY name').all();
    return types.map(t => ({
        name: t.name,
        parentType: t.parent_type,
        description: t.description,
        depth: getTypeAncestors(t.name).length,
        subtypeCount: getTypeDescendants(t.name).length
    }));
}
/**
 * Search entities by type including all subtypes (hierarchical search)
 * e.g., searching for 'person' will also find 'developer', 'senior_developer', etc.
 */
function searchEntitiesByTypeHierarchy(entityType, query, projectId, limit = 50) {
    const project = getEffectiveProject(projectId);
    // Get the type and all its descendants
    const allTypes = [entityType, ...getTypeDescendants(entityType)];
    let sql = `
    SELECT * FROM entities
    WHERE (project_id = ? OR project_id = 'global')
    AND entity_type IN (${allTypes.map(() => '?').join(', ')})
  `;
    const params = [project, ...allTypes];
    if (query) {
        sql += ` AND (name LIKE ? OR observations LIKE ?)`;
        params.push(`%${sanitizeLikePattern(query)}%`, `%${sanitizeLikePattern(query)}%`);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);
    const entities = db.prepare(sql).all(...params);
    return {
        searchedType: entityType,
        includedTypes: allTypes,
        count: entities.length,
        entities: entities.map(e => ({
            id: e.id,
            project_id: e.project_id,
            name: e.name,
            entityType: e.entity_type,
            observations: JSON.parse(e.observations || '[]')
        }))
    };
}
/**
 * Check if an entity type is a subtype of another
 */
function isSubtypeOf(childType, parentType) {
    if (childType === parentType)
        return true;
    const ancestors = getTypeAncestors(childType);
    return ancestors.includes(parentType);
}
// ============================================================================
// Proactive Retrieval Functions
// ============================================================================
/**
 * Record a memory access sequence - tracks which memories are accessed together
 * This data is used to predict what memories a user might need next
 */
function recordAccessSequence(memoryIds, sessionId, context, projectId) {
    if (!memoryIds || memoryIds.length === 0)
        return { recorded: false };
    const project = getEffectiveProject(projectId);
    const id = (0, crypto_1.randomUUID)().replace(/-/g, '');
    // Record the sequence
    db.prepare(`
    INSERT INTO memory_access_sequences (id, session_id, project_id, memory_ids, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sessionId, project, JSON.stringify(memoryIds), context || null);
    // Update co-access counts for all pairs in this sequence
    if (memoryIds.length > 1) {
        const updateCoaccess = db.prepare(`
      INSERT INTO memory_coaccess (memory_id_a, memory_id_b, project_id, coaccess_count, last_accessed)
      VALUES (?, ?, ?, 1, datetime('now'))
      ON CONFLICT(memory_id_a, memory_id_b, project_id) DO UPDATE SET
        coaccess_count = coaccess_count + 1,
        last_accessed = datetime('now')
    `);
        // Record co-access for each pair (bidirectional)
        for (let i = 0; i < memoryIds.length; i++) {
            for (let j = i + 1; j < memoryIds.length; j++) {
                updateCoaccess.run(memoryIds[i], memoryIds[j], project);
                updateCoaccess.run(memoryIds[j], memoryIds[i], project);
            }
        }
    }
    return { id, sessionId, project_id: project, memoryCount: memoryIds.length, recorded: true };
}
/**
 * Get memory suggestions based on access patterns
 * Given a memory or set of memories, suggest related ones based on co-access history
 */
function getSuggestions(memoryIds, projectId, limit = 10) {
    const project = getEffectiveProject(projectId);
    const ids = Array.isArray(memoryIds) ? memoryIds : [memoryIds];
    if (ids.length === 0)
        return { suggestions: [], reason: 'No memory IDs provided' };
    // Find memories most frequently accessed together with the given memories
    const placeholders = ids.map(() => '?').join(', ');
    const suggestions = db.prepare(`
    SELECT
      c.memory_id_b as memory_id,
      SUM(c.coaccess_count) as total_coaccess,
      MAX(c.last_accessed) as last_accessed
    FROM memory_coaccess c
    WHERE c.memory_id_a IN (${placeholders})
      AND c.memory_id_b NOT IN (${placeholders})
      AND c.project_id = ?
    GROUP BY c.memory_id_b
    ORDER BY total_coaccess DESC, last_accessed DESC
    LIMIT ?
  `).all(...ids, ...ids, project, limit);
    if (suggestions.length === 0) {
        return { suggestions: [], reason: 'No access patterns found for given memories' };
    }
    // Fetch full memory details for suggestions
    const suggestionIds = suggestions.map(s => s.memory_id);
    const suggestionPlaceholders = suggestionIds.map(() => '?').join(', ');
    const memories = db.prepare(`
    SELECT id, content, type, tags, confidence, importance
    FROM memories
    WHERE id IN (${suggestionPlaceholders}) AND deleted_at IS NULL
  `).all(...suggestionIds);
    const memoryMap = new Map(memories.map(m => [m.id, m]));
    return {
        basedOn: ids,
        suggestions: suggestions.map(s => ({
            memoryId: s.memory_id,
            coaccesScore: s.total_coaccess,
            lastAccessed: s.last_accessed,
            memory: memoryMap.get(s.memory_id) ? {
                content: memoryMap.get(s.memory_id).content,
                type: memoryMap.get(s.memory_id).type,
                tags: JSON.parse(memoryMap.get(s.memory_id).tags || '[]'),
                confidence: memoryMap.get(s.memory_id).confidence
            } : null
        })).filter(s => s.memory !== null)
    };
}
/**
 * Get access patterns - analyze how memories are typically accessed
 */
function getAccessPatterns(projectId, limit = 20) {
    const project = getEffectiveProject(projectId);
    // Most frequently co-accessed pairs
    const topPairs = db.prepare(`
    SELECT
      memory_id_a,
      memory_id_b,
      coaccess_count,
      last_accessed
    FROM memory_coaccess
    WHERE project_id = ?
    ORDER BY coaccess_count DESC
    LIMIT ?
  `).all(project, limit);
    // Most accessed memories overall (from sequences)
    const mostAccessed = db.prepare(`
    SELECT memory_id, COUNT(*) as access_count
    FROM (
      SELECT json_each.value as memory_id
      FROM memory_access_sequences, json_each(memory_ids)
      WHERE project_id = ?
    )
    GROUP BY memory_id
    ORDER BY access_count DESC
    LIMIT ?
  `).all(project, limit);
    // Recent sessions with their access patterns
    const recentSessions = db.prepare(`
    SELECT session_id, COUNT(*) as sequence_count, MAX(created_at) as last_active
    FROM memory_access_sequences
    WHERE project_id = ?
    GROUP BY session_id
    ORDER BY last_active DESC
    LIMIT 10
  `).all(project);
    return {
        project_id: project,
        topCoaccessPairs: topPairs.map(p => ({
            memoryA: p.memory_id_a,
            memoryB: p.memory_id_b,
            coaccesCount: p.coaccess_count,
            lastAccessed: p.last_accessed
        })),
        mostAccessedMemories: mostAccessed,
        recentSessions: recentSessions,
        stats: {
            totalCoAccessRecords: db.prepare('SELECT COUNT(*) as count FROM memory_coaccess WHERE project_id = ?').get(project).count,
            totalSequences: db.prepare('SELECT COUNT(*) as count FROM memory_access_sequences WHERE project_id = ?').get(project).count
        }
    };
}
/**
 * Suggest memories based on context text (using semantic similarity if available, otherwise keyword matching)
 */
function suggestFromContext(contextText, projectId, limit = 10) {
    const project = getEffectiveProject(projectId);
    // Extract keywords from context (simple word extraction)
    const words = contextText.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 10);
    if (words.length === 0) {
        return { suggestions: [], reason: 'No meaningful keywords in context' };
    }
    // Search memories matching any of the keywords
    const likeConditions = words.map(() => '(content LIKE ? OR tags LIKE ?)').join(' OR ');
    const params = [];
    for (const word of words) {
        params.push(`%${sanitizeLikePattern(word)}%`, `%${sanitizeLikePattern(word)}%`);
    }
    const memories = db.prepare(`
    SELECT id, content, type, tags, confidence, importance
    FROM memories
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND (${likeConditions})
    ORDER BY importance DESC, confidence DESC
    LIMIT ?
  `).all(project, ...params, limit);
    return {
        context: contextText.slice(0, 100) + (contextText.length > 100 ? '...' : ''),
        keywords: words,
        suggestions: memories.map(m => ({
            id: m.id,
            content: m.content,
            type: m.type,
            tags: JSON.parse(m.tags || '[]'),
            confidence: m.confidence,
            importance: m.importance
        }))
    };
}
// ============================================================================
// Emotional Context Functions
// ============================================================================
// Valid sentiment values
const VALID_SENTIMENTS = ['positive', 'negative', 'neutral', 'mixed'];
// Common emotion labels
const COMMON_EMOTIONS = [
    'happy', 'sad', 'angry', 'fearful', 'surprised', 'disgusted',
    'excited', 'anxious', 'frustrated', 'hopeful', 'grateful', 'proud',
    'confused', 'curious', 'bored', 'stressed', 'calm', 'content'
];
/**
 * Set emotional context for a memory
 */
function setEmotionalContext(memoryId, sentiment, emotionIntensity, emotionLabels, userMood, projectId) {
    const project = getEffectiveProject(projectId);
    // Validate memory exists
    const memory = db.prepare('SELECT id FROM memories WHERE id = ? AND (project_id = ? OR project_id = \'global\')').get(memoryId, project);
    if (!memory) {
        return { error: 'Memory not found', memoryId };
    }
    // Validate sentiment
    const validSentiment = VALID_SENTIMENTS.includes(sentiment) ? sentiment : 'neutral';
    // Validate emotion intensity (0.0 to 1.0)
    const validIntensity = emotionIntensity !== undefined
        ? Math.max(0, Math.min(1, emotionIntensity))
        : 0.5;
    // Validate emotion labels
    const validLabels = emotionLabels
        ? emotionLabels.filter(l => typeof l === 'string').slice(0, 10)
        : [];
    db.prepare(`
    UPDATE memories SET
      sentiment = ?,
      emotion_intensity = ?,
      emotion_labels = ?,
      user_mood = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(validSentiment, validIntensity, JSON.stringify(validLabels), userMood || null, memoryId);
    return {
        memoryId,
        sentiment: validSentiment,
        emotionIntensity: validIntensity,
        emotionLabels: validLabels,
        userMood: userMood || null,
        updated: true
    };
}
/**
 * Get emotional context for a memory
 */
function getEmotionalContext(memoryId, projectId) {
    const project = getEffectiveProject(projectId);
    const memory = db.prepare(`
    SELECT id, content, sentiment, emotion_intensity, emotion_labels, user_mood
    FROM memories
    WHERE id = ? AND (project_id = ? OR project_id = 'global') AND deleted_at IS NULL
  `).get(memoryId, project);
    if (!memory) {
        return { error: 'Memory not found', memoryId };
    }
    return {
        memoryId: memory.id,
        content: memory.content,
        sentiment: memory.sentiment || 'neutral',
        emotionIntensity: memory.emotion_intensity || 0,
        emotionLabels: JSON.parse(memory.emotion_labels || '[]'),
        userMood: memory.user_mood
    };
}
/**
 * Search memories by emotional context
 */
function searchByEmotion(sentiment, minIntensity, maxIntensity, emotionLabel, projectId, limit = 50) {
    const project = getEffectiveProject(projectId);
    let sql = `SELECT * FROM memories WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')`;
    const params = [project];
    if (sentiment) {
        sql += ` AND sentiment = ?`;
        params.push(sentiment);
    }
    if (minIntensity !== undefined) {
        sql += ` AND emotion_intensity >= ?`;
        params.push(minIntensity);
    }
    if (maxIntensity !== undefined) {
        sql += ` AND emotion_intensity <= ?`;
        params.push(maxIntensity);
    }
    if (emotionLabel) {
        sql += ` AND emotion_labels LIKE ?`;
        params.push(`%"${sanitizeLikePattern(emotionLabel)}"%`);
    }
    sql += ` ORDER BY emotion_intensity DESC, updated_at DESC LIMIT ?`;
    params.push(limit);
    const memories = db.prepare(sql).all(...params);
    return {
        filters: { sentiment, minIntensity, maxIntensity, emotionLabel },
        count: memories.length,
        memories: memories.map(m => ({
            id: m.id,
            content: m.content,
            type: m.type,
            sentiment: m.sentiment || 'neutral',
            emotionIntensity: m.emotion_intensity || 0,
            emotionLabels: JSON.parse(m.emotion_labels || '[]'),
            userMood: m.user_mood,
            confidence: m.confidence,
            createdAt: m.created_at
        }))
    };
}
/**
 * Get emotion statistics for a project
 */
function getEmotionStats(projectId) {
    const project = getEffectiveProject(projectId);
    // Sentiment distribution
    const sentimentCounts = db.prepare(`
    SELECT sentiment, COUNT(*) as count
    FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
    GROUP BY sentiment
  `).all(project);
    // Average intensity
    const avgIntensity = db.prepare(`
    SELECT AVG(emotion_intensity) as avg
    FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global') AND emotion_intensity > 0
  `).get(project);
    // Most common emotion labels
    const allLabels = db.prepare(`
    SELECT emotion_labels
    FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global') AND emotion_labels != '[]'
  `).all(project);
    const labelCounts = {};
    for (const row of allLabels) {
        const labels = JSON.parse(row.emotion_labels || '[]');
        for (const label of labels) {
            labelCounts[label] = (labelCounts[label] || 0) + 1;
        }
    }
    const topLabels = Object.entries(labelCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, count]) => ({ label, count }));
    // High intensity memories (emotional peaks)
    const emotionalPeaks = db.prepare(`
    SELECT id, content, sentiment, emotion_intensity, emotion_labels, created_at
    FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global') AND emotion_intensity >= 0.8
    ORDER BY emotion_intensity DESC
    LIMIT 10
  `).all(project);
    return {
        project_id: project,
        sentimentDistribution: Object.fromEntries(sentimentCounts.map(s => [s.sentiment || 'neutral', s.count])),
        averageIntensity: avgIntensity?.avg || 0,
        topEmotionLabels: topLabels,
        emotionalPeaks: emotionalPeaks.map(m => ({
            id: m.id,
            content: m.content.slice(0, 100) + (m.content.length > 100 ? '...' : ''),
            sentiment: m.sentiment,
            intensity: m.emotion_intensity,
            labels: JSON.parse(m.emotion_labels || '[]'),
            createdAt: m.created_at
        })),
        commonEmotions: [...COMMON_EMOTIONS]
    };
}
// ============================================================================
// Sleep Consolidation Functions
// ============================================================================
// Track last activity time for idle detection
let lastActivityTime = Date.now();
let consolidationTimer = null;
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of inactivity
const CONSOLIDATION_INTERVAL_MS = 10 * 60 * 1000; // Run consolidation every 10 minutes when idle
/**
 * Record activity to reset idle timer
 */
function recordActivity() {
    lastActivityTime = Date.now();
}
/**
 * Check if system is idle
 */
function isIdle() {
    return Date.now() - lastActivityTime > IDLE_THRESHOLD_MS;
}
/**
 * Find and merge similar memories (consolidation)
 */
function findSimilarMemories(projectId, similarityThreshold = 0.85, limit = 20) {
    const project = getEffectiveProject(projectId);
    // Get recent memories that might have duplicates
    const memories = db.prepare(`
    SELECT id, content, type, tags, importance, confidence, access_count, created_at
    FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
    ORDER BY created_at DESC
    LIMIT 100
  `).all(project);
    const similar = [];
    const checked = new Set();
    for (let i = 0; i < memories.length && similar.length < limit; i++) {
        for (let j = i + 1; j < memories.length && similar.length < limit; j++) {
            const key = `${memories[i].id}-${memories[j].id}`;
            if (checked.has(key))
                continue;
            checked.add(key);
            // Simple similarity check based on content overlap
            const a = memories[i].content.toLowerCase();
            const b = memories[j].content.toLowerCase();
            const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 3));
            const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 3));
            if (wordsA.size === 0 || wordsB.size === 0)
                continue;
            const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
            const union = new Set([...wordsA, ...wordsB]).size;
            const jaccard = intersection / union;
            if (jaccard >= similarityThreshold) {
                similar.push({
                    memory1: { id: memories[i].id, content: memories[i].content.slice(0, 100) },
                    memory2: { id: memories[j].id, content: memories[j].content.slice(0, 100) },
                    similarity: jaccard,
                    suggestion: 'consolidate'
                });
            }
        }
    }
    return similar;
}
/**
 * Strengthen frequently accessed memories
 */
function strengthenActiveMemories(projectId) {
    const project = getEffectiveProject(projectId);
    // Increase confidence for memories accessed more than average
    const avgAccess = db.prepare(`
    SELECT AVG(access_count) as avg FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
  `).get(project);
    const threshold = Math.max(avgAccess?.avg || 3, 3);
    const result = db.prepare(`
    UPDATE memories
    SET confidence = MIN(confidence + 0.05, 1.0),
        updated_at = datetime('now')
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND access_count > ?
      AND confidence < 0.95
  `).run(project, threshold);
    return result.changes;
}
/**
 * Apply memory decay to infrequently accessed memories
 */
function applyMemoryDecay(projectId) {
    const project = getEffectiveProject(projectId);
    // Decay memories not accessed in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const result = db.prepare(`
    UPDATE memories
    SET strength = MAX(strength - 0.1, 0.1),
        updated_at = datetime('now')
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND last_accessed < ?
      AND strength > 0.2
      AND importance < 0.8
  `).run(project, thirtyDaysAgo.toISOString());
    return result.changes;
}
/**
 * Clean up expired scratchpad entries
 */
function cleanExpiredScratchpad(projectId) {
    const project = getEffectiveProject(projectId);
    const result = db.prepare(`
    DELETE FROM scratchpad
    WHERE (project_id = ? OR project_id = 'global')
      AND expires_at IS NOT NULL
      AND expires_at < datetime('now')
  `).run(project);
    return result.changes;
}
/**
 * Run full consolidation cycle
 */
function runConsolidation(projectId) {
    const project = getEffectiveProject(projectId);
    const startTime = Date.now();
    const results = {
        project_id: project,
        started_at: new Date().toISOString(),
        idle_detected: isIdle(),
        strengthened: strengthenActiveMemories(project),
        decayed: applyMemoryDecay(project),
        scratchpad_cleaned: cleanExpiredScratchpad(project),
        similar_memories: findSimilarMemories(project, 0.85, 10),
        duration_ms: 0
    };
    results.duration_ms = Date.now() - startTime;
    // Log consolidation to memories for tracking
    db.prepare(`
    INSERT INTO memories (id, project_id, content, type, importance, confidence)
    VALUES (?, ?, ?, 'system', 0.2, 1.0)
  `).run(`consolidation_${Date.now()}`, project, JSON.stringify({
        type: 'consolidation_run',
        results: {
            strengthened: results.strengthened,
            decayed: results.decayed,
            cleaned: results.scratchpad_cleaned,
            similar_found: results.similar_memories.length
        }
    }));
    return results;
}
/**
 * Get consolidation status and history
 */
function getConsolidationStatus(projectId) {
    const project = getEffectiveProject(projectId);
    // Get recent consolidation runs
    const recentRuns = db.prepare(`
    SELECT content, created_at
    FROM memories
    WHERE type = 'system'
      AND content LIKE '%consolidation_run%'
      AND (project_id = ? OR project_id = 'global')
    ORDER BY created_at DESC
    LIMIT 10
  `).all(project);
    // Get memory health stats
    const healthStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN strength > 0.7 THEN 1 ELSE 0 END) as healthy,
      SUM(CASE WHEN strength BETWEEN 0.4 AND 0.7 THEN 1 ELSE 0 END) as moderate,
      SUM(CASE WHEN strength < 0.4 THEN 1 ELSE 0 END) as weak,
      AVG(strength) as avg_strength,
      AVG(confidence) as avg_confidence
    FROM memories
    WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
  `).get(project);
    // Get scratchpad stats
    const scratchStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN expires_at < datetime('now') THEN 1 ELSE 0 END) as expired,
      SUM(CASE WHEN expires_at IS NOT NULL AND expires_at < datetime('now', '+24 hours') THEN 1 ELSE 0 END) as expiring_soon
    FROM scratchpad
    WHERE project_id = ? OR project_id = 'global'
  `).get(project);
    return {
        project_id: project,
        is_idle: isIdle(),
        idle_for_ms: Date.now() - lastActivityTime,
        last_activity: new Date(lastActivityTime).toISOString(),
        health: {
            total_memories: healthStats?.total || 0,
            healthy: healthStats?.healthy || 0,
            moderate: healthStats?.moderate || 0,
            weak: healthStats?.weak || 0,
            avg_strength: healthStats?.avg_strength || 0,
            avg_confidence: healthStats?.avg_confidence || 0
        },
        scratchpad: {
            total: scratchStats?.total || 0,
            expired: scratchStats?.expired || 0,
            expiring_soon: scratchStats?.expiring_soon || 0
        },
        recent_consolidations: recentRuns.map(r => ({
            ...JSON.parse(r.content),
            ran_at: r.created_at
        })),
        similar_memories_preview: findSimilarMemories(project, 0.85, 5)
    };
}
/**
 * Start background consolidation timer
 */
function startConsolidationTimer() {
    if (consolidationTimer)
        return;
    consolidationTimer = setInterval(() => {
        if (isIdle()) {
            // Only run consolidation when idle
            runConsolidation();
        }
    }, CONSOLIDATION_INTERVAL_MS);
}
/**
 * Stop background consolidation timer
 */
function stopConsolidationTimer() {
    if (consolidationTimer) {
        clearInterval(consolidationTimer);
        consolidationTimer = null;
    }
}
// ============================================================================
// Counterfactual Reasoning Functions
// ============================================================================
/**
 * Create a causal relationship between two memories
 */
function createCausalRelationship(causeId, effectId, relationshipType = 'causes', strength = 0.7, confidence = 0.5, context, conditions, projectId) {
    const project = getEffectiveProject(projectId);
    const id = `causal_${(0, crypto_1.randomUUID)().slice(0, 8)}`;
    // Verify both memories exist
    const cause = db.prepare(`SELECT id, content FROM memories WHERE id = ? AND deleted_at IS NULL`).get(causeId);
    const effect = db.prepare(`SELECT id, content FROM memories WHERE id = ? AND deleted_at IS NULL`).get(effectId);
    if (!cause)
        return { error: 'Cause memory not found', causeId };
    if (!effect)
        return { error: 'Effect memory not found', effectId };
    db.prepare(`
    INSERT INTO causal_relationships (id, project_id, cause_id, effect_id, relationship_type, strength, confidence, context, conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, project, causeId, effectId, relationshipType, strength, confidence, context || null, JSON.stringify(conditions || []));
    return {
        id,
        cause: { id: causeId, content: cause.content.slice(0, 100) },
        effect: { id: effectId, content: effect.content.slice(0, 100) },
        relationshipType,
        strength,
        confidence,
        context,
        conditions: conditions || []
    };
}
/**
 * Get causal chain for a memory (what causes it and what it causes)
 */
function getCausalChain(memoryId, direction = 'both', depth = 3, projectId) {
    const project = getEffectiveProject(projectId);
    const visited = new Set();
    function traverseUpstream(id, currentDepth) {
        if (currentDepth >= depth || visited.has(id))
            return [];
        visited.add(id);
        const causes = db.prepare(`
      SELECT cr.*, m.content as cause_content
      FROM causal_relationships cr
      JOIN memories m ON cr.cause_id = m.id
      WHERE cr.effect_id = ? AND (cr.project_id = ? OR cr.project_id = 'global')
    `).all(id, project);
        return causes.map(c => ({
            id: c.id,
            cause: { id: c.cause_id, content: c.cause_content.slice(0, 100) },
            relationshipType: c.relationship_type,
            strength: c.strength,
            confidence: c.confidence,
            upstream: traverseUpstream(c.cause_id, currentDepth + 1)
        }));
    }
    function traverseDownstream(id, currentDepth) {
        if (currentDepth >= depth || visited.has(id))
            return [];
        visited.add(id);
        const effects = db.prepare(`
      SELECT cr.*, m.content as effect_content
      FROM causal_relationships cr
      JOIN memories m ON cr.effect_id = m.id
      WHERE cr.cause_id = ? AND (cr.project_id = ? OR cr.project_id = 'global')
    `).all(id, project);
        return effects.map(e => ({
            id: e.id,
            effect: { id: e.effect_id, content: e.effect_content.slice(0, 100) },
            relationshipType: e.relationship_type,
            strength: e.strength,
            confidence: e.confidence,
            downstream: traverseDownstream(e.effect_id, currentDepth + 1)
        }));
    }
    const memory = db.prepare(`SELECT id, content FROM memories WHERE id = ? AND deleted_at IS NULL`).get(memoryId);
    if (!memory)
        return { error: 'Memory not found', memoryId };
    return {
        memory: { id: memory.id, content: memory.content.slice(0, 100) },
        upstream: (direction === 'upstream' || direction === 'both') ? traverseUpstream(memoryId, 0) : [],
        downstream: (direction === 'downstream' || direction === 'both') ? traverseDownstream(memoryId, 0) : []
    };
}
/**
 * Create a "what if" alternative outcome
 */
function createAlternativeOutcome(causalId, alternativeCause, predictedOutcome, likelihood = 0.5, projectId) {
    const project = getEffectiveProject(projectId);
    const id = `alt_${(0, crypto_1.randomUUID)().slice(0, 8)}`;
    // Verify causal relationship exists
    const causal = db.prepare(`SELECT * FROM causal_relationships WHERE id = ?`).get(causalId);
    if (!causal)
        return { error: 'Causal relationship not found', causalId };
    db.prepare(`
    INSERT INTO alternative_outcomes (id, project_id, causal_id, alternative_cause, predicted_outcome, likelihood)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, project, causalId, alternativeCause, predictedOutcome, likelihood);
    return {
        id,
        causalId,
        alternativeCause,
        predictedOutcome,
        likelihood,
        original: {
            cause: causal.cause_id,
            effect: causal.effect_id
        }
    };
}
/**
 * Record actual outcome for an alternative (for learning)
 */
function recordActualOutcome(alternativeId, actualOutcome) {
    const alt = db.prepare(`SELECT * FROM alternative_outcomes WHERE id = ?`).get(alternativeId);
    if (!alt)
        return { error: 'Alternative not found', alternativeId };
    db.prepare(`
    UPDATE alternative_outcomes
    SET actual_outcome = ?, explored = 1
    WHERE id = ?
  `).run(actualOutcome, alternativeId);
    // Update the causal relationship's counterfactual_tested count
    db.prepare(`
    UPDATE causal_relationships
    SET counterfactual_tested = counterfactual_tested + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(alt.causal_id);
    return {
        alternativeId,
        predicted: alt.predicted_outcome,
        actual: actualOutcome,
        match: alt.predicted_outcome.toLowerCase().includes(actualOutcome.toLowerCase().slice(0, 20)) ||
            actualOutcome.toLowerCase().includes(alt.predicted_outcome.toLowerCase().slice(0, 20))
    };
}
/**
 * Ask "what if" question - find relevant causal relationships and alternatives
 */
function whatIf(query, projectId, limit = 10) {
    const project = getEffectiveProject(projectId);
    // Search for causal relationships with causes matching the query
    const causalMatches = db.prepare(`
    SELECT cr.*,
           mc.content as cause_content,
           me.content as effect_content
    FROM causal_relationships cr
    JOIN memories mc ON cr.cause_id = mc.id
    JOIN memories me ON cr.effect_id = me.id
    WHERE (cr.project_id = ? OR cr.project_id = 'global')
      AND (mc.content LIKE ? OR cr.context LIKE ?)
    ORDER BY cr.strength DESC, cr.confidence DESC
    LIMIT ?
  `).all(project, `%${sanitizeLikePattern(query)}%`, `%${sanitizeLikePattern(query)}%`, limit);
    // Get alternatives for matching causal relationships
    const results = causalMatches.map(cr => {
        const alternatives = db.prepare(`
      SELECT * FROM alternative_outcomes WHERE causal_id = ?
    `).all(cr.id);
        return {
            causal: {
                id: cr.id,
                cause: { id: cr.cause_id, content: cr.cause_content.slice(0, 150) },
                effect: { id: cr.effect_id, content: cr.effect_content.slice(0, 150) },
                relationshipType: cr.relationship_type,
                strength: cr.strength,
                confidence: cr.confidence,
                context: cr.context,
                conditions: JSON.parse(cr.conditions || '[]')
            },
            alternatives: alternatives.map(a => ({
                id: a.id,
                alternativeCause: a.alternative_cause,
                predictedOutcome: a.predicted_outcome,
                actualOutcome: a.actual_outcome,
                likelihood: a.likelihood,
                explored: a.explored === 1
            })),
            counterfactualsTested: cr.counterfactual_tested
        };
    });
    return {
        query,
        matchCount: results.length,
        results,
        suggestions: results.length === 0 ? [
            'Try creating causal relationships with memory_create_causal first',
            'Use broader search terms',
            'Check if relevant memories exist'
        ] : []
    };
}
/**
 * Get counterfactual statistics
 */
function getCounterfactualStats(projectId) {
    const project = getEffectiveProject(projectId);
    const causalCount = db.prepare(`
    SELECT COUNT(*) as count FROM causal_relationships
    WHERE project_id = ? OR project_id = 'global'
  `).get(project);
    const altCount = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN explored = 1 THEN 1 ELSE 0 END) as explored
    FROM alternative_outcomes
    WHERE project_id = ? OR project_id = 'global'
  `).get(project);
    const avgStrength = db.prepare(`
    SELECT AVG(strength) as avg_strength, AVG(confidence) as avg_confidence
    FROM causal_relationships
    WHERE project_id = ? OR project_id = 'global'
  `).get(project);
    const topCauses = db.prepare(`
    SELECT cause_id, COUNT(*) as effect_count, m.content
    FROM causal_relationships cr
    JOIN memories m ON cr.cause_id = m.id
    WHERE cr.project_id = ? OR cr.project_id = 'global'
    GROUP BY cause_id
    ORDER BY effect_count DESC
    LIMIT 10
  `).all(project);
    return {
        project_id: project,
        causal_relationships: causalCount?.count || 0,
        alternatives: {
            total: altCount?.total || 0,
            explored: altCount?.explored || 0
        },
        average_strength: avgStrength?.avg_strength || 0,
        average_confidence: avgStrength?.avg_confidence || 0,
        top_causes: topCauses.map(c => ({
            id: c.cause_id,
            content: c.content.slice(0, 100),
            effect_count: c.effect_count
        }))
    };
}
// ============================================================================
// Scheduled Tasks Functions
// ============================================================================
// Natural language time patterns
const TIME_PATTERNS = [
    // "in X minutes/hours/days"
    {
        pattern: /in\s+(\d+)\s+(minute|minutes|min|mins?|hour|hours|hr|hrs?|day|days?|week|weeks?)/i,
        handler: (match) => {
            const amount = parseInt(match[1]);
            const unit = match[2].toLowerCase();
            const now = new Date();
            if (unit.startsWith('min'))
                now.setMinutes(now.getMinutes() + amount);
            else if (unit.startsWith('hour') || unit.startsWith('hr'))
                now.setHours(now.getHours() + amount);
            else if (unit.startsWith('day'))
                now.setDate(now.getDate() + amount);
            else if (unit.startsWith('week'))
                now.setDate(now.getDate() + amount * 7);
            return now;
        }
    },
    // "tomorrow at HH:MM" or "tomorrow at H pm/am"
    {
        pattern: /tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
        handler: (match) => {
            const now = new Date();
            now.setDate(now.getDate() + 1);
            let hour = parseInt(match[1]);
            const minute = match[2] ? parseInt(match[2]) : 0;
            const ampm = match[3]?.toLowerCase();
            if (ampm === 'pm' && hour !== 12)
                hour += 12;
            if (ampm === 'am' && hour === 12)
                hour = 0;
            now.setHours(hour, minute, 0, 0);
            return now;
        }
    },
    // "at HH:MM" or "at H pm/am" (same day or next day if past)
    {
        pattern: /(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
        handler: (match) => {
            const now = new Date();
            let hour = parseInt(match[1]);
            const minute = match[2] ? parseInt(match[2]) : 0;
            const ampm = match[3].toLowerCase();
            if (ampm === 'pm' && hour !== 12)
                hour += 12;
            if (ampm === 'am' && hour === 12)
                hour = 0;
            now.setHours(hour, minute, 0, 0);
            if (now <= new Date())
                now.setDate(now.getDate() + 1);
            return now;
        }
    },
    // "next monday/tuesday/etc"
    {
        pattern: /next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
        handler: (match) => {
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const targetDay = days.indexOf(match[1].toLowerCase());
            const now = new Date();
            const currentDay = now.getDay();
            let daysUntil = targetDay - currentDay;
            if (daysUntil <= 0)
                daysUntil += 7;
            now.setDate(now.getDate() + daysUntil);
            now.setHours(9, 0, 0, 0); // Default to 9 AM
            return now;
        }
    },
    // "end of day" / "tonight"
    {
        pattern: /(end of day|tonight|eod)/i,
        handler: () => {
            const now = new Date();
            now.setHours(18, 0, 0, 0);
            if (now <= new Date())
                now.setDate(now.getDate() + 1);
            return now;
        }
    },
    // "end of week"
    {
        pattern: /end of week|eow/i,
        handler: () => {
            const now = new Date();
            const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
            now.setDate(now.getDate() + daysUntilFriday);
            now.setHours(17, 0, 0, 0);
            return now;
        }
    }
];
/**
 * Parse natural language time expression
 */
function parseNaturalTime(expression) {
    for (const { pattern, handler } of TIME_PATTERNS) {
        const match = expression.match(pattern);
        if (match) {
            return handler(match);
        }
    }
    // Try parsing as ISO date
    const parsed = new Date(expression);
    if (!isNaN(parsed.getTime()))
        return parsed;
    return null;
}
/**
 * Parse cron expression to get next run time
 * Simplified cron: minute hour day month dayOfWeek
 */
function getNextCronRun(cronExpr, from = new Date()) {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5)
        return null;
    const [minuteExpr, hourExpr, dayExpr, monthExpr, dowExpr] = parts;
    // Simple implementation for common cases
    const parseField = (expr, min, max) => {
        if (expr === '*')
            return Array.from({ length: max - min + 1 }, (_, i) => min + i);
        if (expr.includes('/')) {
            const [, step] = expr.split('/');
            return Array.from({ length: Math.ceil((max - min + 1) / parseInt(step)) }, (_, i) => min + i * parseInt(step));
        }
        if (expr.includes(','))
            return expr.split(',').map(n => parseInt(n));
        return [parseInt(expr)];
    };
    const minutes = parseField(minuteExpr, 0, 59);
    const hours = parseField(hourExpr, 0, 23);
    const days = parseField(dayExpr, 1, 31);
    const months = parseField(monthExpr, 1, 12);
    const dows = parseField(dowExpr, 0, 6);
    // Find next matching time (simple forward search, max 1 year)
    const candidate = new Date(from);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);
    for (let i = 0; i < 525600; i++) { // Max 1 year of minutes
        if (minutes.includes(candidate.getMinutes()) &&
            hours.includes(candidate.getHours()) &&
            (dayExpr === '*' || days.includes(candidate.getDate())) &&
            (monthExpr === '*' || months.includes(candidate.getMonth() + 1)) &&
            (dowExpr === '*' || dows.includes(candidate.getDay()))) {
            return candidate;
        }
        candidate.setMinutes(candidate.getMinutes() + 1);
    }
    return null;
}
/**
 * Create a scheduled task
 */
function createScheduledTask(title, scheduleExpr, description, recurring = false, actionType = 'reminder', actionData, memoryId, projectId) {
    const project = getEffectiveProject(projectId);
    const id = `task_${(0, crypto_1.randomUUID)().slice(0, 8)}`;
    // Determine if it's a cron expression or natural language
    let nextRun = null;
    let cronExpression = null;
    if (/^\d|\*/.test(scheduleExpr.trim()) && scheduleExpr.split(/\s+/).length === 5) {
        // Looks like a cron expression
        cronExpression = scheduleExpr;
        nextRun = getNextCronRun(scheduleExpr);
    }
    else {
        // Try natural language
        nextRun = parseNaturalTime(scheduleExpr);
    }
    if (!nextRun) {
        return { error: 'Could not parse schedule expression', scheduleExpr, hint: 'Try "in 30 minutes", "tomorrow at 3pm", or cron format "0 9 * * 1-5"' };
    }
    db.prepare(`
    INSERT INTO scheduled_tasks (id, project_id, title, description, cron_expression, next_run, recurring, action_type, action_data, memory_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, project, title, description || null, cronExpression, nextRun.toISOString(), recurring ? 1 : 0, actionType, JSON.stringify(actionData || {}), memoryId || null);
    return {
        id,
        title,
        description,
        schedule: cronExpression || scheduleExpr,
        nextRun: nextRun.toISOString(),
        recurring,
        actionType
    };
}
/**
 * List scheduled tasks
 */
function listScheduledTasks(status, projectId, limit = 50) {
    const project = getEffectiveProject(projectId);
    let sql = `SELECT * FROM scheduled_tasks WHERE (project_id = ? OR project_id = 'global')`;
    const params = [project];
    if (status) {
        sql += ` AND status = ?`;
        params.push(status);
    }
    sql += ` ORDER BY next_run ASC LIMIT ?`;
    params.push(limit);
    const tasks = db.prepare(sql).all(...params);
    return {
        count: tasks.length,
        tasks: tasks.map(t => ({
            id: t.id,
            title: t.title,
            description: t.description,
            cronExpression: t.cron_expression,
            nextRun: t.next_run,
            lastRun: t.last_run,
            status: t.status,
            recurring: t.recurring === 1,
            actionType: t.action_type,
            memoryId: t.memory_id
        }))
    };
}
/**
 * Check and trigger due tasks
 */
function checkDueTasks(projectId) {
    const project = getEffectiveProject(projectId);
    const now = new Date().toISOString();
    // Find due tasks
    const dueTasks = db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE (project_id = ? OR project_id = 'global')
      AND status = 'pending'
      AND next_run <= ?
  `).all(project, now);
    const triggered = [];
    for (const task of dueTasks) {
        // Update status
        if (task.recurring && task.cron_expression) {
            // Recurring task - calculate next run
            const nextRun = getNextCronRun(task.cron_expression, new Date());
            db.prepare(`
        UPDATE scheduled_tasks
        SET status = 'pending', last_run = ?, next_run = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(now, nextRun?.toISOString(), task.id);
        }
        else {
            // One-time task - mark as triggered
            db.prepare(`
        UPDATE scheduled_tasks
        SET status = 'triggered', last_run = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(now, task.id);
        }
        triggered.push({
            id: task.id,
            title: task.title,
            description: task.description,
            actionType: task.action_type,
            actionData: JSON.parse(task.action_data || '{}'),
            memoryId: task.memory_id,
            wasRecurring: task.recurring === 1
        });
    }
    return {
        checked_at: now,
        triggered_count: triggered.length,
        triggered
    };
}
/**
 * Complete a triggered task
 */
function completeScheduledTask(taskId) {
    const task = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(taskId);
    if (!task)
        return { error: 'Task not found', taskId };
    if (task.status !== 'triggered') {
        return { error: 'Task is not in triggered state', taskId, currentStatus: task.status };
    }
    db.prepare(`
    UPDATE scheduled_tasks
    SET status = 'completed', updated_at = datetime('now')
    WHERE id = ?
  `).run(taskId);
    return {
        taskId,
        title: task.title,
        status: 'completed',
        completedAt: new Date().toISOString()
    };
}
/**
 * Cancel a scheduled task
 */
function cancelScheduledTask(taskId) {
    const task = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(taskId);
    if (!task)
        return { error: 'Task not found', taskId };
    db.prepare(`
    UPDATE scheduled_tasks
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE id = ?
  `).run(taskId);
    return {
        taskId,
        title: task.title,
        status: 'cancelled',
        cancelledAt: new Date().toISOString()
    };
}
/**
 * Reschedule a task
 */
function rescheduleTask(taskId, newSchedule) {
    const task = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(taskId);
    if (!task)
        return { error: 'Task not found', taskId };
    // Parse new schedule
    let nextRun = null;
    let cronExpression = null;
    if (/^\d|\*/.test(newSchedule.trim()) && newSchedule.split(/\s+/).length === 5) {
        cronExpression = newSchedule;
        nextRun = getNextCronRun(newSchedule);
    }
    else {
        nextRun = parseNaturalTime(newSchedule);
    }
    if (!nextRun) {
        return { error: 'Could not parse schedule expression', newSchedule };
    }
    db.prepare(`
    UPDATE scheduled_tasks
    SET next_run = ?, cron_expression = ?, status = 'pending', updated_at = datetime('now')
    WHERE id = ?
  `).run(nextRun.toISOString(), cronExpression, taskId);
    return {
        taskId,
        title: task.title,
        newSchedule: cronExpression || newSchedule,
        nextRun: nextRun.toISOString(),
        status: 'pending'
    };
}
// ============================================================================
// Enhanced Contradiction Engine Functions
// ============================================================================
// Temporal patterns for detecting time references
const TEMPORAL_PATTERNS = [
    /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/, // 2024-01-15
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\b/i,
    /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december))(?:,?\s*\d{4})?\b/i,
    /\b(yesterday|today|tomorrow|last\s+(?:week|month|year)|next\s+(?:week|month|year))\b/i,
    /\b(in\s+\d{4}|since\s+\d{4}|before\s+\d{4}|after\s+\d{4})\b/i,
    /\b(\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\b/i
];
// Time expression patterns that could conflict
const TIME_KEYWORDS = ['always', 'never', 'every time', 'sometimes', 'usually', 'rarely', 'once', 'twice', 'daily', 'weekly', 'monthly', 'yearly'];
/**
 * Extract temporal references from text
 */
function extractTemporalReferences(text) {
    const refs = [];
    for (const pattern of TEMPORAL_PATTERNS) {
        const match = text.match(pattern);
        if (match)
            refs.push(match[1]);
    }
    // Also extract time keywords
    for (const keyword of TIME_KEYWORDS) {
        if (text.toLowerCase().includes(keyword)) {
            refs.push(keyword);
        }
    }
    return refs;
}
/**
 * Check if two temporal references are potentially contradictory
 */
function temporalRefsConflict(refs1, refs2) {
    // Check for absolute date conflicts (same subject, different dates)
    const dates1 = refs1.filter(r => /\d{4}|\d{1,2}[-/]/.test(r));
    const dates2 = refs2.filter(r => /\d{4}|\d{1,2}[-/]/.test(r));
    if (dates1.length > 0 && dates2.length > 0) {
        // If both have dates but they're different, potential conflict
        if (dates1[0] !== dates2[0]) {
            return { conflict: true, reason: `Different dates: "${dates1[0]}" vs "${dates2[0]}"` };
        }
    }
    // Check for frequency conflicts
    const always = ['always', 'every time', 'never'];
    const sometimes = ['sometimes', 'usually', 'rarely', 'occasionally'];
    const has1Always = refs1.some(r => always.includes(r.toLowerCase()));
    const has2Always = refs2.some(r => always.includes(r.toLowerCase()));
    const has1Sometimes = refs1.some(r => sometimes.includes(r.toLowerCase()));
    const has2Sometimes = refs2.some(r => sometimes.includes(r.toLowerCase()));
    if (has1Always && has2Sometimes) {
        return { conflict: true, reason: `Frequency conflict: absolute vs conditional statements` };
    }
    if (has2Always && has1Sometimes) {
        return { conflict: true, reason: `Frequency conflict: absolute vs conditional statements` };
    }
    return { conflict: false };
}
/**
 * Get pending contradiction resolutions
 */
function getPendingResolutions(projectId, limit = 20) {
    const project = getEffectiveProject(projectId);
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
  `).all(project, limit);
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
 * Create a contradiction resolution request
 */
function createResolutionRequest(memoryId1, memoryId2, projectId) {
    const project = getEffectiveProject(projectId);
    // Check both memories exist
    const m1 = db.prepare(`SELECT id, content FROM memories WHERE id = ? AND deleted_at IS NULL`).get(memoryId1);
    const m2 = db.prepare(`SELECT id, content FROM memories WHERE id = ? AND deleted_at IS NULL`).get(memoryId2);
    if (!m1)
        return { error: 'Memory 1 not found', memoryId1 };
    if (!m2)
        return { error: 'Memory 2 not found', memoryId2 };
    // Check if resolution already exists
    const existing = db.prepare(`
    SELECT id FROM contradiction_resolutions
    WHERE (memory_id_1 = ? AND memory_id_2 = ?) OR (memory_id_1 = ? AND memory_id_2 = ?)
  `).get(memoryId1, memoryId2, memoryId2, memoryId1);
    if (existing) {
        return { error: 'Resolution already exists', resolutionId: existing.id };
    }
    const id = `res_${(0, crypto_1.randomUUID)().slice(0, 8)}`;
    db.prepare(`
    INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(id, project, memoryId1, memoryId2);
    return {
        id,
        memory1: { id: memoryId1, content: m1.content.slice(0, 150) },
        memory2: { id: memoryId2, content: m2.content.slice(0, 150) },
        status: 'pending'
    };
}
/**
 * Resolve a contradiction
 */
function resolveContradiction(resolutionId, resolutionType, note, mergedContent) {
    const resolution = db.prepare(`SELECT * FROM contradiction_resolutions WHERE id = ?`).get(resolutionId);
    if (!resolution)
        return { error: 'Resolution not found', resolutionId };
    let chosenMemory = null;
    switch (resolutionType) {
        case 'keep_first':
            chosenMemory = resolution.memory_id_1;
            // Deprecate second memory
            db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`).run(resolution.memory_id_2);
            break;
        case 'keep_second':
            chosenMemory = resolution.memory_id_2;
            // Deprecate first memory
            db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`).run(resolution.memory_id_1);
            break;
        case 'keep_both':
            // Just mark as resolved, both memories remain
            break;
        case 'merge':
            if (!mergedContent) {
                return { error: 'Merged content required for merge resolution' };
            }
            // Create new merged memory
            const mergedId = (0, crypto_1.randomUUID)().replace(/-/g, '');
            const m1 = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(resolution.memory_id_1);
            db.prepare(`
        INSERT INTO memories (id, project_id, content, type, tags, importance, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(mergedId, m1.project_id, mergedContent, m1.type, m1.tags, m1.importance, Math.max(m1.confidence, 0.7));
            // Deprecate both originals
            db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id IN (?, ?)`).run(resolution.memory_id_1, resolution.memory_id_2);
            chosenMemory = mergedId;
            break;
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
    return {
        resolutionId,
        resolutionType,
        chosenMemory,
        note,
        resolved_at: new Date().toISOString()
    };
}
/**
 * Scan for unresolved contradictions
 */
function scanContradictions(projectId, autoCreateResolutions = true) {
    const project = getEffectiveProject(projectId);
    // Get all contradiction edges that don't have resolutions
    const edges = db.prepare(`
    SELECT e.*, m1.content as from_content, m2.content as to_content
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
  `).all(project);
    const newResolutions = [];
    if (autoCreateResolutions) {
        for (const edge of edges) {
            const id = `res_${(0, crypto_1.randomUUID)().slice(0, 8)}`;
            db.prepare(`
        INSERT INTO contradiction_resolutions (id, project_id, memory_id_1, memory_id_2, resolution_type)
        VALUES (?, ?, ?, ?, 'pending')
      `).run(id, project, edge.from_id, edge.to_id);
            newResolutions.push({ id, memory_id_1: edge.from_id, memory_id_2: edge.to_id });
        }
    }
    return {
        project_id: project,
        unresolved_count: edges.length,
        new_resolutions_created: newResolutions.length,
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
/**
 * Get contradiction statistics
 */
function getContradictionStats(projectId) {
    const project = getEffectiveProject(projectId);
    // Count by type
    const byType = db.prepare(`
    SELECT
      REPLACE(relation_type, 'contradiction_', '') as type,
      COUNT(*) as count
    FROM edges
    WHERE relation_type LIKE 'contradiction_%'
      AND (project_id = ? OR project_id = 'global')
    GROUP BY relation_type
  `).all(project);
    // Resolution stats
    const resolutions = db.prepare(`
    SELECT resolution_type, COUNT(*) as count
    FROM contradiction_resolutions
    WHERE project_id = ? OR project_id = 'global'
    GROUP BY resolution_type
  `).all(project);
    // Most contradicted memories
    const mostContradicted = db.prepare(`
    SELECT id, content, contradiction_count
    FROM memories
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND contradiction_count > 0
    ORDER BY contradiction_count DESC
    LIMIT 10
  `).all(project);
    return {
        project_id: project,
        by_type: Object.fromEntries(byType.map(t => [t.type, t.count])),
        resolutions: Object.fromEntries(resolutions.map(r => [r.resolution_type, r.count])),
        most_contradicted: mostContradicted.map(m => ({
            id: m.id,
            content: m.content.slice(0, 100),
            contradiction_count: m.contradiction_count
        }))
    };
}
/**
 * Auto-deprecate low-confidence contradicted memories
 */
function autoDeprecateContradicted(confidenceThreshold = 0.2, minContradictions = 3, projectId) {
    const project = getEffectiveProject(projectId);
    const toDeprecate = db.prepare(`
    SELECT id, content, confidence, contradiction_count
    FROM memories
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND confidence < ?
      AND contradiction_count >= ?
  `).all(project, confidenceThreshold, minContradictions);
    // Deprecate these memories
    for (const m of toDeprecate) {
        db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`).run(m.id);
    }
    return {
        project_id: project,
        deprecated_count: toDeprecate.length,
        deprecated: toDeprecate.map(m => ({
            id: m.id,
            content: m.content.slice(0, 100),
            confidence: m.confidence,
            contradiction_count: m.contradiction_count
        }))
    };
}
// ============================================================================
// Intent Prediction Functions
// ============================================================================
// Common intent patterns
const INTENT_PATTERNS = [
    { type: 'learning', keywords: ['learn', 'understand', 'study', 'research', 'explore', 'how does', 'what is', 'explain'] },
    { type: 'planning', keywords: ['plan', 'schedule', 'organize', 'todo', 'task', 'goal', 'milestone', 'deadline'] },
    { type: 'debugging', keywords: ['error', 'bug', 'fix', 'issue', 'problem', 'crash', 'fail', 'broken'] },
    { type: 'building', keywords: ['create', 'build', 'implement', 'develop', 'code', 'feature', 'component'] },
    { type: 'reviewing', keywords: ['review', 'check', 'verify', 'test', 'validate', 'audit', 'inspect'] },
    { type: 'documenting', keywords: ['document', 'write', 'describe', 'explain', 'note', 'record'] },
    { type: 'searching', keywords: ['find', 'search', 'look for', 'where', 'locate', 'discover'] },
    { type: 'comparing', keywords: ['compare', 'difference', 'versus', 'vs', 'better', 'alternative'] },
    { type: 'deciding', keywords: ['decide', 'choose', 'select', 'option', 'should', 'recommend'] },
    { type: 'refactoring', keywords: ['refactor', 'clean', 'improve', 'optimize', 'simplify', 'restructure'] }
];
/**
 * Detect intent from text
 */
function detectIntentFromText(text) {
    const textLower = text.toLowerCase();
    const results = [];
    for (const pattern of INTENT_PATTERNS) {
        const matchedKeywords = pattern.keywords.filter(k => textLower.includes(k));
        if (matchedKeywords.length > 0) {
            results.push({
                type: pattern.type,
                confidence: Math.min(0.9, 0.3 + matchedKeywords.length * 0.15),
                keywords: matchedKeywords
            });
        }
    }
    return results.sort((a, b) => b.confidence - a.confidence);
}
/**
 * Record an intent signal
 */
function recordIntentSignal(signalType, signalData, intentId, projectId) {
    const project = getEffectiveProject(projectId);
    const id = `sig_${(0, crypto_1.randomUUID)().slice(0, 8)}`;
    db.prepare(`
    INSERT INTO intent_signals (id, project_id, intent_id, signal_type, signal_data, strength)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, project, intentId || null, signalType, JSON.stringify(signalData), signalData.strength || 0.5);
    return { id, signalType, recorded: true };
}
/**
 * Analyze access patterns to infer intent
 */
function inferIntentFromPatterns(projectId) {
    const project = getEffectiveProject(projectId);
    // Get recent memory accesses
    const recentAccesses = db.prepare(`
    SELECT m.content, m.type, m.tags, s.context, s.accessed_at
    FROM memory_access_sequences s
    JOIN memories m ON m.id = ANY(SELECT value FROM json_each(s.memory_ids))
    WHERE s.project_id = ? OR s.project_id = 'global'
    ORDER BY s.accessed_at DESC
    LIMIT 50
  `).all(project);
    // Combine all accessed content
    const combinedText = recentAccesses.map(a => `${a.content || ''} ${a.context || ''}`).join(' ');
    // Detect intents
    const detectedIntents = detectIntentFromText(combinedText);
    // Get recent memory types accessed
    const typeDistribution = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM memories
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND last_accessed > datetime('now', '-7 days')
    GROUP BY type
    ORDER BY count DESC
    LIMIT 5
  `).all(project);
    // Get recent tags
    const recentTags = db.prepare(`
    SELECT tags FROM memories
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND last_accessed > datetime('now', '-7 days')
  `).all(project);
    const tagCounts = {};
    for (const m of recentTags) {
        const tags = JSON.parse(m.tags || '[]');
        for (const tag of tags) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
    }
    const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));
    return {
        project_id: project,
        inferred_intents: detectedIntents.slice(0, 5),
        type_focus: typeDistribution,
        tag_focus: topTags,
        analysis_time: new Date().toISOString()
    };
}
/**
 * Create or update an intent
 */
function createIntent(intentType, description, contextKeywords = [], relatedMemories = [], confidence = 0.5, projectId) {
    const project = getEffectiveProject(projectId);
    const id = `intent_${(0, crypto_1.randomUUID)().slice(0, 8)}`;
    db.prepare(`
    INSERT INTO user_intents (id, project_id, intent_type, description, confidence, context_keywords, related_memories)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, project, intentType, description, confidence, JSON.stringify(contextKeywords), JSON.stringify(relatedMemories));
    return {
        id,
        intentType,
        description,
        contextKeywords,
        relatedMemories,
        confidence
    };
}
/**
 * Get active intents
 */
function getActiveIntents(projectId, limit = 20) {
    const project = getEffectiveProject(projectId);
    const intents = db.prepare(`
    SELECT * FROM user_intents
    WHERE status = 'active'
      AND (project_id = ? OR project_id = 'global')
    ORDER BY confidence DESC, last_observed DESC
    LIMIT ?
  `).all(project, limit);
    return {
        count: intents.length,
        intents: intents.map(i => ({
            id: i.id,
            type: i.intent_type,
            description: i.description,
            confidence: i.confidence,
            contextKeywords: JSON.parse(i.context_keywords || '[]'),
            relatedMemories: JSON.parse(i.related_memories || '[]'),
            lastObserved: i.last_observed
        }))
    };
}
/**
 * Suggest memories based on current intent
 */
function suggestForIntent(intentType, context, projectId, limit = 10) {
    const project = getEffectiveProject(projectId);
    // Get keywords for this intent type
    const intentPattern = INTENT_PATTERNS.find(p => p.type === intentType);
    const keywords = intentPattern?.keywords || [];
    // Build search query
    let sql = `
    SELECT m.*, 0 as relevance_score
    FROM memories m
    WHERE m.deleted_at IS NULL
      AND (m.project_id = ? OR m.project_id = 'global')
  `;
    const params = [project];
    // Add keyword matching
    if (keywords.length > 0) {
        const keywordConditions = keywords.map(() => `m.content LIKE ?`).join(' OR ');
        sql = `
      SELECT m.*,
        (${keywords.map(() => `CASE WHEN m.content LIKE ? THEN 1 ELSE 0 END`).join(' + ')}) as relevance_score
      FROM memories m
      WHERE m.deleted_at IS NULL
        AND (m.project_id = ? OR m.project_id = 'global')
        AND (${keywordConditions})
    `;
        // Add params for relevance score calculation
        for (const k of keywords) {
            params.unshift(`%${sanitizeLikePattern(k)}%`);
        }
        // Add params for WHERE clause
        for (const k of keywords) {
            params.push(`%${sanitizeLikePattern(k)}%`);
        }
    }
    // Add context matching if provided
    if (context) {
        sql += ` AND m.content LIKE ?`;
        params.push(`%${sanitizeLikePattern(context)}%`);
    }
    sql += ` ORDER BY relevance_score DESC, m.confidence DESC, m.last_accessed DESC LIMIT ?`;
    params.push(limit);
    const memories = db.prepare(sql).all(...params);
    return {
        intentType,
        context,
        suggestions: memories.map(m => ({
            id: m.id,
            content: m.content.slice(0, 200),
            type: m.type,
            relevance: m.relevance_score || 0,
            confidence: m.confidence
        }))
    };
}
/**
 * Complete an intent (mark as resolved)
 */
function completeIntent(intentId) {
    const intent = db.prepare(`SELECT * FROM user_intents WHERE id = ?`).get(intentId);
    if (!intent)
        return { error: 'Intent not found', intentId };
    db.prepare(`
    UPDATE user_intents
    SET status = 'completed'
    WHERE id = ?
  `).run(intentId);
    return {
        intentId,
        type: intent.intent_type,
        status: 'completed'
    };
}
/**
 * Get intent prediction based on current context
 */
function predictIntent(contextText, projectId) {
    const project = getEffectiveProject(projectId);
    // Detect intents from context
    const detectedIntents = detectIntentFromText(contextText);
    // Get existing intents that match
    const matchingIntents = [];
    for (const detected of detectedIntents.slice(0, 3)) {
        const existing = db.prepare(`
      SELECT * FROM user_intents
      WHERE intent_type = ?
        AND status = 'active'
        AND (project_id = ? OR project_id = 'global')
      ORDER BY confidence DESC
      LIMIT 1
    `).get(detected.type, project);
        if (existing) {
            matchingIntents.push({
                ...detected,
                existingIntent: {
                    id: existing.id,
                    description: existing.description
                }
            });
        }
        else {
            matchingIntents.push(detected);
        }
    }
    // Get suggested memories for top intent
    let suggestions = [];
    if (detectedIntents.length > 0) {
        const topIntent = detectedIntents[0];
        const suggestResult = suggestForIntent(topIntent.type, contextText, project, 5);
        suggestions = suggestResult.suggestions;
    }
    return {
        context: contextText.slice(0, 200),
        predictions: matchingIntents,
        suggested_memories: suggestions,
        recommendation: detectedIntents.length > 0
            ? `Based on your context, you appear to be ${detectedIntents[0].type}. ${suggestions.length > 0 ? 'Here are some relevant memories.' : ''}`
            : 'Unable to determine intent from context.'
    };
}
// ============================================================================
// Backup/Restore Functions
// ============================================================================
function backupMemories(projectId) {
    const project = getEffectiveProject(projectId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${project}_${timestamp}.json`;
    const filepath = (0, path_1.join)(BACKUP_DIR, filename);
    const memories = db.prepare('SELECT id, project_id, content, type, tags, importance, confidence, source_count, contradiction_count, created_at FROM memories WHERE deleted_at IS NULL AND (project_id = ? OR project_id = \'global\')').all(project);
    const entities = db.prepare('SELECT * FROM entities WHERE project_id = ? OR project_id = \'global\'').all(project);
    const relations = db.prepare('SELECT * FROM entity_relations WHERE project_id = ? OR project_id = \'global\'').all(project);
    const edges = db.prepare('SELECT id, project_id, from_id, to_id, relation_type, confidence, metadata, valid_from, valid_to FROM edges WHERE project_id = ? OR project_id = \'global\'').all(project);
    const backup = {
        version: '2.1',
        project_id: project,
        created_at: new Date().toISOString(),
        counts: {
            memories: memories.length,
            entities: entities.length,
            relations: relations.length,
            edges: edges.length
        },
        data: { memories, entities, relations, edges }
    };
    (0, fs_1.writeFileSync)(filepath, JSON.stringify(backup, null, 2));
    // Cleanup old backups (keep last 10)
    const cleanup = cleanupOldBackups(10);
    return { filename, filepath, counts: backup.counts, cleanup };
}
function restoreMemories(backupPath, mode = 'merge', targetProject) {
    if (!(0, fs_1.existsSync)(backupPath)) {
        return { error: 'Backup file not found', path: backupPath };
    }
    const backup = JSON.parse((0, fs_1.readFileSync)(backupPath, 'utf-8'));
    const project = targetProject || backup.project_id || currentProjectId;
    let restored = { memories: 0, entities: 0, relations: 0, edges: 0 };
    if (mode === 'replace') {
        db.prepare('DELETE FROM memories WHERE project_id = ?').run(project);
        db.prepare('DELETE FROM entities WHERE project_id = ?').run(project);
        db.prepare('DELETE FROM entity_relations WHERE project_id = ?').run(project);
        db.prepare('DELETE FROM edges WHERE project_id = ?').run(project);
    }
    const insertMemory = db.prepare(`INSERT OR ${mode === 'merge' ? 'IGNORE' : 'REPLACE'} INTO memories (id, project_id, content, type, tags, importance, confidence, source_count, contradiction_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertEntity = db.prepare(`INSERT OR ${mode === 'merge' ? 'IGNORE' : 'REPLACE'} INTO entities (id, project_id, name, entity_type, observations, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const insertRelation = db.prepare(`INSERT OR IGNORE INTO entity_relations (id, project_id, from_entity, to_entity, relation_type) VALUES (?, ?, ?, ?, ?)`);
    const insertEdge = db.prepare(`INSERT OR ${mode === 'merge' ? 'IGNORE' : 'REPLACE'} INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const m of backup.data.memories || []) {
        try {
            insertMemory.run(m.id, project, m.content, m.type, m.tags, m.importance, m.confidence, m.source_count, m.contradiction_count, m.created_at);
            restored.memories++;
        }
        catch { }
    }
    for (const e of backup.data.entities || []) {
        try {
            insertEntity.run(e.id, project, e.name, e.entity_type, e.observations, e.created_at);
            restored.entities++;
        }
        catch { }
    }
    for (const r of backup.data.relations || []) {
        try {
            insertRelation.run(r.id, project, r.from_entity, r.to_entity, r.relation_type);
            restored.relations++;
        }
        catch { }
    }
    for (const e of backup.data.edges || []) {
        try {
            insertEdge.run(e.id, project, e.from_id, e.to_id, e.relation_type, e.confidence, e.metadata, e.valid_from, e.valid_to);
            restored.edges++;
        }
        catch { }
    }
    return { restored, project_id: project, mode };
}
function listBackups() {
    if (!(0, fs_1.existsSync)(BACKUP_DIR))
        return { backups: [] };
    const files = (0, fs_1.readdirSync)(BACKUP_DIR).filter(f => f.endsWith('.json'));
    const backups = files.map(f => {
        const filepath = (0, path_1.join)(BACKUP_DIR, f);
        const stats = (0, fs_1.statSync)(filepath);
        return {
            filename: f,
            filepath,
            size: stats.size,
            created: stats.birthtime.toISOString()
        };
    }).sort((a, b) => b.created.localeCompare(a.created));
    return { backups, directory: BACKUP_DIR };
}
function cleanupOldBackups(keepCount = 10) {
    if (!(0, fs_1.existsSync)(BACKUP_DIR))
        return { removed: [], kept: 0 };
    const files = (0, fs_1.readdirSync)(BACKUP_DIR)
        .filter(f => f.endsWith('.json') && f.startsWith('backup_'))
        .map(f => ({
        filename: f,
        filepath: (0, path_1.join)(BACKUP_DIR, f),
        mtime: (0, fs_1.statSync)((0, path_1.join)(BACKUP_DIR, f)).mtime.getTime()
    }))
        .sort((a, b) => b.mtime - a.mtime); // Newest first
    const removed = [];
    if (files.length > keepCount) {
        const toRemove = files.slice(keepCount);
        const { unlinkSync } = require('fs');
        for (const f of toRemove) {
            try {
                unlinkSync(f.filepath);
                removed.push(f.filename);
            }
            catch (err) {
                console.error(`[Just-Memory] Failed to remove old backup ${f.filename}:`, err);
            }
        }
    }
    return { removed, kept: Math.min(files.length, keepCount) };
}
// Auto-backup on process exit
let autoBackupEnabled = true;
process.on('exit', () => {
    if (autoBackupEnabled && db) {
        try {
            console.error('[Just-Memory] Auto-backup on exit...');
            const result = backupMemories();
            console.error(`[Just-Memory] Auto-backup saved: ${result.filename}`);
            cleanupOldBackups(10);
        }
        catch (err) {
            console.error('[Just-Memory] Auto-backup failed:', err);
        }
    }
});
process.on('SIGINT', () => {
    autoBackupEnabled = true;
    process.exit(0);
});
process.on('SIGTERM', () => {
    autoBackupEnabled = true;
    process.exit(0);
});
// ============================================================================
// Stats Function
// ============================================================================
function getStats(projectId) {
    const project = projectId ? getEffectiveProject(projectId) : null;
    let whereClause = project
        ? `WHERE (project_id = '${project}' OR project_id = 'global')`
        : '';
    let whereClauseDeleted = project
        ? `WHERE deleted_at IS NULL AND (project_id = '${project}' OR project_id = 'global')`
        : 'WHERE deleted_at IS NULL';
    const memoryCounts = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active FROM memories ${whereClause}`).get();
    const entityCount = db.prepare(`SELECT COUNT(*) as count FROM entities ${whereClause}`).get();
    const edgeCount = db.prepare(`SELECT COUNT(*) as count FROM edges ${whereClause}`).get();
    const avgConfidence = db.prepare(`SELECT AVG(confidence) as avg FROM memories ${whereClauseDeleted}`).get();
    const contradictionEdges = db.prepare(`SELECT COUNT(*) as count FROM edges WHERE relation_type LIKE 'contradiction_%' ${project ? `AND (project_id = '${project}' OR project_id = 'global')` : ''}`).get();
    const withEmbeddings = db.prepare(`SELECT COUNT(*) as count FROM memories ${whereClauseDeleted} AND embedding IS NOT NULL`).get();
    const typeBreakdown = db.prepare(`SELECT type, COUNT(*) as count FROM memories ${whereClauseDeleted} GROUP BY type ORDER BY count DESC`).all();
    return {
        project_id: project || 'all',
        memories: {
            total: memoryCounts.total,
            active: memoryCounts.active,
            deleted: memoryCounts.total - memoryCounts.active,
            withEmbeddings: withEmbeddings.count,
            avgConfidence: avgConfidence.avg ? parseFloat(avgConfidence.avg.toFixed(3)) : 0
        },
        entities: entityCount.count,
        edges: {
            total: edgeCount.count,
            contradictions: contradictionEdges.count
        },
        typeBreakdown,
        embeddingStatus: embedderReady ? 'ready' : 'not available'
    };
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
        current: currentProjectId,
        projects: memoryProjects.map((p) => ({
            id: p.project_id,
            memoryCount: p.memory_count,
            entityCount: entityMap.get(p.project_id) || 0,
            lastActivity: p.last_activity
        }))
    };
}
function setCurrentProject(projectId, path) {
    currentProjectId = projectId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    currentProjectPath = path || null;
    return { project_id: currentProjectId, path: currentProjectPath, set: true };
}
// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new index_js_1.Server({ name: 'just-memory', version: '2.1.0' }, { capabilities: { tools: {} } });
// Tool definitions
const TOOLS = [
    // Memory CRUD
    {
        name: 'memory_store',
        description: 'Store a new memory with automatic contradiction detection. Returns any potential contradictions found.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Content to remember (max 100KB)' },
                type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'], default: 'note' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Up to 20 tags' },
                importance: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
                confidence: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
                project_id: { type: 'string', description: 'Project scope (auto-detected if omitted)' }
            },
            required: ['content']
        }
    },
    {
        name: 'memory_recall',
        description: 'Recall a memory by ID. Strengthens the memory and returns related contradictions.',
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
        description: 'Update a memory. Checks for new contradictions if content changes.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Memory ID' },
                content: { type: 'string' },
                type: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number' },
                confidence: { type: 'number' }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_delete',
        description: 'Delete a memory (soft delete by default, permanent with flag)',
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
        description: 'Hybrid search (keyword + semantic) across memories',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', default: 10 },
                confidenceThreshold: { type: 'number', default: 0, minimum: 0, maximum: 1 },
                project_id: { type: 'string' }
            },
            required: ['query']
        }
    },
    {
        name: 'memory_list',
        description: 'List recent memories',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', default: 20 },
                includeDeleted: { type: 'boolean', default: false },
                project_id: { type: 'string' }
            }
        }
    },
    // NEW: Proactive Contradiction Finder (v2.1)
    {
        name: 'memory_find_contradictions',
        description: 'PROACTIVELY find contradictions for given content using semantic similarity, negation patterns, and factual claim comparison. Use this BEFORE storing to check for conflicts.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Content to check for contradictions' },
                limit: { type: 'number', default: 10, description: 'Max contradictions to return' },
                project_id: { type: 'string', description: 'Project scope' }
            },
            required: ['content']
        }
    },
    // Confidence
    {
        name: 'memory_confirm',
        description: 'Confirm a memory (increases confidence)',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Memory ID to confirm' },
                sourceId: { type: 'string', description: 'Optional confirming source memory ID' }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_contradict',
        description: 'Mark a memory as contradicted (decreases confidence)',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Memory ID to contradict' },
                contradictingId: { type: 'string', description: 'Optional contradicting memory ID' }
            },
            required: ['id']
        }
    },
    {
        name: 'memory_confident',
        description: 'Get high-confidence memories',
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
        description: 'Create a relationship between memories',
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
        description: 'Query edges for a memory',
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
        description: 'Invalidate an edge',
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
        description: 'Set a scratchpad value (working memory)',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string' },
                value: { type: 'string' },
                ttlSeconds: { type: 'number', description: 'Optional TTL in seconds' },
                project_id: { type: 'string' }
            },
            required: ['key', 'value']
        }
    },
    {
        name: 'memory_scratch_get',
        description: 'Get a scratchpad value',
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
        description: 'Delete a scratchpad key',
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
        description: 'List scratchpad keys',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_scratch_clear',
        description: 'Clear all scratchpad keys',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    // Entities
    {
        name: 'memory_entity_create',
        description: 'Create or update an entity with observations',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Unique entity name' },
                entityType: { type: 'string', default: 'concept' },
                observations: { type: 'array', items: { type: 'string' } },
                project_id: { type: 'string' }
            },
            required: ['name']
        }
    },
    {
        name: 'memory_entity_get',
        description: 'Get an entity with its relations',
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
        description: 'Create a relation between entities',
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
        description: 'Search entities',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                entityType: { type: 'string' },
                limit: { type: 'number', default: 20 },
                project_id: { type: 'string' }
            },
            required: ['query']
        }
    },
    {
        name: 'memory_entity_observe',
        description: 'Add observations to an entity',
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
        description: 'Delete an entity and its relations',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                project_id: { type: 'string' }
            },
            required: ['name']
        }
    },
    // Entity Type Hierarchy
    {
        name: 'memory_entity_type_define',
        description: 'Define an entity type with optional parent for inheritance (e.g., developer inherits from person)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Type name (will be normalized to lowercase_with_underscores)' },
                parentType: { type: 'string', description: 'Parent type to inherit from (optional)' },
                description: { type: 'string', description: 'Human-readable description of this type' }
            },
            required: ['name']
        }
    },
    {
        name: 'memory_entity_type_hierarchy',
        description: 'Get the full type hierarchy for an entity type (ancestors, descendants)',
        inputSchema: {
            type: 'object',
            properties: {
                typeName: { type: 'string', description: 'Entity type name to get hierarchy for' }
            },
            required: ['typeName']
        }
    },
    {
        name: 'memory_entity_type_list',
        description: 'List all defined entity types with their hierarchy info',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'memory_entity_search_hierarchical',
        description: 'Search entities by type including all subtypes (e.g., searching "person" finds developers, managers, etc.)',
        inputSchema: {
            type: 'object',
            properties: {
                entityType: { type: 'string', description: 'Base entity type to search (includes all subtypes)' },
                query: { type: 'string', description: 'Optional search query for name/observations' },
                limit: { type: 'number', default: 50 },
                project_id: { type: 'string' }
            },
            required: ['entityType']
        }
    },
    // Proactive Retrieval
    {
        name: 'memory_record_access',
        description: 'Record a memory access sequence for pattern learning. Call this when multiple memories are accessed together.',
        inputSchema: {
            type: 'object',
            properties: {
                memoryIds: { type: 'array', items: { type: 'string' }, description: 'IDs of memories accessed together' },
                sessionId: { type: 'string', description: 'Current session identifier' },
                context: { type: 'string', description: 'Optional context about why these were accessed' },
                project_id: { type: 'string' }
            },
            required: ['memoryIds', 'sessionId']
        }
    },
    {
        name: 'memory_suggestions',
        description: 'Get suggested memories based on access patterns. Given a memory or set of memories, suggests related ones that are often accessed together.',
        inputSchema: {
            type: 'object',
            properties: {
                memoryIds: {
                    oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } }
                    ],
                    description: 'Memory ID(s) to get suggestions for'
                },
                limit: { type: 'number', default: 10 },
                project_id: { type: 'string' }
            },
            required: ['memoryIds']
        }
    },
    {
        name: 'memory_access_patterns',
        description: 'Analyze memory access patterns - shows most co-accessed pairs, most accessed memories, and recent sessions.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', default: 20 },
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_suggest_from_context',
        description: 'Suggest relevant memories based on context text using keyword matching.',
        inputSchema: {
            type: 'object',
            properties: {
                context: { type: 'string', description: 'Context text to find relevant memories for' },
                limit: { type: 'number', default: 10 },
                project_id: { type: 'string' }
            },
            required: ['context']
        }
    },
    // Emotional Context
    {
        name: 'memory_set_emotion',
        description: 'Set emotional context for a memory (sentiment, intensity, emotion labels, user mood)',
        inputSchema: {
            type: 'object',
            properties: {
                memoryId: { type: 'string', description: 'Memory ID to set emotional context for' },
                sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mixed'], description: 'Overall sentiment' },
                emotionIntensity: { type: 'number', description: 'Emotion intensity from 0.0 to 1.0' },
                emotionLabels: { type: 'array', items: { type: 'string' }, description: 'Emotion labels (happy, sad, frustrated, etc.)' },
                userMood: { type: 'string', description: 'User mood at time of storage' },
                project_id: { type: 'string' }
            },
            required: ['memoryId', 'sentiment']
        }
    },
    {
        name: 'memory_get_emotion',
        description: 'Get emotional context for a memory',
        inputSchema: {
            type: 'object',
            properties: {
                memoryId: { type: 'string' },
                project_id: { type: 'string' }
            },
            required: ['memoryId']
        }
    },
    {
        name: 'memory_search_by_emotion',
        description: 'Search memories by emotional context (sentiment, intensity range, emotion labels)',
        inputSchema: {
            type: 'object',
            properties: {
                sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mixed'] },
                minIntensity: { type: 'number', description: 'Minimum emotion intensity (0.0 to 1.0)' },
                maxIntensity: { type: 'number', description: 'Maximum emotion intensity (0.0 to 1.0)' },
                emotionLabel: { type: 'string', description: 'Filter by specific emotion label' },
                limit: { type: 'number', default: 50 },
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_emotion_stats',
        description: 'Get emotion statistics - sentiment distribution, top emotions, emotional peaks',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    // Sleep Consolidation
    {
        name: 'memory_consolidate',
        description: 'Run memory consolidation - strengthen active memories, decay inactive, clean expired scratchpad',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_consolidation_status',
        description: 'Get consolidation status - idle state, memory health, recent consolidation runs',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_find_similar',
        description: 'Find similar memories that could be consolidated',
        inputSchema: {
            type: 'object',
            properties: {
                similarity_threshold: { type: 'number', default: 0.85, description: 'Jaccard similarity threshold (0-1)' },
                limit: { type: 'number', default: 20 },
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_record_activity',
        description: 'Record user activity to reset idle timer (call this on user interactions)',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    // Counterfactual Reasoning
    {
        name: 'memory_create_causal',
        description: 'Create a cause-effect relationship between two memories',
        inputSchema: {
            type: 'object',
            properties: {
                cause_id: { type: 'string', description: 'Memory ID of the cause' },
                effect_id: { type: 'string', description: 'Memory ID of the effect' },
                relationship_type: { type: 'string', default: 'causes', description: 'Type: causes, enables, prevents, correlates' },
                strength: { type: 'number', default: 0.7, description: 'Causal strength (0-1)' },
                confidence: { type: 'number', default: 0.5, description: 'Confidence in relationship (0-1)' },
                context: { type: 'string', description: 'Context in which this relationship holds' },
                conditions: { type: 'array', items: { type: 'string' }, description: 'Conditions that must be true' },
                project_id: { type: 'string' }
            },
            required: ['cause_id', 'effect_id']
        }
    },
    {
        name: 'memory_causal_chain',
        description: 'Get the causal chain for a memory (upstream causes, downstream effects)',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: { type: 'string', description: 'Memory ID to trace' },
                direction: { type: 'string', enum: ['upstream', 'downstream', 'both'], default: 'both' },
                depth: { type: 'number', default: 3, description: 'Max depth to traverse' },
                project_id: { type: 'string' }
            },
            required: ['memory_id']
        }
    },
    {
        name: 'memory_what_if',
        description: 'Ask "what if" questions - find causal relationships and alternatives',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The what-if question or search term' },
                limit: { type: 'number', default: 10 },
                project_id: { type: 'string' }
            },
            required: ['query']
        }
    },
    {
        name: 'memory_create_alternative',
        description: 'Create an alternative outcome scenario for counterfactual analysis',
        inputSchema: {
            type: 'object',
            properties: {
                causal_id: { type: 'string', description: 'Causal relationship ID' },
                alternative_cause: { type: 'string', description: 'Description of alternative cause' },
                predicted_outcome: { type: 'string', description: 'Predicted outcome if alternative had happened' },
                likelihood: { type: 'number', default: 0.5, description: 'Likelihood of this alternative (0-1)' },
                project_id: { type: 'string' }
            },
            required: ['causal_id', 'alternative_cause', 'predicted_outcome']
        }
    },
    {
        name: 'memory_record_outcome',
        description: 'Record actual outcome for an alternative (for learning from counterfactuals)',
        inputSchema: {
            type: 'object',
            properties: {
                alternative_id: { type: 'string', description: 'Alternative outcome ID' },
                actual_outcome: { type: 'string', description: 'What actually happened' }
            },
            required: ['alternative_id', 'actual_outcome']
        }
    },
    {
        name: 'memory_counterfactual_stats',
        description: 'Get statistics about causal relationships and counterfactual analysis',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    // Scheduled Tasks
    {
        name: 'memory_schedule_task',
        description: 'Schedule a task/reminder with cron or natural language ("in 30 minutes", "tomorrow at 3pm", "0 9 * * 1-5")',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Task title' },
                schedule: { type: 'string', description: 'Schedule: natural language or cron expression' },
                description: { type: 'string' },
                recurring: { type: 'boolean', default: false, description: 'Repeat on schedule (requires cron)' },
                action_type: { type: 'string', default: 'reminder', description: 'Type: reminder, consolidate, backup' },
                action_data: { type: 'object', description: 'Custom action data' },
                memory_id: { type: 'string', description: 'Optional linked memory ID' },
                project_id: { type: 'string' }
            },
            required: ['title', 'schedule']
        }
    },
    {
        name: 'memory_list_tasks',
        description: 'List scheduled tasks',
        inputSchema: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['pending', 'triggered', 'completed', 'cancelled'] },
                limit: { type: 'number', default: 50 },
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_check_tasks',
        description: 'Check and trigger due tasks (call periodically)',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_complete_task',
        description: 'Mark a triggered task as completed',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: 'Task ID to complete' }
            },
            required: ['task_id']
        }
    },
    {
        name: 'memory_cancel_task',
        description: 'Cancel a scheduled task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: 'Task ID to cancel' }
            },
            required: ['task_id']
        }
    },
    {
        name: 'memory_reschedule_task',
        description: 'Reschedule a task to a new time',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: 'Task ID to reschedule' },
                new_schedule: { type: 'string', description: 'New schedule expression' }
            },
            required: ['task_id', 'new_schedule']
        }
    },
    // Enhanced Contradiction Engine
    {
        name: 'memory_scan_contradictions',
        description: 'Scan for unresolved contradictions and optionally create resolution requests',
        inputSchema: {
            type: 'object',
            properties: {
                auto_create_resolutions: { type: 'boolean', default: true, description: 'Auto-create resolution requests for found contradictions' },
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_pending_resolutions',
        description: 'Get pending contradiction resolutions awaiting human decision',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', default: 20 },
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_create_resolution',
        description: 'Create a resolution request for two contradicting memories',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id_1: { type: 'string', description: 'First memory ID' },
                memory_id_2: { type: 'string', description: 'Second memory ID' },
                project_id: { type: 'string' }
            },
            required: ['memory_id_1', 'memory_id_2']
        }
    },
    {
        name: 'memory_resolve',
        description: 'Resolve a contradiction - choose which memory to keep or merge them',
        inputSchema: {
            type: 'object',
            properties: {
                resolution_id: { type: 'string', description: 'Resolution request ID' },
                resolution_type: { type: 'string', enum: ['keep_first', 'keep_second', 'keep_both', 'merge', 'delete_both'], description: 'How to resolve' },
                note: { type: 'string', description: 'Optional resolution note' },
                merged_content: { type: 'string', description: 'New content if merging (required for merge type)' }
            },
            required: ['resolution_id', 'resolution_type']
        }
    },
    {
        name: 'memory_contradiction_stats',
        description: 'Get contradiction statistics - by type, resolution status, most contradicted memories',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_auto_deprecate',
        description: 'Auto-deprecate heavily contradicted low-confidence memories',
        inputSchema: {
            type: 'object',
            properties: {
                confidence_threshold: { type: 'number', default: 0.2, description: 'Max confidence to deprecate' },
                min_contradictions: { type: 'number', default: 3, description: 'Minimum contradiction count' },
                project_id: { type: 'string' }
            }
        }
    },
    // Intent Prediction
    {
        name: 'memory_predict_intent',
        description: 'Predict user intent from context text and suggest relevant memories',
        inputSchema: {
            type: 'object',
            properties: {
                context: { type: 'string', description: 'Context text to analyze for intent' },
                project_id: { type: 'string' }
            },
            required: ['context']
        }
    },
    {
        name: 'memory_infer_intent',
        description: 'Infer intent from recent access patterns and memory usage',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_create_intent',
        description: 'Manually create a user intent to track',
        inputSchema: {
            type: 'object',
            properties: {
                intent_type: { type: 'string', description: 'Type: learning, planning, debugging, building, reviewing, documenting, searching, comparing, deciding, refactoring' },
                description: { type: 'string', description: 'Description of the intent' },
                context_keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords related to this intent' },
                related_memories: { type: 'array', items: { type: 'string' }, description: 'Memory IDs related to this intent' },
                confidence: { type: 'number', default: 0.5 },
                project_id: { type: 'string' }
            },
            required: ['intent_type', 'description']
        }
    },
    {
        name: 'memory_active_intents',
        description: 'Get active user intents being tracked',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', default: 20 },
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_complete_intent',
        description: 'Mark an intent as completed/resolved',
        inputSchema: {
            type: 'object',
            properties: {
                intent_id: { type: 'string', description: 'Intent ID to complete' }
            },
            required: ['intent_id']
        }
    },
    {
        name: 'memory_suggest_for_intent',
        description: 'Get memory suggestions for a specific intent type',
        inputSchema: {
            type: 'object',
            properties: {
                intent_type: { type: 'string', description: 'Intent type to get suggestions for' },
                context: { type: 'string', description: 'Optional additional context' },
                limit: { type: 'number', default: 10 },
                project_id: { type: 'string' }
            },
            required: ['intent_type']
        }
    },
    // Backup/Restore
    {
        name: 'memory_backup',
        description: 'Backup memories to a JSON file',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string' }
            }
        }
    },
    {
        name: 'memory_restore',
        description: 'Restore memories from a backup file',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to backup file' },
                mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge' },
                target_project: { type: 'string', description: 'Target project ID' }
            },
            required: ['path']
        }
    },
    {
        name: 'memory_list_backups',
        description: 'List available backups',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    // Stats
    {
        name: 'memory_stats',
        description: 'Get memory statistics including contradiction counts',
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
        description: 'Generate a session briefing with recent memories and entities',
        inputSchema: {
            type: 'object',
            properties: {
                maxTokens: { type: 'number', default: 500 },
                project_id: { type: 'string' }
            }
        }
    },
    // Project Management
    {
        name: 'memory_project_list',
        description: 'List all projects with memory counts',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'memory_project_set',
        description: 'Set the current project context',
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
    const args = rawArgs;
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
            // NEW: Proactive Contradiction Finder (v2.1)
            case 'memory_find_contradictions':
                result = await findContradictionsProactive(args.content, args.project_id, args.limit || 10);
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
            // Entity Type Hierarchy
            case 'memory_entity_type_define':
                result = defineEntityType(args.name, args.parentType, args.description);
                break;
            case 'memory_entity_type_hierarchy':
                result = getTypeHierarchy(args.typeName);
                break;
            case 'memory_entity_type_list':
                result = listEntityTypes();
                break;
            case 'memory_entity_search_hierarchical':
                result = searchEntitiesByTypeHierarchy(args.entityType, args.query, args.project_id, args.limit);
                break;
            // Proactive Retrieval
            case 'memory_record_access':
                result = recordAccessSequence(args.memoryIds, args.sessionId, args.context, args.project_id);
                break;
            case 'memory_suggestions':
                result = getSuggestions(args.memoryIds, args.project_id, args.limit);
                break;
            case 'memory_access_patterns':
                result = getAccessPatterns(args.project_id, args.limit);
                break;
            case 'memory_suggest_from_context':
                result = suggestFromContext(args.context, args.project_id, args.limit);
                break;
            // Emotional Context
            case 'memory_set_emotion':
                result = setEmotionalContext(args.memoryId, args.sentiment, args.emotionIntensity, args.emotionLabels, args.userMood, args.project_id);
                break;
            case 'memory_get_emotion':
                result = getEmotionalContext(args.memoryId, args.project_id);
                break;
            case 'memory_search_by_emotion':
                result = searchByEmotion(args.sentiment, args.minIntensity, args.maxIntensity, args.emotionLabel, args.project_id, args.limit);
                break;
            case 'memory_emotion_stats':
                result = getEmotionStats(args.project_id);
                break;
            // Sleep Consolidation
            case 'memory_consolidate':
                result = runConsolidation(args.project_id);
                break;
            case 'memory_consolidation_status':
                result = getConsolidationStatus(args.project_id);
                break;
            case 'memory_find_similar':
                result = findSimilarMemories(args.project_id, args.similarity_threshold, args.limit);
                break;
            case 'memory_record_activity':
                recordActivity();
                result = { recorded: true, timestamp: new Date().toISOString() };
                break;
            // Counterfactual Reasoning
            case 'memory_create_causal':
                result = createCausalRelationship(args.cause_id, args.effect_id, args.relationship_type, args.strength, args.confidence, args.context, args.conditions, args.project_id);
                break;
            case 'memory_causal_chain':
                result = getCausalChain(args.memory_id, args.direction, args.depth, args.project_id);
                break;
            case 'memory_what_if':
                result = whatIf(args.query, args.project_id, args.limit);
                break;
            case 'memory_create_alternative':
                result = createAlternativeOutcome(args.causal_id, args.alternative_cause, args.predicted_outcome, args.likelihood, args.project_id);
                break;
            case 'memory_record_outcome':
                result = recordActualOutcome(args.alternative_id, args.actual_outcome);
                break;
            case 'memory_counterfactual_stats':
                result = getCounterfactualStats(args.project_id);
                break;
            // Scheduled Tasks
            case 'memory_schedule_task':
                result = createScheduledTask(args.title, args.schedule, args.description, args.recurring, args.action_type, args.action_data, args.memory_id, args.project_id);
                break;
            case 'memory_list_tasks':
                result = listScheduledTasks(args.status, args.project_id, args.limit);
                break;
            case 'memory_check_tasks':
                result = checkDueTasks(args.project_id);
                break;
            case 'memory_complete_task':
                result = completeScheduledTask(args.task_id);
                break;
            case 'memory_cancel_task':
                result = cancelScheduledTask(args.task_id);
                break;
            case 'memory_reschedule_task':
                result = rescheduleTask(args.task_id, args.new_schedule);
                break;
            // Enhanced Contradiction Engine
            case 'memory_scan_contradictions':
                result = scanContradictions(args.project_id, args.auto_create_resolutions);
                break;
            case 'memory_pending_resolutions':
                result = getPendingResolutions(args.project_id, args.limit);
                break;
            case 'memory_create_resolution':
                result = createResolutionRequest(args.memory_id_1, args.memory_id_2, args.project_id);
                break;
            case 'memory_resolve':
                result = resolveContradiction(args.resolution_id, args.resolution_type, args.note, args.merged_content);
                break;
            case 'memory_contradiction_stats':
                result = getContradictionStats(args.project_id);
                break;
            case 'memory_auto_deprecate':
                result = autoDeprecateContradicted(args.confidence_threshold, args.min_contradictions, args.project_id);
                break;
            // Intent Prediction
            case 'memory_predict_intent':
                result = predictIntent(args.context, args.project_id);
                break;
            case 'memory_infer_intent':
                result = inferIntentFromPatterns(args.project_id);
                break;
            case 'memory_create_intent':
                result = createIntent(args.intent_type, args.description, args.context_keywords, args.related_memories, args.confidence, args.project_id);
                break;
            case 'memory_active_intents':
                result = getActiveIntents(args.project_id, args.limit);
                break;
            case 'memory_complete_intent':
                result = completeIntent(args.intent_id);
                break;
            case 'memory_suggest_for_intent':
                result = suggestForIntent(args.intent_type, args.context, args.project_id, args.limit);
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
    console.error('[Just-Memory v2.9] Server started - Intent Prediction');
    console.error(`[Just-Memory v2.9] Project: ${currentProjectId} (from ${detectProject().source})`);
    console.error(`[Just-Memory v2.9] Database: ${DB_PATH}`);
    console.error(`[Just-Memory v2.9] Tools: ${TOOLS.length}`);
    console.error('[Just-Memory v2.9] Features: Intent prediction, contradiction resolution, scheduled tasks, counterfactual reasoning');
    // Start background consolidation timer
    startConsolidationTimer();
}
main().catch(console.error);
//# sourceMappingURL=just-memory-v2.1.js.map