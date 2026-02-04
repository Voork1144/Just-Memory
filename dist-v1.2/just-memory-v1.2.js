/**
 * Just-Memory v1.2 - Bi-Temporal Edges Extension
 *
 * Extends v1.0 with temporal relationship tracking:
 * - Edges table with validFrom/validTo timestamps
 * - Point-in-time queries for relationship state
 * - Edge invalidation for relationship changes
 *
 * Based on Zep/Graphiti architecture (arXiv:2501.13956)
 * Benchmark target: 94.8% accuracy on Deep Memory Retrieval
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
// Database Setup
// ============================================================================
const DB_PATH = join(homedir(), '.just-memory', 'memories.db');
const DB_DIR = dirname(DB_PATH);
if (!existsSync(DB_DIR))
    mkdirSync(DB_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// Memories table (unchanged from v1)
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
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at);
`);
// Bi-temporal edges table (NEW in v1.2)
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
// ============================================================================
// Ebbinghaus Decay Functions (unchanged from v1)
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
// Core Memory Operations (unchanged from v1)
// ============================================================================
function storeMemory(content, type = 'note', tags = [], importance = 0.5) {
    const id = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO memories (id, content, type, tags, importance) VALUES (?, ?, ?, ?, ?)`)
        .run(id, content, type, JSON.stringify(tags), importance);
    return { id, content, type, tags, importance, strength: 1.0 };
}
function recallMemory(id) {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!memory)
        return { error: 'Memory not found', id };
    const newStrength = updateStrength(memory.strength, memory.access_count);
    db.prepare(`UPDATE memories SET access_count = access_count + 1, strength = ?, last_accessed = datetime('now') WHERE id = ?`)
        .run(newStrength, id);
    const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return {
        id: updated.id, content: updated.content, type: updated.type,
        tags: JSON.parse(updated.tags), importance: updated.importance,
        strength: updated.strength, access_count: updated.access_count,
        created_at: updated.created_at, last_accessed: updated.last_accessed,
        retention: calculateRetention(updated.last_accessed, updated.strength)
    };
}
function searchMemories(query, limit = 10) {
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND content LIKE ? ORDER BY importance DESC, last_accessed DESC LIMIT ?`)
        .all(`%${query}%`, limit);
    return rows.map(m => ({ ...m, tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength) }))
        .filter(m => m.retention > 0.1);
}
function listMemories(limit = 20, includeWeak = false) {
    const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT ?`).all(limit);
    return rows.map(m => ({ ...m, tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength) }))
        .filter(m => includeWeak || m.retention > 0.1);
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
    const active = listMemories(1000, false).length;
    const edgeCount = db.prepare('SELECT COUNT(*) as count FROM edges WHERE valid_to IS NULL').get().count;
    const expiredEdges = db.prepare('SELECT COUNT(*) as count FROM edges WHERE valid_to IS NOT NULL').get().count;
    return { total, activeAboveThreshold: active, activeEdges: edgeCount, expiredEdges, dbPath: DB_PATH };
}
// ============================================================================
// Bi-Temporal Edge Operations (NEW in v1.2)
// ============================================================================
/**
 * Create a temporal edge between two memories
 * validFrom defaults to now, validTo null means "still valid"
 */
function createEdge(fromId, toId, relationType, validFrom, validTo, confidence = 1.0, metadata = {}) {
    // Verify both memories exist
    const fromExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(fromId);
    const toExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(toId);
    if (!fromExists)
        return { error: `Source memory not found: ${fromId}` };
    if (!toExists)
        return { error: `Target memory not found: ${toId}` };
    const id = randomUUID().replace(/-/g, '');
    const validFromDate = validFrom || new Date().toISOString();
    db.prepare(`
    INSERT INTO edges (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, fromId, toId, relationType, validFromDate, validTo || null, confidence, JSON.stringify(metadata));
    return {
        id, fromId, toId, relationType,
        validFrom: validFromDate, validTo: validTo || null,
        confidence, metadata
    };
}
/**
 * Query edges with optional temporal filters
 * asOfDate: point-in-time query (returns edges valid at that moment)
 * includeExpired: include edges that have been invalidated
 */
function queryEdges(memoryId, direction = 'both', relationTypes, asOfDate, includeExpired = false, limit = 50) {
    let sql = 'SELECT * FROM edges WHERE 1=1';
    const params = [];
    // Direction filter
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
    // Relation type filter
    if (relationTypes && relationTypes.length > 0) {
        sql += ` AND relation_type IN (${relationTypes.map(() => '?').join(',')})`;
        params.push(...relationTypes);
    }
    // Temporal filter: point-in-time query
    if (asOfDate) {
        sql += ' AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)';
        params.push(asOfDate, asOfDate);
    }
    else if (!includeExpired) {
        sql += ' AND valid_to IS NULL';
    }
    sql += ' ORDER BY valid_from DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map(e => ({
        ...e,
        metadata: JSON.parse(e.metadata)
    }));
}
/**
 * Invalidate an edge by setting valid_to timestamp
 * Used when relationships change (e.g., Alice no longer manages Bob)
 */
function invalidateEdge(edgeId, validTo) {
    const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
    if (!edge)
        return { error: `Edge not found: ${edgeId}` };
    if (edge.valid_to)
        return { error: 'Edge already invalidated', invalidatedAt: edge.valid_to };
    const invalidationTime = validTo || new Date().toISOString();
    db.prepare('UPDATE edges SET valid_to = ? WHERE id = ?').run(invalidationTime, edgeId);
    return {
        id: edgeId,
        invalidated: true,
        validTo: invalidationTime,
        relationType: edge.relation_type,
        fromId: edge.from_id,
        toId: edge.to_id
    };
}
// ============================================================================
// MCP Server Setup (expanded with edge tools)
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.2.0' }, { capabilities: { tools: {} } });
const TOOLS = [
    // Original v1 memory tools
    { name: 'memory_store', description: 'Store a new memory with optional type and tags', inputSchema: {
            type: 'object', properties: {
                content: { type: 'string', description: 'Memory content to store' },
                type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number', minimum: 0, maximum: 1 }
            }, required: ['content']
        } },
    { name: 'memory_recall', description: 'Recall a memory by ID (strengthens it)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' } }, required: ['id']
        } },
    { name: 'memory_search', description: 'Search memories by content', inputSchema: {
            type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', default: 10 } }, required: ['query']
        } },
    { name: 'memory_list', description: 'List recent memories above retention threshold', inputSchema: {
            type: 'object', properties: {
                limit: { type: 'number', default: 20 },
                includeWeak: { type: 'boolean', description: 'Include memories below retention threshold' }
            }
        } },
    { name: 'memory_delete', description: 'Delete a memory (soft delete by default)', inputSchema: {
            type: 'object', properties: { id: { type: 'string' }, permanent: { type: 'boolean' } }, required: ['id']
        } },
    { name: 'memory_stats', description: 'Get memory and edge statistics', inputSchema: { type: 'object', properties: {} } },
    // NEW v1.2 bi-temporal edge tools
    { name: 'memory_edge_create', description: 'Create a temporal relationship between two memories. Use validFrom/validTo for time-bound relationships.', inputSchema: {
            type: 'object', properties: {
                fromId: { type: 'string', description: 'Source memory ID' },
                toId: { type: 'string', description: 'Target memory ID' },
                relationType: { type: 'string', description: 'Relationship type (e.g., "manages", "works_on", "related_to")' },
                validFrom: { type: 'string', description: 'ISO timestamp when relationship started (defaults to now)' },
                validTo: { type: 'string', description: 'ISO timestamp when relationship ended (null = ongoing)' },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score (0-1)' },
                metadata: { type: 'object', description: 'Additional edge properties' }
            }, required: ['fromId', 'toId', 'relationType']
        } },
    { name: 'memory_edge_query', description: 'Query relationships with temporal filters. Use asOfDate for point-in-time queries.', inputSchema: {
            type: 'object', properties: {
                memoryId: { type: 'string', description: 'Memory ID to find relationships for' },
                direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], description: 'Relationship direction' },
                relationTypes: { type: 'array', items: { type: 'string' }, description: 'Filter by relationship types' },
                asOfDate: { type: 'string', description: 'Point-in-time query (ISO timestamp)' },
                includeExpired: { type: 'boolean', description: 'Include invalidated relationships' },
                limit: { type: 'number', default: 50 }
            }
        } },
    { name: 'memory_edge_invalidate', description: 'Mark a relationship as no longer valid (sets valid_to timestamp)', inputSchema: {
            type: 'object', properties: {
                edgeId: { type: 'string', description: 'Edge ID to invalidate' },
                validTo: { type: 'string', description: 'ISO timestamp when relationship ended (defaults to now)' }
            }, required: ['edgeId']
        } }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args || {});
    try {
        let result;
        switch (name) {
            // Original memory tools
            case 'memory_store':
                result = storeMemory(a.content, a.type, a.tags, a.importance);
                break;
            case 'memory_recall':
                result = recallMemory(a.id);
                break;
            case 'memory_search':
                result = searchMemories(a.query, a.limit);
                break;
            case 'memory_list':
                result = listMemories(a.limit, a.includeWeak);
                break;
            case 'memory_delete':
                result = deleteMemory(a.id, a.permanent);
                break;
            case 'memory_stats':
                result = getStats();
                break;
            // New edge tools
            case 'memory_edge_create':
                result = createEdge(a.fromId, a.toId, a.relationType, a.validFrom, a.validTo, a.confidence, a.metadata);
                break;
            case 'memory_edge_query':
                result = queryEdges(a.memoryId, a.direction, a.relationTypes, a.asOfDate, a.includeExpired, a.limit);
                break;
            case 'memory_edge_invalidate':
                result = invalidateEdge(a.edgeId, a.validTo);
                break;
            default: throw new Error(`Unknown tool: ${name}`);
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
});
// ============================================================================
// Startup
// ============================================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Just-Memory v1.2 running (Ebbinghaus decay + bi-temporal edges)');
}
main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
