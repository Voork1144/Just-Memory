/**
 * Just-Memory v1.0 - Standalone MCP Server with Ebbinghaus Decay
 * 
 * A minimal, focused memory server implementing forgetting curves.
 * ~200 lines, SQLite backend, production-ready.
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
}

// ============================================================================
// Database Setup
// ============================================================================
const DB_PATH = join(homedir(), '.just-memory', 'memories.db');
const DB_DIR = dirname(DB_PATH);

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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

// ============================================================================
// Ebbinghaus Decay Functions
// ============================================================================
const DECAY_CONSTANT = 0.5; // Half-life ~1 day at strength=1

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
function storeMemory(content: string, type = 'note', tags: string[] = [], importance = 0.5) {
  const id = randomUUID().replace(/-/g, '');
  db.prepare(`INSERT INTO memories (id, content, type, tags, importance) VALUES (?, ?, ?, ?, ?)`)
    .run(id, content, type, JSON.stringify(tags), importance);
  return { id, content, type, tags, importance, strength: 1.0 };
}

function recallMemory(id: string) {
  const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined;
  if (!memory) return { error: 'Memory not found', id };
  const newStrength = updateStrength(memory.strength, memory.access_count);
  db.prepare(`UPDATE memories SET access_count = access_count + 1, strength = ?, last_accessed = datetime('now') WHERE id = ?`)
    .run(newStrength, id);
  // Re-fetch to get updated values
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

function searchMemories(query: string, limit = 10) {
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND content LIKE ? ORDER BY importance DESC, last_accessed DESC LIMIT ?`)
    .all(`%${query}%`, limit) as MemoryRow[];
  return rows.map(m => ({ ...m, tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength) }))
    .filter(m => m.retention > 0.1);
}

function listMemories(limit = 20, includeWeak = false) {
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT ?`).all(limit) as MemoryRow[];
  return rows.map(m => ({ ...m, tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength) }))
    .filter(m => includeWeak || m.retention > 0.1);
}

function deleteMemory(id: string, permanent = false) {
  if (permanent) db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  else db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return { deleted: true, permanent };
}

function getStats() {
  const total = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL').get() as { count: number }).count;
  const active = listMemories(1000, false).length;
  return { total, activeAboveThreshold: active, dbPath: DB_PATH };
}

// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.0.0' }, { capabilities: { tools: {} } });

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
    type: 'object' as const, properties: { query: { type: 'string' }, limit: { type: 'number', default: 10 } }, required: ['query']
  }},
  { name: 'memory_list', description: 'List recent memories above retention threshold', inputSchema: {
    type: 'object' as const, properties: { limit: { type: 'number', default: 20 }, includeWeak: { type: 'boolean', description: 'Include memories below retention threshold' } }
  }},
  { name: 'memory_delete', description: 'Delete a memory (soft delete by default)', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' }, permanent: { type: 'boolean' } }, required: ['id']
  }},
  { name: 'memory_stats', description: 'Get memory database statistics', inputSchema: { type: 'object' as const, properties: {} }}
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args || {}) as ToolArgs;
  try {
    let result: unknown;
    switch (name) {
      case 'memory_store': result = storeMemory(a.content!, a.type, a.tags, a.importance); break;
      case 'memory_recall': result = recallMemory(a.id!); break;
      case 'memory_search': result = searchMemories(a.query!, a.limit); break;
      case 'memory_list': result = listMemories(a.limit, a.includeWeak); break;
      case 'memory_delete': result = deleteMemory(a.id!, a.permanent); break;
      case 'memory_stats': result = getStats(); break;
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
  console.error('Just-Memory v1.0 running (Ebbinghaus decay enabled)');
}

main().catch(console.error);
process.on('SIGINT', () => { db.close(); process.exit(0); });
