/**
 * Just-Memory v1.5 - Complete Memory System
 *
 * Adds to v1.4:
 * - Working memory/scratchpad (ephemeral key-value with TTL)
 * - Auto-contradiction detection on store
 * - Session briefings
 *
 * Complete tool set for EvoSteward integration.
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
// NEW v1.5: Working memory/scratchpad
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
// Auto-Contradiction Detection (NEW v1.5)
// ============================================================================
function findContradictions(content, limit = 5) {
    // Simple keyword overlap + negation detection
    const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    if (words.length === 0)
        return [];
    const negations = ['not', 'no', 'never', 'none', 'neither', "don't", "doesn't", "isn't", "aren't", "wasn't", "weren't"];
    const hasNegation = negations.some(n => content.toLowerCase().includes(n));
    // Find memories with high keyword overlap
    const allMemories = db.prepare('SELECT * FROM memories WHERE deleted_at IS NULL').all();
    const scored = allMemories.map(m => {
        const mWords = m.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        const overlap = words.filter(w => mWords.includes(w)).length;
        const mHasNegation = negations.some(n => m.content.toLowerCase().includes(n));
        // Potential contradiction if high overlap AND different negation status
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
    const id = randomUUID().replace(/-/g, '');
    // Auto-detect contradictions
    const contradictions = findContradictions(content);
    let adjustedConfidence = confidence;
    if (contradictions.length > 0) {
        adjustedConfidence = Math.max(0.2, confidence - 0.1 * contradictions.length);
    }
    db.prepare(`INSERT INTO memories (id, content, type, tags, importance, confidence) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, content, type, JSON.stringify(tags), importance, adjustedConfidence);
    // Create contradiction edges
    for (const c of contradictions) {
        const edgeId = randomUUID().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'potential_contradiction', 0.5)`)
            .run(edgeId, id, c.id);
    }
    return {
        id, content, type, tags, importance,
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
function searchMemories(query, limit = 10, confidenceThreshold = 0) {
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND content LIKE ? ORDER BY confidence DESC, importance DESC LIMIT ?`)
        .all(`%${query}%`, limit * 2);
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
    return { total, byConfidenceLevel: byConfidence, activeEdges: edges, scratchpadItems: scratch, dbPath: DB_PATH, version: '1.5.0' };
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
// Edge Operations
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
// Working Memory / Scratchpad (NEW v1.5)
// ============================================================================
function scratchSet(key, value, ttlSeconds) {
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
    // Clean expired first
    db.prepare('DELETE FROM scratchpad WHERE expires_at IS NOT NULL AND expires_at < datetime("now")').run();
    const rows = db.prepare('SELECT key, expires_at, created_at FROM scratchpad').all();
    return rows;
}
// ============================================================================
// Session Briefing (NEW v1.5)
// ============================================================================
function generateBriefing(maxTokens = 500) {
    // Get high-confidence recent memories
    const recent = db.prepare(`
    SELECT * FROM memories WHERE deleted_at IS NULL 
    ORDER BY last_accessed DESC LIMIT 10
  `).all();
    // Get high-importance memories
    const important = db.prepare(`
    SELECT * FROM memories WHERE deleted_at IS NULL AND importance >= 0.7
    ORDER BY confidence DESC LIMIT 5
  `).all();
    // Get active working memory
    const scratch = scratchList();
    // Build briefing
    const sections = [];
    if (recent.length > 0) {
        const recentItems = recent.slice(0, 5).map(m => `- ${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}`);
        sections.push(`**Recent Context:**\n${recentItems.join('\n')}`);
    }
    if (important.length > 0) {
        const importantItems = important.slice(0, 3).map(m => `- [${(m.confidence * 100).toFixed(0)}%] ${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}`);
        sections.push(`**Key Facts:**\n${importantItems.join('\n')}`);
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
        scratchpadCount: scratch.length
    };
}
// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.5.0' }, { capabilities: { tools: {} } });
const TOOLS = [
    // Core memory (6 tools)
    { name: 'memory_store', description: 'Store memory with auto-contradiction detection', inputSchema: {
            type: 'object', properties: {
                content: { type: 'string' }, type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
                tags: { type: 'array', items: { type: 'string' } }, importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Initial confidence (0-1)' }
            }, required: ['content']
        } },
    { name: 'memory_recall', description: 'Recall by ID (strengthens memory)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' } }, required: ['id']
        } },
    { name: 'memory_search', description: 'Search with confidence filtering', inputSchema: {
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
    { name: 'memory_stats', description: 'Get statistics', inputSchema: { type: 'object', properties: {} } },
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
    { name: 'memory_edge_create', description: 'Create temporal relationship', inputSchema: {
            type: 'object', properties: {
                fromId: { type: 'string' }, toId: { type: 'string' }, relationType: { type: 'string' },
                validFrom: { type: 'string' }, validTo: { type: 'string' }, confidence: { type: 'number' }, metadata: { type: 'object' }
            }, required: ['fromId', 'toId', 'relationType']
        } },
    { name: 'memory_edge_query', description: 'Query relationships', inputSchema: {
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
    { name: 'memory_graph_traverse', description: 'Spreading activation traversal', inputSchema: {
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
    { name: 'memory_briefing', description: 'Generate session briefing', inputSchema: {
            type: 'object', properties: { maxTokens: { type: 'number', default: 500 } }
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
    console.error('Just-Memory v1.5 running (Ebbinghaus + bi-temporal + confidence + scratchpad)');
}
main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
