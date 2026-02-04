/**
 * Just-Memory v1.7 - Knowledge Graph Entity Layer
 *
 * New in v1.7:
 * - Entity-based knowledge graph (like official memory MCP)
 * - memory_entity_create - Create named entities (people, concepts, projects)
 * - memory_entity_get - Get entity by name
 * - memory_entity_link - Create relations between entities
 * - memory_entity_search - Search entities by name/type
 *
 * Complete tool set: 24 tools (20 from v1.6 + 4 entity tools)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
// @ts-ignore - better-sqlite3 types
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
// ============================================================================
// Constants
// ============================================================================
const MAX_CONTENT_LENGTH = 100000; // 100KB limit
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;
const MAX_ENTITY_NAME_LENGTH = 200;
const MAX_OBSERVATIONS = 100;
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
const DB_PATH = join(homedir(), '.just-memory', 'memories.db');
const DB_DIR = dirname(DB_PATH);
if (!existsSync(DB_DIR))
    mkdirSync(DB_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
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
    contradiction_count INTEGER DEFAULT 0
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
// NEW: Entities table (knowledge graph nodes)
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
// NEW: Entity relations table (knowledge graph edges)
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
// ============================================================================
// SQL Injection Protection
// ============================================================================
function sanitizeLikePattern(input) {
    return input.replace(/[%_]/g, '\\$&');
}
// ============================================================================
// Input Validation
// ============================================================================
function validateContent(content) {
    if (!content || typeof content !== 'string') {
        throw new Error('Content is required and must be a string');
    }
    if (content.length > MAX_CONTENT_LENGTH) {
        throw new Error(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters (got ${content.length})`);
    }
}
function validateTags(tags) {
    if (!Array.isArray(tags))
        return [];
    return tags
        .slice(0, MAX_TAGS_COUNT)
        .map(t => String(t).slice(0, MAX_TAG_LENGTH))
        .filter(t => t.length > 0);
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
        return { level: 'low', note: 'Limited corroboration.' };
    if (memory.contradiction_count > 0)
        return { level: 'uncertain', note: `${memory.contradiction_count} conflicting source(s).` };
    return { level: 'uncertain', note: 'Single source, unconfirmed.' };
}
function toConfidentMemory(memory) {
    const assessment = assessConfidence(memory);
    return {
        id: memory.id, content: memory.content,
        confidence: calculateEffectiveConfidence(memory),
        confidenceLevel: assessment.level,
        uncertaintyNote: assessment.note,
        confirmingSources: memory.source_count,
        contradictions: memory.contradiction_count
    };
}
// ============================================================================
// Auto-Contradiction Detection
// ============================================================================
function findContradictions(content, excludeId, limit = 5) {
    const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    if (words.length === 0)
        return [];
    const negations = ['not', 'no', 'never', 'none', 'neither', "don't", "doesn't", "isn't", "aren't", "wasn't", "weren't"];
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
    return scored
        .filter(s => s.potentialContradiction)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, limit)
        .map(s => s.memory);
}
// ============================================================================
// Core Memory Operations
// ============================================================================
function storeMemory(content, type = 'note', tags = [], importance = 0.5, confidence = 0.5) {
    validateContent(content);
    const validTags = validateTags(tags);
    const id = randomUUID().replace(/-/g, '');
    const contradictions = findContradictions(content);
    let adjustedConfidence = confidence;
    if (contradictions.length > 0) {
        adjustedConfidence = Math.max(0.2, confidence - 0.1 * contradictions.length);
    }
    db.prepare(`INSERT INTO memories (id, content, type, tags, importance, confidence) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, content, type, JSON.stringify(validTags), importance, adjustedConfidence);
    for (const c of contradictions) {
        const edgeId = randomUUID().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'potential_contradiction', 0.5)`)
            .run(edgeId, id, c.id);
    }
    return {
        id, content, type, tags: validTags, importance,
        confidence: adjustedConfidence,
        strength: 1.0,
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
        retention: calculateRetention(updated.last_accessed, updated.strength)
    };
}
function updateMemory(id, updates) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const fields = [];
    const values = [];
    if (updates.content !== undefined) {
        validateContent(updates.content);
        fields.push('content = ?');
        values.push(updates.content);
        const contradictions = findContradictions(updates.content, id);
        if (contradictions.length > 0) {
            for (const c of contradictions) {
                const existing = db.prepare('SELECT id FROM edges WHERE from_id = ? AND to_id = ? AND relation_type = ?')
                    .get(id, c.id, 'potential_contradiction');
                if (!existing) {
                    const edgeId = randomUUID().replace(/-/g, '');
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
        const validTags = validateTags(updates.tags);
        fields.push('tags = ?');
        values.push(JSON.stringify(validTags));
    }
    if (updates.importance !== undefined) {
        fields.push('importance = ?');
        values.push(Math.max(0, Math.min(1, updates.importance)));
    }
    if (updates.confidence !== undefined) {
        fields.push('confidence = ?');
        values.push(Math.max(0, Math.min(1, updates.confidence)));
    }
    if (fields.length === 0) {
        return { error: 'No valid updates provided', id };
    }
    fields.push("last_accessed = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return {
        id: updated.id,
        content: updated.content,
        type: updated.type,
        tags: JSON.parse(updated.tags),
        importance: updated.importance,
        confidence: updated.confidence,
        updated: true
    };
}
function searchMemories(query, limit = 10, confidenceThreshold = 0) {
    const sanitizedQuery = sanitizeLikePattern(query);
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND content LIKE ? ESCAPE '\\' ORDER BY confidence DESC, importance DESC LIMIT ?`)
        .all(`%${sanitizedQuery}%`, limit * 2);
    return rows
        .map(m => ({ ...toConfidentMemory(m), tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength) }))
        .filter(m => m.retention > 0.1 && m.confidence >= confidenceThreshold)
        .slice(0, limit);
}
function listMemories(limit = 20, includeWeak = false, includeUncertain = false) {
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT ?`).all(limit * 2);
    return rows
        .map(m => ({ ...toConfidentMemory(m), tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength) }))
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
    const byConfidence = db.prepare(`
    SELECT SUM(CASE WHEN confidence >= 0.8 THEN 1 ELSE 0 END) as high,
           SUM(CASE WHEN confidence >= 0.5 AND confidence < 0.8 THEN 1 ELSE 0 END) as medium,
           SUM(CASE WHEN confidence >= 0.3 AND confidence < 0.5 THEN 1 ELSE 0 END) as low,
           SUM(CASE WHEN confidence < 0.3 THEN 1 ELSE 0 END) as uncertain
    FROM memories WHERE deleted_at IS NULL
  `).get();
    const edges = db.prepare('SELECT COUNT(*) as count FROM edges WHERE valid_to IS NULL').get().count;
    const scratch = db.prepare('SELECT COUNT(*) as count FROM scratchpad WHERE expires_at IS NULL OR expires_at > datetime("now")').get().count;
    // NEW: Entity stats
    const entities = db.prepare('SELECT COUNT(*) as count FROM entities').get().count;
    const entityRelations = db.prepare('SELECT COUNT(*) as count FROM entity_relations').get().count;
    return {
        total,
        byConfidenceLevel: byConfidence,
        activeEdges: edges,
        scratchpadItems: scratch,
        entities,
        entityRelations,
        dbPath: DB_PATH,
        version: '1.7.0'
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
        const edgeId = randomUUID().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'confirms', 1.0)`).run(edgeId, sourceId, id);
    }
    return { id, newConfidence, newSourceCount, message: 'Confidence increased' };
}
function contradictMemory(id, contradictingId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newCount = memory.contradiction_count + 1;
    const newConfidence = Math.max(0, memory.confidence - CONFIDENCE_PENALTY.CONTRADICTION);
    db.prepare(`UPDATE memories SET contradiction_count = ?, confidence = ? WHERE id = ?`).run(newCount, newConfidence, id);
    if (contradictingId) {
        const edgeId = randomUUID().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'contradicts', 1.0)`).run(edgeId, contradictingId, id);
    }
    return { id, newConfidence, newContradictionCount: newCount, message: newConfidence < 0.3 ? 'Warning: Very low confidence' : 'Confidence decreased' };
}
function getConfidentMemories(threshold = 0.5, limit = 20) {
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY confidence DESC LIMIT ?`).all(limit * 2);
    return rows.map(toConfidentMemory).filter(m => m.confidence >= threshold).slice(0, limit);
}
// ============================================================================
// Edge Operations (for memories)
// ============================================================================
function createEdge(fromId, toId, relationType, validFrom, validTo, confidence = 1.0, metadata = {}) {
    const fromExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(fromId);
    const toExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(toId);
    if (!fromExists)
        return { error: `Source not found: ${fromId}` };
    if (!toExists)
        return { error: `Target not found: ${toId}` };
    const id = randomUUID().replace(/-/g, '');
    const vf = validFrom || new Date().toISOString();
    db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, fromId, toId, relationType, vf, validTo || null, confidence, JSON.stringify(metadata));
    return { id, fromId, toId, relationType, validFrom: vf, validTo: validTo || null, confidence, metadata };
}
function queryEdges(memoryId, direction = 'both', relationTypes, asOfDate, includeExpired = false, limit = 50) {
    let sql = 'SELECT * FROM edges WHERE 1=1';
    const params = [];
    if (memoryId) {
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
    }
    if (relationTypes?.length) {
        sql += ` AND relation_type IN (${relationTypes.map(() => '?').join(',')})`;
        params.push(...relationTypes);
    }
    if (asOfDate) {
        sql += ' AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)';
        params.push(asOfDate, asOfDate);
    }
    else if (!includeExpired) {
        sql += ' AND valid_to IS NULL';
    }
    sql += ' ORDER BY valid_from DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params).map(e => ({ ...e, metadata: JSON.parse(e.metadata) }));
}
function invalidateEdge(edgeId, validTo) {
    const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
    if (!edge)
        return { error: `Edge not found: ${edgeId}` };
    if (edge.valid_to)
        return { error: 'Already invalidated', invalidatedAt: edge.valid_to };
    const inv = validTo || new Date().toISOString();
    db.prepare('UPDATE edges SET valid_to = ? WHERE id = ?').run(inv, edgeId);
    return { id: edgeId, invalidated: true, validTo: inv };
}
// ============================================================================
// Spreading Activation
// ============================================================================
function spreadingActivation(seedIds, maxHops = 3, decayFactor = 0.5, inhibitionThreshold = 1.0, minActivation = 0.1, asOfDate) {
    const activations = new Map();
    for (const id of seedIds)
        activations.set(id, { activation: 1.0, depth: 0, path: [id], edgeTypes: [] });
    const frontier = seedIds.map(id => ({ id, depth: 0, activation: 1.0, path: [id], edgeTypes: [] }));
    while (frontier.length > 0) {
        const curr = frontier.shift();
        if (curr.depth >= maxHops || curr.activation < minActivation)
            continue;
        const edges = queryEdges(curr.id, 'both', undefined, asOfDate, false, 100);
        const perEdge = (curr.activation * decayFactor) / Math.max(1, edges.length);
        for (const e of edges) {
            const neighbor = e.from_id === curr.id ? e.to_id : e.from_id;
            if (curr.path.includes(neighbor))
                continue;
            const newAct = perEdge * e.confidence;
            if (newAct < minActivation)
                continue;
            const existing = activations.get(neighbor);
            if (existing) {
                const combined = Math.min(existing.activation + newAct, inhibitionThreshold);
                if (combined > existing.activation) {
                    activations.set(neighbor, {
                        activation: combined, depth: Math.min(existing.depth, curr.depth + 1),
                        path: existing.activation < newAct ? [...curr.path, neighbor] : existing.path,
                        edgeTypes: existing.activation < newAct ? [...curr.edgeTypes, e.relation_type] : existing.edgeTypes
                    });
                }
            }
            else {
                activations.set(neighbor, { activation: newAct, depth: curr.depth + 1, path: [...curr.path, neighbor], edgeTypes: [...curr.edgeTypes, e.relation_type] });
                frontier.push({ id: neighbor, depth: curr.depth + 1, activation: newAct, path: [...curr.path, neighbor], edgeTypes: [...curr.edgeTypes, e.relation_type] });
            }
        }
    }
    const results = [];
    for (const [id, data] of activations) {
        const m = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
        if (m)
            results.push({ ...toConfidentMemory(m), activation: data.activation, depth: data.depth, path: data.path, edgeTypes: data.edgeTypes });
    }
    return results.sort((a, b) => b.activation - a.activation);
}
// ============================================================================
// Working Memory / Scratchpad
// ============================================================================
function scratchSet(key, value, ttlSeconds) {
    if (value.length > MAX_CONTENT_LENGTH) {
        throw new Error(`Value exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
    }
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    db.prepare(`INSERT OR REPLACE INTO scratchpad (key, value, expires_at, created_at) VALUES (?, ?, ?, datetime('now'))`).run(key, value, expiresAt);
    return { key, stored: true, expiresAt };
}
function scratchGet(key) {
    const row = db.prepare('SELECT * FROM scratchpad WHERE key = ?').get(key);
    if (!row)
        return { key, found: false };
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        db.prepare('DELETE FROM scratchpad WHERE key = ?').run(key);
        return { key, found: false, expired: true };
    }
    return { key, value: row.value, expiresAt: row.expires_at, createdAt: row.created_at };
}
function scratchDelete(key) {
    db.prepare('DELETE FROM scratchpad WHERE key = ?').run(key);
    return { key, deleted: true };
}
function scratchClear() {
    const result = db.prepare('DELETE FROM scratchpad').run();
    return { cleared: result.changes };
}
function scratchList() {
    db.prepare('DELETE FROM scratchpad WHERE expires_at IS NOT NULL AND expires_at < datetime("now")').run();
    const rows = db.prepare('SELECT key, expires_at, created_at FROM scratchpad').all();
    return rows;
}
// ============================================================================
// Session Briefing
// ============================================================================
function generateBriefing(maxTokens = 500) {
    const recent = db.prepare(`
    SELECT * FROM memories WHERE deleted_at IS NULL 
    ORDER BY last_accessed DESC LIMIT 10
  `).all();
    const important = db.prepare(`
    SELECT * FROM memories WHERE deleted_at IS NULL AND importance >= 0.7
    ORDER BY confidence DESC LIMIT 5
  `).all();
    const scratch = scratchList();
    // NEW: Include entities in briefing
    const recentEntities = db.prepare(`
    SELECT * FROM entities ORDER BY updated_at DESC LIMIT 5
  `).all();
    const sections = [];
    if (recent.length > 0) {
        const recentItems = recent.slice(0, 5).map(m => `- ${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}`);
        sections.push(`**Recent Context:**\n${recentItems.join('\n')}`);
    }
    if (important.length > 0) {
        const importantItems = important.slice(0, 3).map(m => `- [${(m.confidence * 100).toFixed(0)}%] ${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}`);
        sections.push(`**Key Facts:**\n${importantItems.join('\n')}`);
    }
    if (recentEntities.length > 0) {
        const entityItems = recentEntities.slice(0, 3).map(e => `- ${e.name} (${e.entity_type})`);
        sections.push(`**Known Entities:**\n${entityItems.join('\n')}`);
    }
    if (scratch.length > 0) {
        const scratchItems = scratch.slice(0, 3).map(s => `- ${s.key}`);
        sections.push(`**Working Memory:**\n${scratchItems.join('\n')}`);
    }
    const briefing = sections.join('\n\n');
    const estimatedTokens = Math.ceil(briefing.length / 4);
    return {
        briefing: briefing || 'No memories to brief.',
        estimatedTokens,
        memoriesCount: recent.length,
        entitiesCount: recentEntities.length,
        scratchpadCount: scratch.length
    };
}
// ============================================================================
// NEW: Entity Operations (Knowledge Graph)
// ============================================================================
/**
 * Create or update an entity in the knowledge graph
 */
function createEntity(name, entityType = 'concept', observations = []) {
    validateEntityName(name);
    const validObs = validateObservations(observations);
    // Check if entity exists
    const existing = db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
    if (existing) {
        // Update existing entity - merge observations
        const existingObs = JSON.parse(existing.observations);
        const mergedObs = [...new Set([...existingObs, ...validObs])].slice(0, MAX_OBSERVATIONS);
        db.prepare(`UPDATE entities SET entity_type = ?, observations = ?, updated_at = datetime('now') WHERE name = ?`)
            .run(entityType, JSON.stringify(mergedObs), name);
        return {
            id: existing.id,
            name,
            entityType,
            observations: mergedObs,
            updated: true,
            created: false
        };
    }
    // Create new entity
    const id = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO entities (id, name, entity_type, observations) VALUES (?, ?, ?, ?)`)
        .run(id, name, entityType, JSON.stringify(validObs));
    return {
        id,
        name,
        entityType,
        observations: validObs,
        updated: false,
        created: true
    };
}
/**
 * Get an entity by name, including its relations
 */
function getEntity(name) {
    const entity = db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
    if (!entity)
        return { error: 'Entity not found', name };
    // Get outgoing relations
    const outgoing = db.prepare('SELECT * FROM entity_relations WHERE from_entity = ?').all(name);
    // Get incoming relations
    const incoming = db.prepare('SELECT * FROM entity_relations WHERE to_entity = ?').all(name);
    return {
        id: entity.id,
        name: entity.name,
        entityType: entity.entity_type,
        observations: JSON.parse(entity.observations),
        relations: {
            outgoing: outgoing.map(r => ({ to: r.to_entity, type: r.relation_type })),
            incoming: incoming.map(r => ({ from: r.from_entity, type: r.relation_type }))
        },
        createdAt: entity.created_at,
        updatedAt: entity.updated_at
    };
}
/**
 * Create a relation between two entities
 * Relation types should be in active voice (e.g., "works_at", "knows", "created")
 */
function createEntityRelation(from, to, relationType) {
    validateEntityName(from);
    validateEntityName(to);
    if (!relationType || typeof relationType !== 'string') {
        throw new Error('Relation type is required');
    }
    // Check both entities exist
    const fromEntity = db.prepare('SELECT name FROM entities WHERE name = ?').get(from);
    const toEntity = db.prepare('SELECT name FROM entities WHERE name = ?').get(to);
    if (!fromEntity)
        return { error: `Source entity not found: ${from}` };
    if (!toEntity)
        return { error: `Target entity not found: ${to}` };
    // Check if relation already exists
    const existing = db.prepare('SELECT id FROM entity_relations WHERE from_entity = ? AND to_entity = ? AND relation_type = ?')
        .get(from, to, relationType);
    if (existing) {
        return {
            error: 'Relation already exists',
            from, to, relationType,
            id: existing.id
        };
    }
    const id = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO entity_relations (id, from_entity, to_entity, relation_type) VALUES (?, ?, ?, ?)`)
        .run(id, from, to, relationType);
    return {
        id,
        from,
        to,
        relationType,
        created: true
    };
}
/**
 * Search entities by name or type
 */
function searchEntities(query, entityType, limit = 20) {
    const sanitizedQuery = sanitizeLikePattern(query);
    let sql = `SELECT * FROM entities WHERE (name LIKE ? ESCAPE '\\' OR observations LIKE ? ESCAPE '\\')`;
    const params = [`%${sanitizedQuery}%`, `%${sanitizedQuery}%`];
    if (entityType) {
        sql += ' AND entity_type = ?';
        params.push(entityType);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map(e => ({
        id: e.id,
        name: e.name,
        entityType: e.entity_type,
        observations: JSON.parse(e.observations),
        createdAt: e.created_at,
        updatedAt: e.updated_at
    }));
}
/**
 * Add observations to an existing entity
 */
function addObservations(name, observations) {
    const entity = db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
    if (!entity)
        return { error: 'Entity not found', name };
    const existingObs = JSON.parse(entity.observations);
    const validObs = validateObservations(observations);
    const mergedObs = [...new Set([...existingObs, ...validObs])].slice(0, MAX_OBSERVATIONS);
    db.prepare(`UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE name = ?`)
        .run(JSON.stringify(mergedObs), name);
    return {
        name,
        observations: mergedObs,
        added: validObs.length,
        total: mergedObs.length
    };
}
/**
 * Delete an entity and its relations
 */
function deleteEntity(name) {
    const entity = db.prepare('SELECT name FROM entities WHERE name = ?').get(name);
    if (!entity)
        return { error: 'Entity not found', name };
    // Delete relations first
    const deletedRelations = db.prepare('DELETE FROM entity_relations WHERE from_entity = ? OR to_entity = ?').run(name, name);
    // Delete entity
    db.prepare('DELETE FROM entities WHERE name = ?').run(name);
    return {
        name,
        deleted: true,
        relationsDeleted: deletedRelations.changes
    };
}
// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.7.0' }, { capabilities: { tools: {} } });
const TOOLS = [
    // Core memory (7 tools)
    { name: 'memory_store', description: 'Store memory with auto-contradiction detection. Max 100KB content.', inputSchema: {
            type: 'object', properties: {
                content: { type: 'string', description: 'Memory content (max 100KB)' },
                type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
                tags: { type: 'array', items: { type: 'string' }, description: 'Up to 20 tags, 100 chars each' },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Initial confidence (0-1)' }
            }, required: ['content']
        } },
    { name: 'memory_recall', description: 'Recall by ID (strengthens memory)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' } }, required: ['id']
        } },
    { name: 'memory_update', description: 'Update existing memory content, type, tags, importance, or confidence', inputSchema: {
            type: 'object', properties: {
                id: { type: 'string', description: 'Memory ID to update' },
                content: { type: 'string', description: 'New content (triggers contradiction re-check)' },
                type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
            }, required: ['id']
        } },
    { name: 'memory_search', description: 'Search with confidence filtering (SQL-injection safe)', inputSchema: {
            type: 'object', properties: {
                query: { type: 'string' }, limit: { type: 'number', default: 10 },
                confidenceThreshold: { type: 'number', default: 0, description: 'Min confidence (0-1)' }
            }, required: ['query']
        } },
    { name: 'memory_list', description: 'List recent memories', inputSchema: {
            type: 'object', properties: {
                limit: { type: 'number', default: 20 }, includeWeak: { type: 'boolean' }, includeUncertain: { type: 'boolean' }
            }
        } },
    { name: 'memory_delete', description: 'Delete memory', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, permanent: { type: 'boolean' } }, required: ['id']
        } },
    { name: 'memory_stats', description: 'Get statistics including entity counts', inputSchema: { type: 'object', properties: {} } },
    // Confidence management (3 tools)
    { name: 'memory_confirm', description: 'Add confirming source (increases confidence)', inputSchema: {
            type: 'object', properties: {
                id: { type: 'string' }, sourceId: { type: 'string', description: 'Optional confirming memory ID' }
            }, required: ['id']
        } },
    { name: 'memory_contradict', description: 'Record contradiction (decreases confidence)', inputSchema: {
            type: 'object', properties: {
                id: { type: 'string' }, contradictingId: { type: 'string', description: 'Optional contradicting memory ID' }
            }, required: ['id']
        } },
    { name: 'memory_confident', description: 'Get high-confidence memories', inputSchema: {
            type: 'object', properties: {
                confidenceThreshold: { type: 'number', default: 0.5 }, limit: { type: 'number', default: 20 }
            }
        } },
    // Bi-temporal edges (3 tools)
    { name: 'memory_edge_create', description: 'Create temporal relationship between memories', inputSchema: {
            type: 'object', properties: {
                fromId: { type: 'string' }, toId: { type: 'string' }, relationType: { type: 'string' },
                validFrom: { type: 'string' }, validTo: { type: 'string' }, confidence: { type: 'number' }, metadata: { type: 'object' }
            }, required: ['fromId', 'toId', 'relationType']
        } },
    { name: 'memory_edge_query', description: 'Query memory relationships', inputSchema: {
            type: 'object', properties: {
                memoryId: { type: 'string' }, direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'] },
                relationTypes: { type: 'array', items: { type: 'string' } }, asOfDate: { type: 'string' },
                includeExpired: { type: 'boolean' }, limit: { type: 'number' }
            }
        } },
    { name: 'memory_edge_invalidate', description: 'Invalidate edge (set end date)', inputSchema: {
            type: 'object', properties: { edgeId: { type: 'string' }, validTo: { type: 'string' } }, required: ['edgeId']
        } },
    // Graph traversal (1 tool)
    { name: 'memory_graph_traverse', description: 'Spreading activation traversal on memories', inputSchema: {
            type: 'object', properties: {
                seedIds: { type: 'array', items: { type: 'string' } }, maxHops: { type: 'number' },
                decayFactor: { type: 'number' }, inhibitionThreshold: { type: 'number' },
                minActivation: { type: 'number' }, asOfDate: { type: 'string' }, limit: { type: 'number' }
            }, required: ['seedIds']
        } },
    // Working memory (5 tools)
    { name: 'memory_scratch_set', description: 'Set scratchpad value with optional TTL', inputSchema: {
            type: 'object', properties: {
                key: { type: 'string' }, value: { type: 'string' }, ttlSeconds: { type: 'number', description: 'Expiry in seconds' }
            }, required: ['key', 'value']
        } },
    { name: 'memory_scratch_get', description: 'Get scratchpad value', inputSchema: {
            type: 'object', properties: { key: { type: 'string' } }, required: ['key']
        } },
    { name: 'memory_scratch_delete', description: 'Delete scratchpad key', inputSchema: {
            type: 'object', properties: { key: { type: 'string' } }, required: ['key']
        } },
    { name: 'memory_scratch_clear', description: 'Clear all scratchpad', inputSchema: { type: 'object', properties: {} } },
    { name: 'memory_scratch_list', description: 'List scratchpad keys', inputSchema: { type: 'object', properties: {} } },
    // Session (1 tool)
    { name: 'memory_briefing', description: 'Generate session briefing with memories and entities', inputSchema: {
            type: 'object', properties: { maxTokens: { type: 'number', default: 500 } }
        } },
    // NEW: Knowledge Graph Entities (4 tools)
    { name: 'memory_entity_create', description: 'Create or update a knowledge graph entity. If entity exists, observations are merged.', inputSchema: {
            type: 'object', properties: {
                name: { type: 'string', description: 'Unique entity name (e.g., "Eric", "EvoSteward", "Python")' },
                entityType: { type: 'string', description: 'Entity type (e.g., "person", "project", "technology", "concept")' },
                observations: { type: 'array', items: { type: 'string' }, description: 'Facts/observations about this entity' }
            }, required: ['name']
        } },
    { name: 'memory_entity_get', description: 'Get entity by name with all relations', inputSchema: {
            type: 'object', properties: {
                name: { type: 'string', description: 'Entity name to retrieve' }
            }, required: ['name']
        } },
    { name: 'memory_entity_link', description: 'Create a relation between two entities. Use active voice (e.g., "works_at", "knows", "created_by")', inputSchema: {
            type: 'object', properties: {
                from: { type: 'string', description: 'Source entity name' },
                to: { type: 'string', description: 'Target entity name' },
                relationType: { type: 'string', description: 'Relation type in active voice (e.g., "works_at", "knows", "uses")' }
            }, required: ['from', 'to', 'relationType']
        } },
    { name: 'memory_entity_search', description: 'Search entities by name or observation content', inputSchema: {
            type: 'object', properties: {
                query: { type: 'string', description: 'Search query' },
                entityType: { type: 'string', description: 'Filter by entity type' },
                limit: { type: 'number', default: 20 }
            }, required: ['query']
        } },
    { name: 'memory_entity_observe', description: 'Add observations to an existing entity', inputSchema: {
            type: 'object', properties: {
                name: { type: 'string', description: 'Entity name' },
                observations: { type: 'array', items: { type: 'string' }, description: 'New observations to add' }
            }, required: ['name', 'observations']
        } },
    { name: 'memory_entity_delete', description: 'Delete an entity and all its relations', inputSchema: {
            type: 'object', properties: {
                name: { type: 'string', description: 'Entity name to delete' }
            }, required: ['name']
        } }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args || {});
    try {
        let result;
        switch (name) {
            // Core memory
            case 'memory_store':
                result = storeMemory(a.content, a.type, a.tags, a.importance, a.confidence);
                break;
            case 'memory_recall':
                result = recallMemory(a.id);
                break;
            case 'memory_update':
                result = updateMemory(a.id, { content: a.content, type: a.type, tags: a.tags, importance: a.importance, confidence: a.confidence });
                break;
            case 'memory_search':
                result = searchMemories(a.query, a.limit, a.confidenceThreshold);
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
            // Edges (for memories)
            case 'memory_edge_create':
                result = createEdge(a.fromId, a.toId, a.relationType, a.validFrom, a.validTo, a.confidence, a.metadata);
                break;
            case 'memory_edge_query':
                result = queryEdges(a.memoryId, a.direction, a.relationTypes, a.asOfDate, a.includeExpired, a.limit);
                break;
            case 'memory_edge_invalidate':
                result = invalidateEdge(a.edgeId, a.validTo);
                break;
            // Graph traversal
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
            // NEW: Entity operations
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
            default: throw new Error(`Unknown tool: ${name}`);
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
});
// ============================================================================
// Startup
// ============================================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Just-Memory v1.7 running (Knowledge Graph Entity Layer)');
}
main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
