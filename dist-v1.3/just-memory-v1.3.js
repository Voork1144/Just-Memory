/**
 * Just-Memory v1.3 - Spreading Activation Extension
 *
 * Extends v1.2 with cognitive-inspired graph traversal:
 * - Spreading activation with decay
 * - Lateral inhibition to prevent hub explosion
 * - Multi-hop context gathering
 *
 * Based on Synapse architecture (arXiv:2601.02744)
 * Key insight: Traditional graph traversal over-weights hub nodes.
 * Solution: Activation decays through edges, inhibition limits runaway.
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
// Bi-Temporal Edge Operations (from v1.2)
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
    db.prepare(`
    INSERT INTO edges (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, fromId, toId, relationType, validFromDate, validTo || null, confidence, JSON.stringify(metadata));
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
    if (relationTypes && relationTypes.length > 0) {
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
    const rows = db.prepare(sql).all(...params);
    return rows.map(e => ({ ...e, metadata: JSON.parse(e.metadata) }));
}
function invalidateEdge(edgeId, validTo) {
    const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
    if (!edge)
        return { error: `Edge not found: ${edgeId}` };
    if (edge.valid_to)
        return { error: 'Edge already invalidated', invalidatedAt: edge.valid_to };
    const invalidationTime = validTo || new Date().toISOString();
    db.prepare('UPDATE edges SET valid_to = ? WHERE id = ?').run(invalidationTime, edgeId);
    return { id: edgeId, invalidated: true, validTo: invalidationTime, relationType: edge.relation_type, fromId: edge.from_id, toId: edge.to_id };
}
// ============================================================================
// Spreading Activation (NEW in v1.3)
// Based on arXiv:2601.02744 (Synapse) - Solves Hub Explosion Problem
// ============================================================================
/**
 * Spreading activation with decay and lateral inhibition
 *
 * Key parameters:
 * - decayFactor: Activation reduces by this factor per hop (0.5 = 50% decay)
 * - inhibitionThreshold: Max activation a node can receive from multiple paths
 * - minActivation: Stop spreading below this threshold
 */
function spreadingActivation(seedIds, maxHops = 3, decayFactor = 0.5, inhibitionThreshold = 1.0, // Lateral inhibition: cap total activation
minActivation = 0.1, asOfDate) {
    // Map to track activation levels: memoryId -> { activation, depth, path, edgeTypes }
    const activations = new Map();
    // Initialize seed nodes with full activation
    for (const seedId of seedIds) {
        activations.set(seedId, { activation: 1.0, depth: 0, path: [seedId], edgeTypes: [] });
    }
    // BFS with decay
    const frontier = [...seedIds.map(id => ({ id, depth: 0, activation: 1.0, path: [id], edgeTypes: [] }))];
    while (frontier.length > 0) {
        const current = frontier.shift();
        if (current.depth >= maxHops)
            continue;
        if (current.activation < minActivation)
            continue;
        // Get edges from current node (bidirectional)
        const edges = queryEdges(current.id, 'both', undefined, asOfDate, false, 100);
        // Calculate outgoing activation (decay + split among neighbors)
        const outgoingActivation = current.activation * decayFactor;
        // Hub explosion prevention: divide activation among edges
        const activationPerEdge = outgoingActivation / Math.max(1, edges.length);
        for (const edge of edges) {
            const neighborId = edge.from_id === current.id ? edge.to_id : edge.from_id;
            // Skip if neighbor is in current path (no cycles)
            if (current.path.includes(neighborId))
                continue;
            // Calculate new activation for neighbor
            const edgeWeight = edge.confidence;
            const newActivation = activationPerEdge * edgeWeight;
            if (newActivation < minActivation)
                continue;
            const existing = activations.get(neighborId);
            if (existing) {
                // LATERAL INHIBITION: Add activation but cap at threshold
                const combinedActivation = Math.min(existing.activation + newActivation, inhibitionThreshold);
                // Only update if this path provides more activation
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
                // New node
                activations.set(neighborId, {
                    activation: newActivation,
                    depth: current.depth + 1,
                    path: [...current.path, neighborId],
                    edgeTypes: [...current.edgeTypes, edge.relation_type]
                });
                // Add to frontier for further exploration
                frontier.push({
                    id: neighborId,
                    depth: current.depth + 1,
                    activation: newActivation,
                    path: [...current.path, neighborId],
                    edgeTypes: [...current.edgeTypes, edge.relation_type]
                });
            }
        }
    }
    // Convert to result format with memory content
    const results = [];
    for (const [id, data] of activations) {
        const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id);
        if (memory) {
            results.push({
                id: memory.id,
                content: memory.content,
                activation: data.activation,
                depth: data.depth,
                path: data.path,
                edgeTypes: data.edgeTypes
            });
        }
    }
    // Sort by activation (highest first)
    return results.sort((a, b) => b.activation - a.activation);
}
/**
 * Graph traversal starting from search results
 * Combines semantic search with spreading activation
 */
function searchWithActivation(query, seedLimit = 5, maxHops = 2, decayFactor = 0.5, limit = 20) {
    // Step 1: Find seed nodes via search
    const seeds = searchMemories(query, seedLimit);
    if (seeds.length === 0)
        return [];
    // Step 2: Spread activation from seeds
    const seedIds = seeds.map(s => s.id);
    const activated = spreadingActivation(seedIds, maxHops, decayFactor);
    // Step 3: Boost seed nodes (they matched the query directly)
    const seedSet = new Set(seedIds);
    for (const mem of activated) {
        if (seedSet.has(mem.id)) {
            mem.activation = Math.min(1.0, mem.activation * 1.5); // 50% boost for direct matches
        }
    }
    // Re-sort and limit
    return activated
        .sort((a, b) => b.activation - a.activation)
        .slice(0, limit);
}
// ============================================================================
// MCP Server Setup (expanded with spreading activation)
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.3.0' }, { capabilities: { tools: {} } });
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
    // v1.2 bi-temporal edge tools
    { name: 'memory_edge_create', description: 'Create a temporal relationship between two memories.', inputSchema: {
            type: 'object', properties: {
                fromId: { type: 'string', description: 'Source memory ID' },
                toId: { type: 'string', description: 'Target memory ID' },
                relationType: { type: 'string', description: 'Relationship type' },
                validFrom: { type: 'string', description: 'ISO timestamp when relationship started' },
                validTo: { type: 'string', description: 'ISO timestamp when relationship ended' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                metadata: { type: 'object' }
            }, required: ['fromId', 'toId', 'relationType']
        } },
    { name: 'memory_edge_query', description: 'Query relationships with temporal filters.', inputSchema: {
            type: 'object', properties: {
                memoryId: { type: 'string' },
                direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'] },
                relationTypes: { type: 'array', items: { type: 'string' } },
                asOfDate: { type: 'string' },
                includeExpired: { type: 'boolean' },
                limit: { type: 'number', default: 50 }
            }
        } },
    { name: 'memory_edge_invalidate', description: 'Mark a relationship as no longer valid', inputSchema: {
            type: 'object', properties: {
                edgeId: { type: 'string' },
                validTo: { type: 'string' }
            }, required: ['edgeId']
        } },
    // NEW v1.3 spreading activation tools
    { name: 'memory_graph_traverse', description: 'Traverse memory graph using spreading activation. Starts from seed nodes and propagates activation through edges with decay. Solves hub explosion via lateral inhibition.', inputSchema: {
            type: 'object', properties: {
                seedIds: { type: 'array', items: { type: 'string' }, description: 'Memory IDs to start activation from' },
                maxHops: { type: 'number', default: 3, description: 'Maximum graph traversal depth (1-5)' },
                decayFactor: { type: 'number', default: 0.5, description: 'Activation decay per hop (0-1, lower = faster decay)' },
                inhibitionThreshold: { type: 'number', default: 1.0, description: 'Max activation per node (prevents hub explosion)' },
                minActivation: { type: 'number', default: 0.1, description: 'Stop spreading below this activation level' },
                asOfDate: { type: 'string', description: 'Point-in-time query for edges' },
                limit: { type: 'number', default: 20 }
            }, required: ['seedIds']
        } },
    { name: 'memory_search_contextual', description: 'Search with automatic context expansion via spreading activation. Finds direct matches then spreads to related memories.', inputSchema: {
            type: 'object', properties: {
                query: { type: 'string', description: 'Search query' },
                seedLimit: { type: 'number', default: 5, description: 'Number of direct matches to use as seeds' },
                maxHops: { type: 'number', default: 2, description: 'Context expansion depth' },
                decayFactor: { type: 'number', default: 0.5, description: 'Context relevance decay' },
                limit: { type: 'number', default: 20, description: 'Max results to return' }
            }, required: ['query']
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
            // Edge tools
            case 'memory_edge_create':
                result = createEdge(a.fromId, a.toId, a.relationType, a.validFrom, a.validTo, a.confidence, a.metadata);
                break;
            case 'memory_edge_query':
                result = queryEdges(a.memoryId, a.direction, a.relationTypes, a.asOfDate, a.includeExpired, a.limit);
                break;
            case 'memory_edge_invalidate':
                result = invalidateEdge(a.edgeId, a.validTo);
                break;
            // NEW spreading activation tools
            case 'memory_graph_traverse':
                result = spreadingActivation(a.seedIds, a.maxHops || 3, a.decayFactor || 0.5, a.inhibitionThreshold || 1.0, a.minActivation || 0.1, a.asOfDate).slice(0, a.limit || 20);
                break;
            case 'memory_search_contextual':
                result = searchWithActivation(a.query, a.limit || 5, a.maxHops || 2, a.decayFactor || 0.5, a.limit || 20);
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
    console.error('Just-Memory v1.3 running (Ebbinghaus decay + bi-temporal edges + spreading activation)');
}
main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
