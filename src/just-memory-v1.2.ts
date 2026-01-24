/**
 * Just-Memory v1.2 - Knowledge Graph Edition
 * 
 * Adds relations between memories to form a knowledge graph.
 * Built on v1.1's Ebbinghaus decay + semantic search.
 * 
 * New features:
 * - Relations table for edges between memories
 * - memory_relate - Create relations between memories
 * - memory_relations - Query relations for a memory
 * - memory_unrelate - Remove relations
 * - memory_graph - Traverse connected memories
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
// @ts-ignore
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================
interface MemoryRow {
  id: string;
  content: string;
  type: string;
  tags: string;
  importance: number;
  strength: number;
  access_count: number;
  created_at: string;
  last_accessed: string;
  deleted_at: string | null;
  embedding: Buffer | null;
}

interface RelationRow {
  id: string;
  from_id: string;
  to_id: string;
  relation_type: string;
  weight: number;
  created_at: string;
}

interface ToolArgs {
  content?: string;
  type?: string;
  tags?: string[];
  importance?: number;
  id?: string;
  query?: string;
  limit?: number;
  includeWeak?: boolean;
  permanent?: boolean;
  mode?: 'hybrid' | 'keyword' | 'semantic';
  batchSize?: number;
  from_id?: string;
  to_id?: string;
  relation_type?: string;
  weight?: number;
  direction?: 'outgoing' | 'incoming' | 'both';
  depth?: number;
}

const RELATION_TYPES = ['relates_to', 'causes', 'caused_by', 'supports', 'contradicts', 
  'part_of', 'contains', 'precedes', 'follows', 'similar_to', 'depends_on'] as const;

// ============================================================================
// Database Setup
// ============================================================================
const DB_PATH = join(homedir(), '.just-memory', 'memories.db');
const DB_DIR = dirname(DB_PATH);
if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Schema v1.2: memories + relations
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
    embedding BLOB
  );
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at);
  
  CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(from_id, to_id, relation_type)
  );
  CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
  CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
  CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
`);

// Upgrade from v1.0/v1.1
try { db.exec('ALTER TABLE memories ADD COLUMN embedding BLOB'); } catch { }

// ============================================================================
// Embedding Engine
// ============================================================================
let embedder: any = null;
async function getEmbedder() {
  if (embedder) return embedder;
  const { pipeline } = await import('@xenova/transformers');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.error('Embedding model loaded: all-MiniLM-L6-v2');
  return embedder;
}

async function generateEmbedding(text: string): Promise<Float32Array> {
  const embed = await getEmbedder();
  const output = await embed(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}

function embeddingToBuffer(e: Float32Array): Buffer { return Buffer.from(e.buffer); }
function bufferToEmbedding(b: Buffer): Float32Array { 
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4); 
}
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0; for (let i = 0; i < a.length; i++) dot += a[i] * b[i]; return dot;
}

// ============================================================================
// Ebbinghaus Decay
// ============================================================================
const DECAY_CONSTANT = 0.5;
function calculateRetention(lastAccessed: string, strength: number): number {
  const hours = (Date.now() - new Date(lastAccessed).getTime()) / 3600000;
  return Math.exp(-hours * DECAY_CONSTANT / (strength * 24));
}
function updateStrength(s: number, accessCount: number): number {
  return Math.min(10, s + 0.2 * Math.log(accessCount + 1));
}

// ============================================================================
// Memory Operations
// ============================================================================
async function storeMemory(content: string, type = 'note', tags: string[] = [], importance = 0.5) {
  const id = randomUUID().replace(/-/g, '');
  let embBuf: Buffer | null = null;
  try { embBuf = embeddingToBuffer(await generateEmbedding(content)); } catch {}
  db.prepare(`INSERT INTO memories (id, content, type, tags, importance, embedding) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, content, type, JSON.stringify(tags), importance, embBuf);
  return { id, content, type, tags, importance, strength: 1.0, hasEmbedding: !!embBuf };
}

function recallMemory(id: string) {
  const m = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined;
  if (!m) return { error: 'Memory not found', id };
  const newStrength = updateStrength(m.strength, m.access_count);
  db.prepare(`UPDATE memories SET access_count = access_count + 1, strength = ?, last_accessed = datetime('now') WHERE id = ?`)
    .run(newStrength, id);
  const u = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow;
  return { id: u.id, content: u.content, type: u.type, tags: JSON.parse(u.tags), importance: u.importance,
    strength: u.strength, access_count: u.access_count, retention: calculateRetention(u.last_accessed, u.strength) };
}

async function searchMemories(query: string, limit = 10, mode: 'hybrid' | 'keyword' | 'semantic' = 'hybrid') {
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL`).all() as MemoryRow[];
  const withRet = rows.map(m => ({ ...m, tags: JSON.parse(m.tags), 
    retention: calculateRetention(m.last_accessed, m.strength) })).filter(m => m.retention > 0.1);

  if (mode === 'keyword') {
    const q = query.toLowerCase();
    return withRet.filter(m => m.content.toLowerCase().includes(q))
      .sort((a, b) => b.importance - a.importance).slice(0, limit);
  }
  if (mode === 'semantic') {
    const qEmb = await generateEmbedding(query);
    return withRet.filter(m => m.embedding)
      .map(m => ({ ...m, similarity: cosineSimilarity(qEmb, bufferToEmbedding(m.embedding!)) }))
      .sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }
  // Hybrid
  const q = query.toLowerCase();
  const qEmb = await generateEmbedding(query);
  return withRet.map(m => {
    const kw = m.content.toLowerCase().includes(q) ? 1 : 0;
    const sem = m.embedding ? cosineSimilarity(qEmb, bufferToEmbedding(m.embedding)) : 0;
    return { ...m, keywordScore: kw, semanticScore: sem, score: kw * 0.4 + sem * 0.6 };
  }).filter(m => m.score > 0.2).sort((a, b) => b.score - a.score).slice(0, limit);
}

function listMemories(limit = 20, includeWeak = false) {
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT ?`).all(limit) as MemoryRow[];
  return rows.map(m => ({ ...m, tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength),
    hasEmbedding: !!m.embedding })).filter(m => includeWeak || m.retention > 0.1);
}

function deleteMemory(id: string, permanent = false) {
  if (permanent) {
    db.prepare('DELETE FROM relations WHERE from_id = ? OR to_id = ?').run(id, id);
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  } else db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return { deleted: true, permanent };
}

function getStats() {
  const total = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL').get() as {c:number}).c;
  const withEmb = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL AND embedding IS NOT NULL').get() as {c:number}).c;
  const rels = (db.prepare('SELECT COUNT(*) as c FROM relations').get() as {c:number}).c;
  return { total, withEmbeddings: withEmb, needsReindex: total - withEmb, relations: rels, version: '1.2.0' };
}

async function reindexMemories(batchSize = 5) {
  const rows = db.prepare('SELECT id, content FROM memories WHERE deleted_at IS NULL AND embedding IS NULL LIMIT ?')
    .all(batchSize) as { id: string; content: string }[];
  if (!rows.length) return { reindexed: 0, remaining: 0, message: 'All memories have embeddings' };
  let n = 0;
  for (const r of rows) {
    try { db.prepare('UPDATE memories SET embedding = ? WHERE id = ?')
      .run(embeddingToBuffer(await generateEmbedding(r.content)), r.id); n++; } catch {}
  }
  const rem = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL AND embedding IS NULL').get() as {c:number}).c;
  return { reindexed: n, remaining: rem, message: rem > 0 ? `${rem} remaining` : 'Complete' };
}


// ============================================================================
// Relation Operations (NEW in v1.2)
// ============================================================================
function relateMemories(from_id: string, to_id: string, relation_type: string, weight = 1.0) {
  const from = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(from_id);
  const to = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(to_id);
  if (!from) return { error: 'Source memory not found', from_id };
  if (!to) return { error: 'Target memory not found', to_id };
  if (from_id === to_id) return { error: 'Cannot relate memory to itself' };
  
  const id = randomUUID().replace(/-/g, '');
  try {
    db.prepare('INSERT INTO relations (id, from_id, to_id, relation_type, weight) VALUES (?, ?, ?, ?, ?)')
      .run(id, from_id, to_id, relation_type, Math.max(0, Math.min(1, weight)));
    return { id, from_id, to_id, relation_type, weight, created: true };
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return { error: 'Relation already exists', from_id, to_id, relation_type };
    throw e;
  }
}

function getRelations(id: string, direction: 'outgoing' | 'incoming' | 'both' = 'both') {
  const m = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined;
  if (!m) return { error: 'Memory not found', id };
  
  let outgoing: any[] = [], incoming: any[] = [];
  if (direction !== 'incoming') {
    outgoing = db.prepare(`SELECT r.*, m.content as target_content, m.type as target_type 
      FROM relations r JOIN memories m ON r.to_id = m.id WHERE r.from_id = ? AND m.deleted_at IS NULL`).all(id)
      .map((r: any) => ({ id: r.id, to_id: r.to_id, type: r.relation_type, weight: r.weight,
        target: r.target_content.substring(0, 80) + (r.target_content.length > 80 ? '...' : '') }));
  }
  if (direction !== 'outgoing') {
    incoming = db.prepare(`SELECT r.*, m.content as source_content, m.type as source_type 
      FROM relations r JOIN memories m ON r.from_id = m.id WHERE r.to_id = ? AND m.deleted_at IS NULL`).all(id)
      .map((r: any) => ({ id: r.id, from_id: r.from_id, type: r.relation_type, weight: r.weight,
        source: r.source_content.substring(0, 80) + (r.source_content.length > 80 ? '...' : '') }));
  }
  return { memory: { id: m.id, content: m.content.substring(0, 80) }, outgoing, incoming, total: outgoing.length + incoming.length };
}

function unrelateMemories(from_id: string, to_id: string, relation_type?: string) {
  const result = relation_type 
    ? db.prepare('DELETE FROM relations WHERE from_id = ? AND to_id = ? AND relation_type = ?').run(from_id, to_id, relation_type)
    : db.prepare('DELETE FROM relations WHERE from_id = ? AND to_id = ?').run(from_id, to_id);
  return { deleted: result.changes, from_id, to_id, relation_type };
}

function traverseGraph(startId: string, depth = 2, limit = 30) {
  const m = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(startId) as MemoryRow | undefined;
  if (!m) return { error: 'Memory not found', startId };
  
  const visited = new Set<string>([startId]);
  const nodes: any[] = [{ id: m.id, content: m.content.substring(0, 80), type: m.type, depth: 0 }];
  const edges: any[] = [];
  
  function traverse(currentId: string, d: number) {
    if (d >= depth || nodes.length >= limit) return;
    
    const rels = db.prepare(`
      SELECT r.*, m.content, m.type, r.to_id as target_id FROM relations r 
      JOIN memories m ON r.to_id = m.id WHERE r.from_id = ? AND m.deleted_at IS NULL
      UNION
      SELECT r.*, m.content, m.type, r.from_id as target_id FROM relations r 
      JOIN memories m ON r.from_id = m.id WHERE r.to_id = ? AND m.deleted_at IS NULL
    `).all(currentId, currentId) as any[];
    
    for (const rel of rels) {
      const targetId = rel.target_id;
      edges.push({ from: rel.from_id, to: rel.to_id, type: rel.relation_type, weight: rel.weight });
      if (!visited.has(targetId) && nodes.length < limit) {
        visited.add(targetId);
        nodes.push({ id: targetId, content: rel.content.substring(0, 80), type: rel.type, depth: d + 1 });
        traverse(targetId, d + 1);
      }
    }
  }
  
  traverse(startId, 0);
  const uniqueEdges = [...new Map(edges.map(e => [`${e.from}-${e.to}-${e.type}`, e])).values()];
  return { start: startId, nodes, edges: uniqueEdges, nodeCount: nodes.length, edgeCount: uniqueEdges.length };
}

// ============================================================================
// MCP Server
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.2.0' }, { capabilities: { tools: {} } });

const TOOLS = [
  { name: 'memory_store', description: 'Store a new memory', inputSchema: {
    type: 'object' as const, properties: {
      content: { type: 'string', description: 'Memory content' },
      type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
      tags: { type: 'array', items: { type: 'string' } },
      importance: { type: 'number', minimum: 0, maximum: 1 }
    }, required: ['content']
  }},
  { name: 'memory_recall', description: 'Recall a memory by ID (strengthens it)', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id']
  }},
  { name: 'memory_search', description: 'Search memories', inputSchema: {
    type: 'object' as const, properties: {
      query: { type: 'string' }, limit: { type: 'number', default: 10 },
      mode: { type: 'string', enum: ['hybrid', 'keyword', 'semantic'], default: 'hybrid' }
    }, required: ['query']
  }},
  { name: 'memory_list', description: 'List recent memories', inputSchema: {
    type: 'object' as const, properties: { limit: { type: 'number', default: 20 }, includeWeak: { type: 'boolean' } }
  }},
  { name: 'memory_delete', description: 'Delete a memory', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' }, permanent: { type: 'boolean' } }, required: ['id']
  }},
  { name: 'memory_stats', description: 'Get statistics', inputSchema: { type: 'object' as const, properties: {} }},
  { name: 'memory_reindex', description: 'Generate missing embeddings', inputSchema: {
    type: 'object' as const, properties: { batchSize: { type: 'number', default: 5 } }
  }},
  // NEW: Knowledge Graph tools
  { name: 'memory_relate', description: 'Create relation between two memories', inputSchema: {
    type: 'object' as const, properties: {
      from_id: { type: 'string', description: 'Source memory ID' },
      to_id: { type: 'string', description: 'Target memory ID' },
      relation_type: { type: 'string', description: 'Relation type (relates_to, causes, supports, contradicts, part_of, etc)' },
      weight: { type: 'number', minimum: 0, maximum: 1, default: 1.0 }
    }, required: ['from_id', 'to_id', 'relation_type']
  }},
  { name: 'memory_relations', description: 'Get relations for a memory', inputSchema: {
    type: 'object' as const, properties: {
      id: { type: 'string' }, direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], default: 'both' }
    }, required: ['id']
  }},
  { name: 'memory_unrelate', description: 'Remove relation between memories', inputSchema: {
    type: 'object' as const, properties: {
      from_id: { type: 'string' }, to_id: { type: 'string' },
      relation_type: { type: 'string', description: 'Optional: specific type to remove' }
    }, required: ['from_id', 'to_id']
  }},
  { name: 'memory_graph', description: 'Traverse knowledge graph from a memory', inputSchema: {
    type: 'object' as const, properties: {
      id: { type: 'string', description: 'Starting memory ID' },
      depth: { type: 'number', default: 2, description: 'Traversal depth (1-3)' },
      limit: { type: 'number', default: 30, description: 'Max nodes' }
    }, required: ['id']
  }}
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args || {}) as ToolArgs;
  try {
    let result: unknown;
    switch (name) {
      case 'memory_store': result = await storeMemory(a.content!, a.type, a.tags, a.importance); break;
      case 'memory_recall': result = recallMemory(a.id!); break;
      case 'memory_search': result = await searchMemories(a.query!, a.limit, a.mode); break;
      case 'memory_list': result = listMemories(a.limit, a.includeWeak); break;
      case 'memory_delete': result = deleteMemory(a.id!, a.permanent); break;
      case 'memory_stats': result = getStats(); break;
      case 'memory_reindex': result = await reindexMemories(a.batchSize); break;
      case 'memory_relate': result = relateMemories(a.from_id!, a.to_id!, a.relation_type!, a.weight); break;
      case 'memory_relations': result = getRelations(a.id!, a.direction); break;
      case 'memory_unrelate': result = unrelateMemories(a.from_id!, a.to_id!, a.relation_type); break;
      case 'memory_graph': result = traverseGraph(a.id!, a.depth, a.limit); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e: unknown) {
    return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : e}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Just-Memory v1.2 running (Ebbinghaus + semantic + knowledge graph)');
}
main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
