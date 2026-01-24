/**
 * Just-Memory v1.1 - Semantic Search Edition
 * 
 * Adds vector embeddings and semantic search to v1.0's Ebbinghaus decay.
 * Uses @xenova/transformers for local embeddings (no API needed).
 * 
 * New features:
 * - Embeddings generated on memory_store
 * - memory_search now supports hybrid search (keyword + semantic)
 * - Brute-force cosine similarity (simple, no sqlite-vec needed)
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
}

// ============================================================================
// Database Setup
// ============================================================================
const DB_PATH = join(homedir(), '.just-memory', 'memories.db');
const DB_DIR = dirname(DB_PATH);

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Schema v1.1: Add embedding column
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
`);

// Add embedding column if upgrading from v1.0
try {
  db.exec('ALTER TABLE memories ADD COLUMN embedding BLOB');
  console.error('Added embedding column (upgrading from v1.0)');
} catch { /* Column already exists */ }

// ============================================================================
// Embedding Engine (Lazy-loaded)
// ============================================================================
let pipeline: any = null;
let embedder: any = null;

async function getEmbedder() {
  if (embedder) return embedder;
  
  // Dynamic import to avoid blocking startup
  const { pipeline: createPipeline } = await import('@xenova/transformers');
  pipeline = createPipeline;
  
  // Use all-MiniLM-L6-v2 (384 dimensions, fast, good quality)
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.error('Embedding model loaded: all-MiniLM-L6-v2');
  return embedder;
}

async function generateEmbedding(text: string): Promise<Float32Array> {
  const embed = await getEmbedder();
  const output = await embed(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}

function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

function bufferToEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // Already normalized, so dot product = cosine similarity
}

// ============================================================================
// Ebbinghaus Decay Functions
// ============================================================================
const DECAY_CONSTANT = 0.5;

function calculateRetention(lastAccessed: string, strength: number): number {
  const hoursSince = (Date.now() - new Date(lastAccessed).getTime()) / 3600000;
  return Math.exp(-hoursSince * DECAY_CONSTANT / (strength * 24));
}

function updateStrength(currentStrength: number, accessCount: number): number {
  return Math.min(10, currentStrength + 0.2 * Math.log(accessCount + 1));
}

// ============================================================================
// Core Operations
// ============================================================================
async function storeMemory(content: string, type = 'note', tags: string[] = [], importance = 0.5) {
  const id = randomUUID().replace(/-/g, '');
  
  // Generate embedding
  let embeddingBuffer: Buffer | null = null;
  try {
    const embedding = await generateEmbedding(content);
    embeddingBuffer = embeddingToBuffer(embedding);
  } catch (err) {
    console.error('Embedding generation failed:', err);
  }
  
  db.prepare(`INSERT INTO memories (id, content, type, tags, importance, embedding) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, content, type, JSON.stringify(tags), importance, embeddingBuffer);
  
  return { id, content, type, tags, importance, strength: 1.0, hasEmbedding: !!embeddingBuffer };
}

function recallMemory(id: string) {
  const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined;
  if (!memory) return { error: 'Memory not found', id };
  
  const newStrength = updateStrength(memory.strength, memory.access_count);
  db.prepare(`UPDATE memories SET access_count = access_count + 1, strength = ?, last_accessed = datetime('now') WHERE id = ?`)
    .run(newStrength, id);
  
  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow;
  return {
    id: updated.id,
    content: updated.content,
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

async function searchMemories(query: string, limit = 10, mode: 'hybrid' | 'keyword' | 'semantic' = 'hybrid') {
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL`).all() as MemoryRow[];
  
  // Calculate retention for all
  const withRetention = rows.map(m => ({
    ...m,
    tags: JSON.parse(m.tags),
    retention: calculateRetention(m.last_accessed, m.strength)
  })).filter(m => m.retention > 0.1);
  
  if (mode === 'keyword') {
    // Pure keyword search
    const queryLower = query.toLowerCase();
    return withRetention
      .filter(m => m.content.toLowerCase().includes(queryLower))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }
  
  if (mode === 'semantic') {
    // Pure semantic search
    const queryEmbedding = await generateEmbedding(query);
    const withSimilarity = withRetention
      .filter(m => m.embedding)
      .map(m => ({
        ...m,
        similarity: cosineSimilarity(queryEmbedding, bufferToEmbedding(m.embedding!))
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    return withSimilarity;
  }
  
  // Hybrid: combine keyword + semantic scores
  const queryLower = query.toLowerCase();
  const queryEmbedding = await generateEmbedding(query);
  
  const scored = withRetention.map(m => {
    // Keyword score: 1 if match, 0 otherwise
    const keywordScore = m.content.toLowerCase().includes(queryLower) ? 1 : 0;
    
    // Semantic score: cosine similarity (0-1)
    let semanticScore = 0;
    if (m.embedding) {
      semanticScore = cosineSimilarity(queryEmbedding, bufferToEmbedding(m.embedding));
    }
    
    // Combined score: weight semantic higher for discovery
    const combinedScore = keywordScore * 0.4 + semanticScore * 0.6;
    
    return { ...m, keywordScore, semanticScore, score: combinedScore };
  });
  
  return scored
    .filter(m => m.score > 0.2) // Minimum relevance threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function listMemories(limit = 20, includeWeak = false) {
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT ?`).all(limit) as MemoryRow[];
  return rows.map(m => ({
    ...m,
    tags: JSON.parse(m.tags),
    retention: calculateRetention(m.last_accessed, m.strength),
    hasEmbedding: !!m.embedding
  })).filter(m => includeWeak || m.retention > 0.1);
}

function deleteMemory(id: string, permanent = false) {
  if (permanent) db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  else db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return { deleted: true, permanent };
}

function getStats() {
  const total = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL').get() as { count: number }).count;
  const withEmbeddings = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND embedding IS NOT NULL').get() as { count: number }).count;
  const active = listMemories(1000, false).length;
  return { total, withEmbeddings, needsReindex: total - withEmbeddings, activeAboveThreshold: active, dbPath: DB_PATH, version: '1.1.0' };
}

async function reindexMemories(batchSize = 5) {
  const rows = db.prepare('SELECT id, content FROM memories WHERE deleted_at IS NULL AND embedding IS NULL LIMIT ?').all(batchSize) as { id: string; content: string }[];
  
  if (rows.length === 0) return { reindexed: 0, message: 'All memories have embeddings' };
  
  let reindexed = 0;
  for (const row of rows) {
    try {
      const embedding = await generateEmbedding(row.content);
      db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(embeddingToBuffer(embedding), row.id);
      reindexed++;
    } catch (err) {
      console.error(`Failed to reindex ${row.id}:`, err);
    }
  }
  
  const remaining = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND embedding IS NULL').get() as { count: number }).count;
  return { reindexed, remaining, message: remaining > 0 ? `Run again to continue (${remaining} remaining)` : 'Reindex complete' };
}

// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.1.0' }, { capabilities: { tools: {} } });

const TOOLS = [
  { name: 'memory_store', description: 'Store a new memory with optional type and tags', inputSchema: {
    type: 'object' as const, properties: {
      content: { type: 'string', description: 'Memory content to store' },
      type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
      tags: { type: 'array', items: { type: 'string' } },
      importance: { type: 'number', minimum: 0, maximum: 1 }
    }, required: ['content']
  }},
  { name: 'memory_recall', description: 'Recall a memory by ID (strengthens it)', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id']
  }},
  { name: 'memory_search', description: 'Search memories by content', inputSchema: {
    type: 'object' as const, properties: {
      query: { type: 'string' },
      limit: { type: 'number', default: 10 },
      mode: { type: 'string', enum: ['hybrid', 'keyword', 'semantic'], default: 'hybrid', description: 'Search mode: hybrid (default), keyword-only, or semantic-only' }
    }, required: ['query']
  }},
  { name: 'memory_list', description: 'List recent memories above retention threshold', inputSchema: {
    type: 'object' as const, properties: {
      limit: { type: 'number', default: 20 },
      includeWeak: { type: 'boolean', description: 'Include memories below retention threshold' }
    }
  }},
  { name: 'memory_delete', description: 'Delete a memory (soft delete by default)', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' }, permanent: { type: 'boolean' } }, required: ['id']
  }},
  { name: 'memory_stats', description: 'Get memory database statistics', inputSchema: { type: 'object' as const, properties: {} }},
  { name: 'memory_reindex', description: 'Generate embeddings for memories missing them (batch processing)', inputSchema: {
    type: 'object' as const, properties: { batchSize: { type: 'number', default: 5, description: 'Number of memories to process per call (keep small to avoid timeout)' } }
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
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error: unknown) {
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
  console.error('Just-Memory v1.1 running (Ebbinghaus decay + semantic search)');
}

main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
