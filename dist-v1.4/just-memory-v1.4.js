/**
 * Just-Memory v1.4 - Confidence Thresholds Extension
 *
 * Extends v1.3 with "Feeling of Knowing" protocol:
 * - Confidence scoring for memories and recall
 * - Uncertainty acknowledgment when confidence < threshold
 * - Multi-source confirmation boosts confidence
 * - Contradiction detection lowers confidence
 *
 * Key insight: Systems should express uncertainty proportional to their actual confidence.
 * This prevents hallucination by making the system aware of its own knowledge gaps.
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
    HIGH: 0.8, // Highly confident, multiple confirmations
    MEDIUM: 0.5, // Reasonably confident, some corroboration
    LOW: 0.3, // Low confidence, limited evidence
    UNCERTAIN: 0.0 // Below this, explicitly acknowledge uncertainty
};
const CONFIDENCE_BOOST = {
    CONFIRMATION: 0.15, // Each confirming source adds this
    RECENT_ACCESS: 0.05, // Recent recall boosts confidence
    HIGH_IMPORTANCE: 0.1, // Important memories get slight boost
};
const CONFIDENCE_PENALTY = {
    CONTRADICTION: 0.2, // Each contradiction subtracts this
    DECAY_PER_DAY: 0.01, // Confidence decays over time without access
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
// Memories table with confidence columns
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
// Bi-temporal edges table (from v1.2)
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
  CREATE INDEX IF NOT EXISTS idx_edges_valid ON edges(valid_from, valid_to);
`);
// Ensure new columns exist (for upgrades from earlier versions)
try {
    db.exec(`ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 0.5`);
}
catch { /* Column exists */ }
try {
    db.exec(`ALTER TABLE memories ADD COLUMN source_count INTEGER DEFAULT 1`);
}
catch { /* Column exists */ }
try {
    db.exec(`ALTER TABLE memories ADD COLUMN contradiction_count INTEGER DEFAULT 0`);
}
catch { /* Column exists */ }
// ============================================================================
// Ebbinghaus Decay Functions
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
// Confidence Functions (NEW in v1.4)
// ============================================================================
/**
 * Calculate effective confidence with decay and modifiers
 */
function calculateEffectiveConfidence(memory) {
    let confidence = memory.confidence;
    // Time decay: confidence decreases if not accessed recently
    const daysSinceAccess = (Date.now() - new Date(memory.last_accessed).getTime()) / 86400000;
    confidence -= daysSinceAccess * CONFIDENCE_PENALTY.DECAY_PER_DAY;
    // Boost from multiple sources
    confidence += (memory.source_count - 1) * CONFIDENCE_BOOST.CONFIRMATION;
    // Penalty from contradictions
    confidence -= memory.contradiction_count * CONFIDENCE_PENALTY.CONTRADICTION;
    // Boost for high importance
    if (memory.importance > 0.7) {
        confidence += CONFIDENCE_BOOST.HIGH_IMPORTANCE;
    }
    // Clamp to valid range
    return Math.max(0, Math.min(1, confidence));
}
/**
 * Determine confidence level and generate uncertainty note
 */
function assessConfidence(memory) {
    const confidence = calculateEffectiveConfidence(memory);
    if (confidence >= CONFIDENCE_LEVELS.HIGH) {
        return { level: 'high' };
    }
    if (confidence >= CONFIDENCE_LEVELS.MEDIUM) {
        return { level: 'medium' };
    }
    if (confidence >= CONFIDENCE_LEVELS.LOW) {
        return {
            level: 'low',
            note: 'This information has limited corroboration.'
        };
    }
    // Generate uncertainty note based on why confidence is low
    let note = 'This information may not be accurate.';
    if (memory.contradiction_count > 0) {
        note = `This information has ${memory.contradiction_count} conflicting source(s). Verify before relying on it.`;
    }
    else if (memory.source_count === 1) {
        note = 'This is from a single source without independent confirmation.';
    }
    return { level: 'uncertain', note };
}
/**
 * Convert memory row to confident memory format
 */
function toConfidentMemory(memory) {
    const assessment = assessConfidence(memory);
    const confidence = calculateEffectiveConfidence(memory);
    return {
        id: memory.id,
        content: memory.content,
        confidence,
        confidenceLevel: assessment.level,
        uncertaintyNote: assessment.note,
        confirmingSources: memory.source_count,
        contradictions: memory.contradiction_count
    };
}
// ============================================================================
// Core Memory Operations (enhanced with confidence)
// ============================================================================
function storeMemory(content, type = 'note', tags = [], importance = 0.5, confidence = 0.5) {
    const id = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO memories (id, content, type, tags, importance, confidence) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, content, type, JSON.stringify(tags), importance, confidence);
    return { id, content, type, tags, importance, strength: 1.0, confidence };
}
function recallMemory(id) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newStrength = updateStrength(memory.strength, memory.access_count);
    // Slight confidence boost on recall
    const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.RECENT_ACCESS);
    db.prepare(`UPDATE memories SET access_count = access_count + 1, strength = ?, confidence = ?, last_accessed = datetime('now') WHERE id = ?`)
        .run(newStrength, newConfidence, id);
    const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    const confident = toConfidentMemory(updated);
    return {
        ...confident,
        type: updated.type,
        tags: JSON.parse(updated.tags),
        importance: updated.importance,
        strength: updated.strength,
        access_count: updated.access_count,
        created_at: updated.created_at,
        last_accessed: updated.last_accessed,
        retention: calculateRetention(updated.last_accessed, updated.strength)
    };
}
function searchMemories(query, limit = 10, confidenceThreshold = 0) {
    const rows = db.prepare(`
    SELECT * FROM memories 
    WHERE deleted_at IS NULL AND content LIKE ? 
    ORDER BY confidence DESC, importance DESC, last_accessed DESC 
    LIMIT ?
  `).all(`%${query}%`, limit * 2); // Fetch extra to filter
    return rows
        .map(m => ({
        ...toConfidentMemory(m),
        tags: JSON.parse(m.tags),
        retention: calculateRetention(m.last_accessed, m.strength)
    }))
        .filter(m => m.retention > 0.1 && m.confidence >= confidenceThreshold)
        .slice(0, limit);
}
function listMemories(limit = 20, includeWeak = false, includeUncertain = false) {
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT ?`).all(limit * 2);
    return rows
        .map(m => ({
        ...toConfidentMemory(m),
        tags: JSON.parse(m.tags),
        retention: calculateRetention(m.last_accessed, m.strength)
    }))
        .filter(m => {
        if (!includeWeak && m.retention <= 0.1)
            return false;
        if (!includeUncertain && m.confidenceLevel === 'uncertain')
            return false;
        return true;
    })
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
    SELECT 
      SUM(CASE WHEN confidence >= 0.8 THEN 1 ELSE 0 END) as high,
      SUM(CASE WHEN confidence >= 0.5 AND confidence < 0.8 THEN 1 ELSE 0 END) as medium,
      SUM(CASE WHEN confidence >= 0.3 AND confidence < 0.5 THEN 1 ELSE 0 END) as low,
      SUM(CASE WHEN confidence < 0.3 THEN 1 ELSE 0 END) as uncertain
    FROM memories WHERE deleted_at IS NULL
  `).get();
    const edgeCount = db.prepare('SELECT COUNT(*) as count FROM edges WHERE valid_to IS NULL').get().count;
    return {
        total,
        byConfidenceLevel: byConfidence,
        activeEdges: edgeCount,
        dbPath: DB_PATH
    };
}
// ============================================================================
// Confidence Management Tools (NEW in v1.4)
// ============================================================================
/**
 * Add a confirming source to a memory (increases confidence)
 */
function confirmMemory(id, sourceId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newSourceCount = memory.source_count + 1;
    const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.CONFIRMATION);
    db.prepare(`UPDATE memories SET source_count = ?, confidence = ? WHERE id = ?`)
        .run(newSourceCount, newConfidence, id);
    // Optionally create a "confirms" edge
    if (sourceId) {
        const edgeId = randomUUID().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'confirms', 1.0)`)
            .run(edgeId, sourceId, id);
    }
    return {
        id,
        newConfidence,
        newSourceCount,
        message: 'Memory confidence increased'
    };
}
/**
 * Record a contradiction (decreases confidence)
 */
function contradictMemory(id, contradictingId) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newContradictionCount = memory.contradiction_count + 1;
    const newConfidence = Math.max(0, memory.confidence - CONFIDENCE_PENALTY.CONTRADICTION);
    db.prepare(`UPDATE memories SET contradiction_count = ?, confidence = ? WHERE id = ?`)
        .run(newContradictionCount, newConfidence, id);
    // Create a "contradicts" edge
    if (contradictingId) {
        const edgeId = randomUUID().replace(/-/g, '');
        db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'contradicts', 1.0)`)
            .run(edgeId, contradictingId, id);
    }
    return {
        id,
        newConfidence,
        newContradictionCount,
        message: newConfidence < CONFIDENCE_LEVELS.LOW
            ? 'Warning: Memory confidence is now very low. Consider reviewing or deleting.'
            : 'Memory confidence decreased due to contradiction'
    };
}
/**
 * Get memories with confidence assessment and filter by threshold
 */
function getConfidentMemories(confidenceThreshold = CONFIDENCE_LEVELS.MEDIUM, limit = 20) {
    const rows = db.prepare(`
    SELECT * FROM memories 
    WHERE deleted_at IS NULL 
    ORDER BY confidence DESC, last_accessed DESC 
    LIMIT ?
  `).all(limit * 2);
    return rows
        .map(toConfidentMemory)
        .filter(m => m.confidence >= confidenceThreshold)
        .slice(0, limit);
}
// ============================================================================
// Edge Operations (from v1.2, unchanged)
// ============================================================================
function createEdge(fromId, toId, relationType, validFrom, validTo, confidence = 1.0, metadata = {}) {
    const fromExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(fromId);
    const toExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(toId);
    if (!fromExists)
        return { error: `Source memory not found: ${fromId}` };
    if (!toExists)
        return { error: `Target memory not found: ${toId}` };
    const id = randomUUID().replace(/-/g, '');
    const validFromDate = validFrom || new Date().toISOString();
    db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, fromId, toId, relationType, validFromDate, validTo || null, confidence, JSON.stringify(metadata));
    return { id, fromId, toId, relationType, validFrom: validFromDate, validTo: validTo || null, confidence, metadata };
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
        return { error: 'Edge already invalidated', invalidatedAt: edge.valid_to };
    const invalidationTime = validTo || new Date().toISOString();
    db.prepare('UPDATE edges SET valid_to = ? WHERE id = ?').run(invalidationTime, edgeId);
    return { id: edgeId, invalidated: true, validTo: invalidationTime };
}
// ============================================================================
// Spreading Activation (from v1.3, unchanged)
// ============================================================================
function spreadingActivation(seedIds, maxHops = 3, decayFactor = 0.5, inhibitionThreshold = 1.0, minActivation = 0.1, asOfDate) {
    const activations = new Map();
    for (const seedId of seedIds) {
        activations.set(seedId, { activation: 1.0, depth: 0, path: [seedId], edgeTypes: [] });
    }
    const frontier = [...seedIds.map(id => ({ id, depth: 0, activation: 1.0, path: [id], edgeTypes: [] }))];
    while (frontier.length > 0) {
        const current = frontier.shift();
        if (current.depth >= maxHops || current.activation < minActivation)
            continue;
        const edges = queryEdges(current.id, 'both', undefined, asOfDate, false, 100);
        const activationPerEdge = (current.activation * decayFactor) / Math.max(1, edges.length);
        for (const edge of edges) {
            const neighborId = edge.from_id === current.id ? edge.to_id : edge.from_id;
            if (current.path.includes(neighborId))
                continue;
            const newActivation = activationPerEdge * edge.confidence;
            if (newActivation < minActivation)
                continue;
            const existing = activations.get(neighborId);
            if (existing) {
                const combinedActivation = Math.min(existing.activation + newActivation, inhibitionThreshold);
                if (combinedActivation > existing.activation) {
                    activations.set(neighborId, {
                        activation: combinedActivation,
                        depth: Math.min(existing.depth, current.depth + 1),
                        path: existing.activation < newActivation ? [...current.path, neighborId] : existing.path,
                        edgeTypes: existing.activation < newActivation ? [...current.edgeTypes, edge.relation_type] : existing.edgeTypes
                    });
                }
            }
            else {
                activations.set(neighborId, {
                    activation: newActivation,
                    depth: current.depth + 1,
                    path: [...current.path, neighborId],
                    edgeTypes: [...current.edgeTypes, edge.relation_type]
                });
                frontier.push({ id: neighborId, depth: current.depth + 1, activation: newActivation, path: [...current.path, neighborId], edgeTypes: [...current.edgeTypes, edge.relation_type] });
            }
        }
    }
    const results = [];
    for (const [id, data] of activations) {
        const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
        if (memory) {
            const confident = toConfidentMemory(memory);
            results.push({ ...confident, activation: data.activation, depth: data.depth, path: data.path, edgeTypes: data.edgeTypes });
        }
    }
    return results.sort((a, b) => b.activation - a.activation);
}
// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.4.0' }, { capabilities: { tools: {} } });
const TOOLS = [
    // Core memory tools
    { name: 'memory_store', description: 'Store a new memory with optional confidence', inputSchema: {
            type: 'object', properties: {
                content: { type: 'string' },
                type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Initial confidence (0=uncertain, 1=certain)' }
            }, required: ['content']
        } },
    { name: 'memory_recall', description: 'Recall a memory by ID. Returns confidence assessment.', inputSchema: {
            type: 'object', properties: { id: { type: 'string' } }, required: ['id']
        } },
    { name: 'memory_search', description: 'Search memories with confidence filtering', inputSchema: {
            type: 'object', properties: {
                query: { type: 'string' },
                limit: { type: 'number', default: 10 },
                confidenceThreshold: { type: 'number', default: 0, description: 'Only return memories above this confidence' }
            }, required: ['query']
        } },
    { name: 'memory_list', description: 'List recent memories with confidence assessment', inputSchema: {
            type: 'object', properties: {
                limit: { type: 'number', default: 20 },
                includeWeak: { type: 'boolean' },
                includeUncertain: { type: 'boolean', description: 'Include memories with very low confidence' }
            }
        } },
    { name: 'memory_delete', description: 'Delete a memory', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, permanent: { type: 'boolean' } }, required: ['id']
        } },
    { name: 'memory_stats', description: 'Get statistics including confidence distribution', inputSchema: { type: 'object', properties: {} } },
    // Edge tools
    { name: 'memory_edge_create', description: 'Create temporal relationship', inputSchema: {
            type: 'object', properties: {
                fromId: { type: 'string' }, toId: { type: 'string' }, relationType: { type: 'string' },
                validFrom: { type: 'string' }, validTo: { type: 'string' },
                confidence: { type: 'number' }, metadata: { type: 'object' }
            }, required: ['fromId', 'toId', 'relationType']
        } },
    { name: 'memory_edge_query', description: 'Query relationships', inputSchema: {
            type: 'object', properties: {
                memoryId: { type: 'string' }, direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'] },
                relationTypes: { type: 'array', items: { type: 'string' } },
                asOfDate: { type: 'string' }, includeExpired: { type: 'boolean' }, limit: { type: 'number' }
            }
        } },
    { name: 'memory_edge_invalidate', description: 'Invalidate relationship', inputSchema: {
            type: 'object', properties: { edgeId: { type: 'string' }, validTo: { type: 'string' } }, required: ['edgeId']
        } },
    // Spreading activation
    { name: 'memory_graph_traverse', description: 'Traverse graph with spreading activation', inputSchema: {
            type: 'object', properties: {
                seedIds: { type: 'array', items: { type: 'string' } },
                maxHops: { type: 'number' }, decayFactor: { type: 'number' },
                inhibitionThreshold: { type: 'number' }, minActivation: { type: 'number' },
                asOfDate: { type: 'string' }, limit: { type: 'number' }
            }, required: ['seedIds']
        } },
    // NEW v1.4: Confidence management tools
    { name: 'memory_confirm', description: 'Add a confirming source to increase memory confidence', inputSchema: {
            type: 'object', properties: {
                id: { type: 'string', description: 'Memory ID to confirm' },
                sourceId: { type: 'string', description: 'Optional: ID of confirming memory (creates edge)' }
            }, required: ['id']
        } },
    { name: 'memory_contradict', description: 'Record a contradiction to decrease memory confidence', inputSchema: {
            type: 'object', properties: {
                id: { type: 'string', description: 'Memory ID being contradicted' },
                contradictingId: { type: 'string', description: 'Optional: ID of contradicting memory (creates edge)' }
            }, required: ['id']
        } },
    { name: 'memory_confident', description: 'Get memories filtered by confidence threshold. Use to find high-certainty facts.', inputSchema: {
            type: 'object', properties: {
                confidenceThreshold: { type: 'number', default: 0.5, description: '0.8=high, 0.5=medium, 0.3=low' },
                limit: { type: 'number', default: 20 }
            }
        } }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args || {});
    try {
        let result;
        switch (name) {
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
            case 'memory_edge_create':
                result = createEdge(a.fromId, a.toId, a.relationType, a.validFrom, a.validTo, a.confidence, a.metadata);
                break;
            case 'memory_edge_query':
                result = queryEdges(a.memoryId, a.direction, a.relationTypes, a.asOfDate, a.includeExpired, a.limit);
                break;
            case 'memory_edge_invalidate':
                result = invalidateEdge(a.edgeId, a.validTo);
                break;
            case 'memory_graph_traverse':
                result = spreadingActivation(a.seedIds, a.maxHops, a.decayFactor, a.inhibitionThreshold, a.minActivation, a.asOfDate).slice(0, a.limit || 20);
                break;
            case 'memory_confirm':
                result = confirmMemory(a.id, a.sourceId);
                break;
            case 'memory_contradict':
                result = contradictMemory(a.id, a.contradictingId);
                break;
            case 'memory_confident':
                result = getConfidentMemories(a.confidenceThreshold, a.limit);
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
    console.error('Just-Memory v1.4 running (Ebbinghaus + bi-temporal + spreading activation + confidence thresholds)');
}
main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
