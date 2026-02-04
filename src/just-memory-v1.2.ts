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

interface EdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  relation_type: string;
  valid_from: string;
  valid_to: string | null;
  confidence: number;
  metadata: string;
  created_at: string;
}

interface ToolArgs {
  // Memory args
  content?: string;
  type?: string;
  tags?: string[];
  importance?: number;
  id?: string;
  query?: string;
  limit?: number;
  includeWeak?: boolean;
  permanent?: boolean;
  // Edge args
  fromId?: string;
  toId?: string;
  relationType?: string;
  validFrom?: string;
  validTo?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  asOfDate?: string;
  includeExpired?: boolean;
  direction?: 'outgoing' | 'incoming' | 'both';
  relationTypes?: string[];
  edgeId?: string;
}

// ============================================================================
// Database Setup
// ============================================================================
const DB_PATH = join(homedir(), '.just-memory', 'memories.db');
const DB_DIR = dirname(DB_PATH);

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

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
