/**
 * Just-Memory v1.8 - Backup/Restore
 * 
 * New in v1.8:
 * - memory_backup: Export memories, edges, scratchpad to JSON file
 * - memory_restore: Import from backup with merge/replace modes
 * - memory_list_backups: List available backup files
 * 
 * From v1.7:
 * - Semantic search (embeddings)
 * - Hybrid search (keyword + semantic)
 * - 22 tools (now 25)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
// @ts-ignore - better-sqlite3 types
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';

// ============================================================================
// Embedding Setup - v1.7
// ============================================================================
// @ts-ignore - transformers.js types
import { pipeline, env as transformerEnv } from '@xenova/transformers';
// @ts-ignore - sqlite-vec types
import * as sqliteVec from 'sqlite-vec';

// Configure transformers cache
const MODEL_CACHE = join(homedir(), '.just-memory', 'models');
transformerEnv.cacheDir = MODEL_CACHE;
transformerEnv.localModelPath = MODEL_CACHE;

// Embedding dimension for all-MiniLM-L6-v2
const EMBEDDING_DIM = 384;

// Embedder instance (pre-warmed on startup)
let embedder: any = null;
let embedderReady = false;

async function initEmbedder(): Promise<void> {
  if (embedder) return;
  console.error('[Just-Memory] Pre-warming embedding model...');
  try {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
    embedderReady = true;
    console.error('[Just-Memory] Embedding model ready');
  } catch (err) {
    console.error('[Just-Memory] Failed to load embedding model:', err);
    embedderReady = false;
  }
}

async function generateEmbedding(text: string): Promise<Float32Array | null> {
  if (!embedderReady || !embedder) return null;
  try {
    const result = await embedder(text, { pooling: 'mean', normalize: true });
    return new Float32Array(result.data);
  } catch (err) {
    console.error('[Just-Memory] Embedding generation failed:', err);
    return null;
  }
}

// ============================================================================
// Constants
// ============================================================================
const MAX_CONTENT_LENGTH = 100000;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;
const BACKUP_DIR = join(homedir(), '.just-memory', 'backups');

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
  confidence: number;
  source_count: number;
  contradiction_count: number;
  embedding: Buffer | null;
  // Bi-temporal fields
  valid_from: string | null;
  valid_to: string | null;
  superseded_by: string | null;
  supersedes: string | null;
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

interface ScratchRow {
  key: string;
  value: string;
  expires_at: string | null;
  created_at: string;
  access_count: number;
  last_accessed: string | null;
  category: string; // 'general' | 'plan' | 'context' | 'goal'
  session_id: string | null;
  promoted_to: string | null; // memory ID if promoted to long-term
}

interface SemanticResult extends MemoryRow {
  similarity?: number;
  keywordScore?: number;
  hybridScore?: number;
}

// v1.8: Backup format
interface BackupData {
  version: string;
  created_at: string;
  memories: Array<Omit<MemoryRow, 'embedding'> & { embedding_base64?: string }>;
  edges: EdgeRow[];
  scratchpad: ScratchRow[];
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
  memoryId?: string;
  seedIds?: string[];
  maxHops?: number;
  decayFactor?: number;
  inhibitionThreshold?: number;
  minActivation?: number;
  confidenceThreshold?: number;
  sourceId?: string;
  contradictingId?: string;
  includeUncertain?: boolean;
  key?: string;
  value?: string;
  ttlSeconds?: number;
  maxTokens?: number;
  mode?: 'keyword' | 'semantic' | 'hybrid';
  alpha?: number;
  ids?: string[];
  // v1.8: Backup/restore args
  path?: string;
  includeDeleted?: boolean;
  includeScratchpad?: boolean;
  includeEmbeddings?: boolean;
  restoreMode?: 'merge' | 'replace';
  // v1.8.1: Bi-temporal args
  asOf?: string;
  includeSuperseded?: boolean;
  oldMemoryId?: string;
  newMemoryId?: string;
  // v1.8.1: Advanced scratchpad args
  category?: string;
  planId?: string;
  description?: string;
  steps?: string[];
  ttlHours?: number;
  completedSteps?: number[];
  status?: string;
  sessionId?: string;
}

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

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
if (!existsSync(MODEL_CACHE)) mkdirSync(MODEL_CACHE, { recursive: true });
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Load sqlite-vec extension
try {
  sqliteVec.load(db);
  console.error('[Just-Memory] sqlite-vec extension loaded');
} catch (err) {
  console.error('[Just-Memory] Warning: sqlite-vec load failed, semantic search disabled:', err);
}

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
    contradiction_count INTEGER DEFAULT 0,
    embedding BLOB
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

// Working memory/scratchpad (enhanced v1.8.1)
db.exec(`
  CREATE TABLE IF NOT EXISTS scratchpad (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,
    category TEXT DEFAULT 'general',
    session_id TEXT,
    promoted_to TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_scratchpad_category ON scratchpad(category);
  CREATE INDEX IF NOT EXISTS idx_scratchpad_session ON scratchpad(session_id);
  CREATE INDEX IF NOT EXISTS idx_scratchpad_access ON scratchpad(access_count);
`);

// Ensure columns exist for upgrades
try { db.exec('ALTER TABLE scratchpad ADD COLUMN access_count INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE scratchpad ADD COLUMN last_accessed TEXT'); } catch {}
try { db.exec('ALTER TABLE scratchpad ADD COLUMN category TEXT DEFAULT \'general\''); } catch {}
try { db.exec('ALTER TABLE scratchpad ADD COLUMN session_id TEXT'); } catch {}
try { db.exec('ALTER TABLE scratchpad ADD COLUMN promoted_to TEXT'); } catch {}

// Ensure columns exist for upgrades
try { db.exec('ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 0.5'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN source_count INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN contradiction_count INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN embedding BLOB'); } catch {}

// Bi-temporal memory columns (v1.8.1) - Track when facts were valid AND when we learned them
try { db.exec('ALTER TABLE memories ADD COLUMN valid_from TEXT DEFAULT (datetime(\'now\'))'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN valid_to TEXT'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN superseded_by TEXT'); } catch {}
try { db.exec('ALTER TABLE memories ADD COLUMN supersedes TEXT'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_memories_valid ON memories(valid_from, valid_to)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_memories_superseded ON memories(superseded_by)'); } catch {}

// ============================================================================
// Input Validation
// ============================================================================
function sanitizeLikePattern(input: string): string {
  return input.replace(/[%_]/g, '\\$&');
}

function validateContent(content: string): void {
  if (!content || typeof content !== 'string') {
    throw new Error('Content is required and must be a string');
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }
}

function validateTags(tags: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.slice(0, MAX_TAGS_COUNT).map(t => String(t).slice(0, MAX_TAG_LENGTH)).filter(t => t.length > 0);
}

// ============================================================================
// Ebbinghaus Decay
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
// Confidence Functions
// ============================================================================
function calculateEffectiveConfidence(memory: MemoryRow): number {
  let conf = memory.confidence;
  const daysSince = (Date.now() - new Date(memory.last_accessed).getTime()) / 86400000;
  conf -= daysSince * CONFIDENCE_PENALTY.DECAY_PER_DAY;
  conf += (memory.source_count - 1) * CONFIDENCE_BOOST.CONFIRMATION;
  conf -= memory.contradiction_count * CONFIDENCE_PENALTY.CONTRADICTION;
  if (memory.importance > 0.7) conf += CONFIDENCE_BOOST.HIGH_IMPORTANCE;
  return Math.max(0, Math.min(1, conf));
}

function assessConfidence(memory: MemoryRow): { level: 'high' | 'medium' | 'low' | 'uncertain'; note?: string } {
  const conf = calculateEffectiveConfidence(memory);
  if (conf >= CONFIDENCE_LEVELS.HIGH) return { level: 'high' };
  if (conf >= CONFIDENCE_LEVELS.MEDIUM) return { level: 'medium' };
  if (conf >= CONFIDENCE_LEVELS.LOW) return { level: 'low' };
  return { level: 'uncertain', note: 'Low confidence - may need verification' };
}

function toConfidentMemory(m: MemoryRow) {
  const assessment = assessConfidence(m);
  return {
    id: m.id, content: m.content,
    confidence: calculateEffectiveConfidence(m),
    confidenceLevel: assessment.level,
    ...(assessment.note ? { confidenceNote: assessment.note } : {})
  };
}

// ============================================================================
// Contradiction Detection
// ============================================================================
function findContradictions(content: string, limit = 5, excludeId?: string): MemoryRow[] {
  const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const negations = ['not', "don't", "doesn't", "isn't", "aren't", "won't", "can't", "never", 'no'];
  const hasNegation = negations.some(n => content.toLowerCase().includes(n));
  
  let sql = 'SELECT * FROM memories WHERE deleted_at IS NULL';
  if (excludeId) sql += ' AND id != ?';
  
  const allMemories = (excludeId 
    ? db.prepare(sql).all(excludeId) 
    : db.prepare(sql).all()) as MemoryRow[];
  
  const scored = allMemories.map(m => {
    const mWords = m.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const overlap = words.filter(w => mWords.includes(w)).length;
    const mHasNegation = negations.some(n => m.content.toLowerCase().includes(n));
    const potentialContradiction = overlap >= 2 && hasNegation !== mHasNegation;
    return { memory: m, overlap, potentialContradiction };
  });
  
  return scored.filter(s => s.potentialContradiction).sort((a, b) => b.overlap - a.overlap).slice(0, limit).map(s => s.memory);
}

// ============================================================================
// Core Memory Operations
// ============================================================================
async function storeMemory(content: string, type = 'note', tags: string[] = [], importance = 0.5, confidence = 0.5) {
  validateContent(content);
  const validTags = validateTags(tags);
  const id = randomUUID().replace(/-/g, '');
  
  const contradictions = findContradictions(content);
  let adjustedConfidence = confidence;
  if (contradictions.length > 0) {
    adjustedConfidence = Math.max(0.2, confidence - 0.1 * contradictions.length);
  }
  
  const embedding = await generateEmbedding(content);
  const embeddingBuffer = embedding ? Buffer.from(embedding.buffer) : null;
  
  db.prepare(`INSERT INTO memories (id, content, type, tags, importance, confidence, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, content, type, JSON.stringify(validTags), importance, adjustedConfidence, embeddingBuffer);
  
  for (const c of contradictions) {
    const edgeId = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'potential_contradiction', 0.5)`)
      .run(edgeId, id, c.id);
  }
  
  return { 
    id, content, type, tags: validTags, importance, 
    confidence: adjustedConfidence, strength: 1.0,
    hasEmbedding: embedding !== null,
    potentialContradictions: contradictions.map(c => ({ id: c.id, content: c.content.slice(0, 100) }))
  };
}

function recallMemory(id: string) {
  const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined;
  if (!memory) return { error: 'Memory not found', id };
  
  const newStrength = updateStrength(memory.strength, memory.access_count);
  const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.RECENT_ACCESS);
  
  db.prepare(`UPDATE memories SET access_count = access_count + 1, strength = ?, confidence = ?, last_accessed = datetime('now') WHERE id = ?`)
    .run(newStrength, newConfidence, id);
  
  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow;
  return {
    ...toConfidentMemory(updated),
    type: updated.type, tags: JSON.parse(updated.tags),
    importance: updated.importance, strength: updated.strength,
    access_count: updated.access_count, created_at: updated.created_at,
    last_accessed: updated.last_accessed,
    hasEmbedding: updated.embedding !== null,
    retention: calculateRetention(updated.last_accessed, updated.strength)
  };
}

async function updateMemory(id: string, updates: { content?: string; type?: string; tags?: string[]; importance?: number; confidence?: number }) {
  const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined;
  if (!memory) return { error: 'Memory not found', id };
  
  const fields: string[] = [];
  const values: (string | number | Buffer | null)[] = [];
  
  if (updates.content !== undefined) {
    validateContent(updates.content);
    fields.push('content = ?');
    values.push(updates.content);
    
    const embedding = await generateEmbedding(updates.content);
    if (embedding) {
      fields.push('embedding = ?');
      values.push(Buffer.from(embedding.buffer));
    }
    
    const contradictions = findContradictions(updates.content, 5, id);
    if (contradictions.length > 0) {
      for (const c of contradictions) {
        const existingEdge = db.prepare(`SELECT id FROM edges WHERE from_id = ? AND to_id = ? AND relation_type = 'potential_contradiction'`).get(id, c.id);
        if (!existingEdge) {
          const edgeId = randomUUID().replace(/-/g, '');
          db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'potential_contradiction', 0.5)`)
            .run(edgeId, id, c.id);
        }
      }
    }
  }
  
  if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(validateTags(updates.tags))); }
  if (updates.importance !== undefined) { fields.push('importance = ?'); values.push(Math.max(0, Math.min(1, updates.importance))); }
  if (updates.confidence !== undefined) { fields.push('confidence = ?'); values.push(Math.max(0, Math.min(1, updates.confidence))); }
  
  if (fields.length === 0) return { error: 'No valid updates provided', id };
  
  fields.push("last_accessed = datetime('now')");
  values.push(id);
  
  db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  
  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow;
  return {
    id: updated.id, content: updated.content, type: updated.type,
    tags: JSON.parse(updated.tags), importance: updated.importance,
    confidence: updated.confidence, hasEmbedding: updated.embedding !== null, updated: true
  };
}

// ============================================================================
// Search Functions
// ============================================================================
function keywordSearch(query: string, limit: number, confidenceThreshold: number): SemanticResult[] {
  const sanitizedQuery = sanitizeLikePattern(query);
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND content LIKE ? ESCAPE '\\' ORDER BY confidence DESC, importance DESC LIMIT ?`)
    .all(`%${sanitizedQuery}%`, limit * 2) as MemoryRow[];
  return rows
    .map(m => ({ ...m, keywordScore: 1.0 }))
    .filter(m => calculateRetention(m.last_accessed, m.strength) > 0.1 && calculateEffectiveConfidence(m) >= confidenceThreshold);
}

async function semanticSearch(query: string, limit: number, confidenceThreshold: number): Promise<SemanticResult[]> {
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    console.error('[Just-Memory] Semantic search unavailable - embedder not ready');
    return [];
  }
  
  const queryBuffer = Buffer.from(queryEmbedding.buffer);
  
  try {
    const rows = db.prepare(`
      SELECT m.*, (1 - (vec_distance_cosine(m.embedding, ?) / 2)) as similarity
      FROM memories m
      WHERE m.deleted_at IS NULL AND m.embedding IS NOT NULL
      ORDER BY similarity DESC
      LIMIT ?
    `).all(queryBuffer, limit * 2) as (MemoryRow & { similarity: number })[];
    
    return rows
      .filter(m => 
        m.similarity > 0.3 &&
        calculateRetention(m.last_accessed, m.strength) > 0.1 && 
        calculateEffectiveConfidence(m) >= confidenceThreshold
      )
      .map(m => ({ ...m, similarity: m.similarity }));
  } catch (err) {
    console.error('[Just-Memory] Semantic search error:', err);
    return [];
  }
}

async function hybridSearch(
  query: string, 
  limit: number, 
  confidenceThreshold: number, 
  alpha: number = 0.5
): Promise<SemanticResult[]> {
  const [keywordResults, semanticResults] = await Promise.all([
    Promise.resolve(keywordSearch(query, limit, confidenceThreshold)),
    semanticSearch(query, limit, confidenceThreshold)
  ]);
  
  const merged = new Map<string, SemanticResult>();
  
  for (let i = 0; i < keywordResults.length; i++) {
    const m = keywordResults[i];
    const keywordScore = 1 - (i / keywordResults.length);
    merged.set(m.id, { ...m, keywordScore, hybridScore: alpha * keywordScore });
  }
  
  for (let i = 0; i < semanticResults.length; i++) {
    const m = semanticResults[i];
    const semanticScore = m.similarity || 0;
    
    if (merged.has(m.id)) {
      const existing = merged.get(m.id)!;
      existing.similarity = semanticScore;
      existing.hybridScore = (alpha * (existing.keywordScore || 0)) + ((1 - alpha) * semanticScore);
    } else {
      merged.set(m.id, { ...m, similarity: semanticScore, hybridScore: (1 - alpha) * semanticScore });
    }
  }
  
  return Array.from(merged.values())
    .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))
    .slice(0, limit);
}

async function searchMemories(
  query: string, 
  limit = 10, 
  confidenceThreshold = 0, 
  mode: 'keyword' | 'semantic' | 'hybrid' = 'hybrid',
  alpha = 0.5
): Promise<any[]> {
  let results: SemanticResult[];
  
  switch (mode) {
    case 'keyword':
      results = keywordSearch(query, limit, confidenceThreshold);
      break;
    case 'semantic':
      results = await semanticSearch(query, limit, confidenceThreshold);
      break;
    case 'hybrid':
    default:
      results = await hybridSearch(query, limit, confidenceThreshold, alpha);
      break;
  }
  
  return results.map(m => ({
    ...toConfidentMemory(m),
    tags: JSON.parse(m.tags),
    retention: calculateRetention(m.last_accessed, m.strength),
    hasEmbedding: m.embedding !== null,
    ...(m.similarity !== undefined ? { similarity: Math.round(m.similarity * 1000) / 1000 } : {}),
    ...(m.hybridScore !== undefined ? { hybridScore: Math.round(m.hybridScore * 1000) / 1000 } : {})
  })).slice(0, limit);
}

async function embedMemories(ids?: string[]): Promise<{ embedded: number; failed: number; total: number }> {
  let rows: MemoryRow[];
  if (ids && ids.length > 0) {
    rows = db.prepare(`SELECT * FROM memories WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`)
      .all(...ids) as MemoryRow[];
  } else {
    rows = db.prepare('SELECT * FROM memories WHERE embedding IS NULL AND deleted_at IS NULL').all() as MemoryRow[];
  }
  
  let embedded = 0, failed = 0;
  
  for (const row of rows) {
    const embedding = await generateEmbedding(row.content);
    if (embedding) {
      db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(Buffer.from(embedding.buffer), row.id);
      embedded++;
    } else {
      failed++;
    }
  }
  
  return { embedded, failed, total: rows.length };
}

// ============================================================================
// List, Delete, Stats
// ============================================================================
function listMemories(limit = 20, includeWeak = false, includeUncertain = false) {
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY last_accessed DESC LIMIT ?`).all(limit * 2) as MemoryRow[];
  return rows
    .map(m => ({ ...toConfidentMemory(m), tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength), hasEmbedding: m.embedding !== null }))
    .filter(m => (includeWeak || m.retention > 0.1) && (includeUncertain || m.confidenceLevel !== 'uncertain'))
    .slice(0, limit);
}

function deleteMemory(id: string, permanent = false) {
  if (permanent) db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  else db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return { deleted: true, permanent };
}

function getStats() {
  const total = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL').get() as { count: number }).count;
  const withEmbedding = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND embedding IS NOT NULL').get() as { count: number }).count;
  const byConfidence = db.prepare(`
    SELECT SUM(CASE WHEN confidence >= 0.8 THEN 1 ELSE 0 END) as high,
           SUM(CASE WHEN confidence >= 0.5 AND confidence < 0.8 THEN 1 ELSE 0 END) as medium,
           SUM(CASE WHEN confidence >= 0.3 AND confidence < 0.5 THEN 1 ELSE 0 END) as low,
           SUM(CASE WHEN confidence < 0.3 THEN 1 ELSE 0 END) as uncertain
    FROM memories WHERE deleted_at IS NULL
  `).get() as { high: number; medium: number; low: number; uncertain: number };
  const edges = (db.prepare('SELECT COUNT(*) as count FROM edges WHERE valid_to IS NULL').get() as { count: number }).count;
  const scratch = (db.prepare('SELECT COUNT(*) as count FROM scratchpad WHERE expires_at IS NULL OR expires_at > datetime("now")').get() as { count: number }).count;
  return { 
    total, withEmbedding, embeddingCoverage: total > 0 ? Math.round(withEmbedding / total * 100) : 0,
    byConfidenceLevel: byConfidence, activeEdges: edges, scratchpadItems: scratch, 
    embeddingModel: 'all-MiniLM-L6-v2', embeddingDim: EMBEDDING_DIM,
    dbPath: DB_PATH, backupDir: BACKUP_DIR, version: '1.8.0' 
  };
}

// ============================================================================
// Confidence Management
// ============================================================================
function confirmMemory(id: string, sourceId?: string) {
  const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined;
  if (!memory) return { error: 'Memory not found', id };
  
  const newSourceCount = memory.source_count + 1;
  const newConfidence = Math.min(1, memory.confidence + CONFIDENCE_BOOST.CONFIRMATION);
  db.prepare(`UPDATE memories SET source_count = ?, confidence = ? WHERE id = ?`).run(newSourceCount, newConfidence, id);
  
  if (sourceId) {
    const edgeId = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'confirms', 1.0)`).run(edgeId, sourceId, id);
  }
  
  return { confirmed: true, newConfidence, sourceCount: newSourceCount };
}

function contradictMemory(id: string, contradictingId?: string) {
  const memory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined;
  if (!memory) return { error: 'Memory not found', id };
  
  const newCount = memory.contradiction_count + 1;
  const newConfidence = Math.max(0, memory.confidence - CONFIDENCE_PENALTY.CONTRADICTION);
  db.prepare(`UPDATE memories SET contradiction_count = ?, confidence = ? WHERE id = ?`).run(newCount, newConfidence, id);
  
  if (contradictingId) {
    const edgeId = randomUUID().replace(/-/g, '');
    db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, confidence) VALUES (?, ?, ?, 'contradicts', 1.0)`).run(edgeId, contradictingId, id);
  }
  
  return { contradicted: true, newConfidence, contradictionCount: newCount };
}

function getConfidentMemories(threshold = CONFIDENCE_LEVELS.HIGH, limit = 10) {
  const rows = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY confidence DESC LIMIT ?`).all(limit * 2) as MemoryRow[];
  return rows.filter(m => calculateEffectiveConfidence(m) >= threshold).slice(0, limit).map(m => ({
    ...toConfidentMemory(m), tags: JSON.parse(m.tags), retention: calculateRetention(m.last_accessed, m.strength), hasEmbedding: m.embedding !== null
  }));
}

// ============================================================================
// Bi-temporal Edge Operations
// ============================================================================
function createEdge(fromId: string, toId: string, relationType: string, validFrom?: string, validTo?: string, confidence = 1.0, metadata = {}) {
  const fromExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(fromId);
  const toExists = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(toId);
  if (!fromExists || !toExists) return { error: 'Source or target memory not found' };
  
  const id = randomUUID().replace(/-/g, '');
  db.prepare(`INSERT INTO edges (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, fromId, toId, relationType, validFrom || new Date().toISOString(), validTo || null, confidence, JSON.stringify(metadata));
  return { id, fromId, toId, relationType, validFrom, validTo, confidence };
}

function queryEdges(memoryId: string, direction: 'outgoing' | 'incoming' | 'both' = 'both', relationTypes?: string[], asOfDate?: string, includeExpired = false) {
  const asOf = asOfDate || new Date().toISOString();
  const typeFilter = relationTypes?.length ? `AND relation_type IN (${relationTypes.map(() => '?').join(',')})` : '';
  const timeFilter = includeExpired ? '' : `AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)`;
  
  let results: EdgeRow[] = [];
  const params = relationTypes?.length ? [...relationTypes] : [];
  if (!includeExpired) { params.push(asOf, asOf); }
  
  if (direction === 'outgoing' || direction === 'both') {
    const sql = `SELECT * FROM edges WHERE from_id = ? ${typeFilter} ${timeFilter}`;
    results.push(...db.prepare(sql).all(memoryId, ...params) as EdgeRow[]);
  }
  if (direction === 'incoming' || direction === 'both') {
    const sql = `SELECT * FROM edges WHERE to_id = ? ${typeFilter} ${timeFilter}`;
    results.push(...db.prepare(sql).all(memoryId, ...params) as EdgeRow[]);
  }
  
  return results.map(e => ({ ...e, metadata: JSON.parse(e.metadata) }));
}

function invalidateEdge(edgeId: string, validTo?: string) {
  const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId) as EdgeRow | undefined;
  if (!edge) return { error: 'Edge not found', edgeId };
  
  db.prepare('UPDATE edges SET valid_to = ? WHERE id = ?').run(validTo || new Date().toISOString(), edgeId);
  return { invalidated: true, edgeId, validTo };
}

// ============================================================================
// Graph Traversal
// ============================================================================
function traverseGraph(seedIds: string[], maxHops = 2, decayFactor = 0.5, inhibitionThreshold = 0.1, minActivation = 0.1) {
  const activation = new Map<string, number>();
  const visited = new Set<string>();
  
  for (const id of seedIds) activation.set(id, 1.0);
  
  for (let hop = 0; hop < maxHops; hop++) {
    const toProcess = [...activation.entries()].filter(([id, a]) => a >= inhibitionThreshold && !visited.has(id));
    
    for (const [nodeId, currentActivation] of toProcess) {
      visited.add(nodeId);
      const edges = db.prepare('SELECT * FROM edges WHERE (from_id = ? OR to_id = ?) AND (valid_to IS NULL OR valid_to > datetime("now"))').all(nodeId, nodeId) as EdgeRow[];
      
      for (const edge of edges) {
        const neighborId = edge.from_id === nodeId ? edge.to_id : edge.from_id;
        const spread = currentActivation * decayFactor * edge.confidence;
        if (spread >= minActivation) {
          const existing = activation.get(neighborId) || 0;
          activation.set(neighborId, Math.max(existing, spread));
        }
      }
    }
  }
  
  const sortedIds = [...activation.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 20);
  const memories = db.prepare(`SELECT * FROM memories WHERE id IN (${sortedIds.map(() => '?').join(',')}) AND deleted_at IS NULL`).all(...sortedIds) as MemoryRow[];
  
  return memories.map(m => ({
    ...toConfidentMemory(m), activation: activation.get(m.id), tags: JSON.parse(m.tags),
    retention: calculateRetention(m.last_accessed, m.strength), hasEmbedding: m.embedding !== null
  })).sort((a, b) => (b.activation || 0) - (a.activation || 0));
}

// ============================================================================
// Scratchpad (Working Memory) - Enhanced v1.8.1
// ============================================================================

// Threshold for auto-promotion to long-term memory
const PROMOTION_ACCESS_THRESHOLD = 5;

// Generate a unique session ID for context tracking
let currentSessionId: string | null = null;
function getSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = `session-${Date.now()}-${randomUUID().slice(0, 8)}`;
  }
  return currentSessionId;
}

function scratchSet(key: string, value: string, ttlSeconds?: number, category: string = 'general') {
  const expires = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
  const sessionId = getSessionId();

  // Check if key exists to preserve access_count
  const existing = db.prepare('SELECT access_count FROM scratchpad WHERE key = ?').get(key) as { access_count: number } | undefined;
  const accessCount = existing ? existing.access_count : 0;

  db.prepare(`
    INSERT OR REPLACE INTO scratchpad (key, value, expires_at, created_at, access_count, last_accessed, category, session_id, promoted_to)
    VALUES (?, ?, ?, datetime('now'), ?, datetime('now'), ?, ?, NULL)
  `).run(key, value, expires, accessCount, category, sessionId);

  return { key, set: true, expires, category, session_id: sessionId };
}

function scratchGet(key: string) {
  const row = db.prepare('SELECT * FROM scratchpad WHERE key = ? AND (expires_at IS NULL OR expires_at > datetime("now"))').get(key) as ScratchRow | undefined;

  if (!row) {
    return { key, error: 'Not found or expired' };
  }

  // Increment access count and check for auto-promotion
  const newAccessCount = (row.access_count || 0) + 1;
  db.prepare('UPDATE scratchpad SET access_count = ?, last_accessed = datetime("now") WHERE key = ?').run(newAccessCount, key);

  // Auto-promote to long-term memory if threshold reached and not already promoted
  let promoted = false;
  let memoryId = row.promoted_to;

  if (newAccessCount >= PROMOTION_ACCESS_THRESHOLD && !row.promoted_to) {
    // Promote to long-term memory
    const promotionResult = promoteScratchToMemory(key, row.value, row.category);
    if (promotionResult.success) {
      promoted = true;
      memoryId = promotionResult.memory_id;
      db.prepare('UPDATE scratchpad SET promoted_to = ? WHERE key = ?').run(memoryId, key);
    }
  }

  return {
    key,
    value: row.value,
    expires: row.expires_at,
    access_count: newAccessCount,
    category: row.category || 'general',
    promoted,
    memory_id: memoryId
  };
}

function scratchDelete(key: string) {
  db.prepare('DELETE FROM scratchpad WHERE key = ?').run(key);
  return { key, deleted: true };
}

function scratchClear() {
  const result = db.prepare('DELETE FROM scratchpad').run();
  currentSessionId = null; // Reset session
  return { cleared: true, count: result.changes };
}

function scratchList() {
  const rows = db.prepare('SELECT * FROM scratchpad WHERE expires_at IS NULL OR expires_at > datetime("now")').all() as ScratchRow[];
  return rows.map(r => ({
    key: r.key,
    preview: r.value.slice(0, 100),
    expires: r.expires_at,
    access_count: r.access_count || 0,
    category: r.category || 'general',
    promoted_to: r.promoted_to
  }));
}

/**
 * Promote a scratchpad item to long-term memory
 */
function promoteScratchToMemory(key: string, value: string, category: string) {
  try {
    const memoryType = category === 'plan' ? 'decision' : category === 'goal' ? 'preference' : 'note';
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO memories (id, content, type, tags, importance, strength, access_count, created_at, last_accessed, confidence, source_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, `[Auto-promoted from scratchpad:${key}] ${value}`, memoryType, JSON.stringify([category, 'auto-promoted']), 0.6, 1.0, 1, now, now, 0.7, 1);

    return { success: true, memory_id: id, type: memoryType };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Store a plan/goal in scratchpad with special tracking
 */
function scratchPlan(planId: string, description: string, steps?: string[], ttlHours: number = 24) {
  const value = JSON.stringify({
    description,
    steps: steps || [],
    status: 'active',
    created_at: new Date().toISOString()
  });

  const ttlSeconds = ttlHours * 3600;
  return scratchSet(`plan:${planId}`, value, ttlSeconds, 'plan');
}

/**
 * Update plan progress
 */
function scratchPlanUpdate(planId: string, completedSteps: number[], status?: string) {
  const key = `plan:${planId}`;
  const row = db.prepare('SELECT value FROM scratchpad WHERE key = ?').get(key) as { value: string } | undefined;

  if (!row) {
    return { error: 'Plan not found', planId };
  }

  const plan = JSON.parse(row.value);
  plan.completedSteps = completedSteps;
  if (status) plan.status = status;
  plan.updated_at = new Date().toISOString();

  db.prepare('UPDATE scratchpad SET value = ?, last_accessed = datetime("now") WHERE key = ?')
    .run(JSON.stringify(plan), key);

  return { planId, updated: true, status: plan.status, completedSteps };
}

/**
 * Get all active plans
 */
function scratchPlans() {
  const rows = db.prepare(`
    SELECT * FROM scratchpad
    WHERE category = 'plan' AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at DESC
  `).all() as ScratchRow[];

  return rows.map(r => {
    const plan = JSON.parse(r.value);
    return {
      key: r.key,
      planId: r.key.replace('plan:', ''),
      description: plan.description,
      status: plan.status,
      steps: plan.steps?.length || 0,
      completedSteps: plan.completedSteps?.length || 0,
      created_at: plan.created_at,
      access_count: r.access_count || 0
    };
  });
}

/**
 * Restore session context - get relevant items from current or previous session
 */
function scratchRestore(sessionId?: string) {
  const targetSession = sessionId || getSessionId();

  // Get items from the target session
  const sessionItems = db.prepare(`
    SELECT * FROM scratchpad
    WHERE session_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY last_accessed DESC
  `).all(targetSession) as ScratchRow[];

  // Get active plans (any session)
  const activePlans = db.prepare(`
    SELECT * FROM scratchpad
    WHERE category = 'plan' AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at DESC LIMIT 5
  `).all() as ScratchRow[];

  // Get high-access items that might be important
  const frequentItems = db.prepare(`
    SELECT * FROM scratchpad
    WHERE access_count >= 3 AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY access_count DESC LIMIT 5
  `).all() as ScratchRow[];

  return {
    current_session: getSessionId(),
    restored_session: targetSession,
    session_items: sessionItems.map(r => ({
      key: r.key,
      preview: r.value.slice(0, 150),
      category: r.category || 'general',
      access_count: r.access_count || 0
    })),
    active_plans: activePlans.map(r => {
      const plan = JSON.parse(r.value);
      return { key: r.key, description: plan.description, status: plan.status };
    }),
    frequent_items: frequentItems.map(r => ({
      key: r.key,
      preview: r.value.slice(0, 100),
      access_count: r.access_count || 0
    }))
  };
}

/**
 * List previous sessions for context restoration
 */
function scratchSessions() {
  const sessions = db.prepare(`
    SELECT session_id, COUNT(*) as item_count, MAX(last_accessed) as last_activity
    FROM scratchpad
    WHERE session_id IS NOT NULL
    GROUP BY session_id
    ORDER BY last_activity DESC
    LIMIT 10
  `).all() as { session_id: string; item_count: number; last_activity: string }[];

  return {
    current_session: getSessionId(),
    sessions: sessions
  };
}

// ============================================================================
// Session Briefing
// ============================================================================
function generateBriefing(maxTokens = 2000) {
  const recentHigh = db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND confidence >= 0.7 ORDER BY last_accessed DESC LIMIT 5`).all() as MemoryRow[];
  const scratch = db.prepare('SELECT * FROM scratchpad WHERE expires_at IS NULL OR expires_at > datetime("now") ORDER BY created_at DESC LIMIT 3').all() as ScratchRow[];
  const contradictions = db.prepare(`SELECT m.* FROM memories m JOIN edges e ON m.id = e.from_id OR m.id = e.to_id WHERE e.relation_type = 'potential_contradiction' AND e.valid_to IS NULL AND m.deleted_at IS NULL LIMIT 3`).all() as MemoryRow[];
  
  const stats = getStats();
  
  return {
    summary: {
      totalMemories: stats.total,
      withEmbeddings: stats.withEmbedding,
      embeddingCoverage: `${stats.embeddingCoverage}%`,
      confidenceBreakdown: stats.byConfidenceLevel,
      scratchpadItems: stats.scratchpadItems
    },
    recentImportant: recentHigh.map(m => ({ id: m.id, preview: m.content.slice(0, 150), confidence: calculateEffectiveConfidence(m), type: m.type })),
    workingMemory: scratch.map(s => ({ key: s.key, preview: s.value.slice(0, 100) })),
    needsAttention: contradictions.length > 0 ? contradictions.map(m => ({ id: m.id, preview: m.content.slice(0, 100), issue: 'potential_contradiction' })) : [],
    version: '1.8.0'
  };
}

// ============================================================================
// v1.8: Backup/Restore Operations
// ============================================================================
function backupMemories(path?: string, includeDeleted = false, includeScratchpad = true, includeEmbeddings = false): { success: boolean; path: string; stats: any } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path ? resolve(path) : join(BACKUP_DIR, `backup-${timestamp}.json`);
  
  // Ensure parent directory exists
  const parentDir = dirname(backupPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  
  // Get memories
  const memorySql = includeDeleted 
    ? 'SELECT * FROM memories'
    : 'SELECT * FROM memories WHERE deleted_at IS NULL';
  const memories = db.prepare(memorySql).all() as MemoryRow[];
  
  // Get edges
  const edges = db.prepare('SELECT * FROM edges').all() as EdgeRow[];
  
  // Get scratchpad
  const scratchpad = includeScratchpad 
    ? db.prepare('SELECT * FROM scratchpad').all() as ScratchRow[]
    : [];
  
  // Build backup data
  const backup: BackupData = {
    version: '1.8.0',
    created_at: new Date().toISOString(),
    memories: memories.map(m => {
      const { embedding, ...rest } = m;
      const result: any = { ...rest };
      if (includeEmbeddings && embedding) {
        result.embedding_base64 = embedding.toString('base64');
      }
      return result;
    }),
    edges,
    scratchpad
  };
  
  // Write file
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');
  
  return {
    success: true,
    path: backupPath,
    stats: {
      memories: memories.length,
      edges: edges.length,
      scratchpad: scratchpad.length,
      includeDeleted,
      includeScratchpad,
      includeEmbeddings,
      sizeBytes: JSON.stringify(backup).length
    }
  };
}

async function restoreMemories(path: string, mode: 'merge' | 'replace' = 'merge'): Promise<{ success: boolean; stats: any }> {
  const backupPath = resolve(path);
  
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }
  
  const content = readFileSync(backupPath, 'utf-8');
  let backup: BackupData;
  
  try {
    backup = JSON.parse(content);
  } catch (err) {
    throw new Error('Invalid backup file format - not valid JSON');
  }
  
  // Validate backup format
  if (!backup.version || !backup.memories || !Array.isArray(backup.memories)) {
    throw new Error('Invalid backup file format - missing required fields');
  }
  
  const stats = {
    mode,
    memoriesProcessed: 0,
    memoriesInserted: 0,
    memoriesSkipped: 0,
    edgesProcessed: 0,
    edgesInserted: 0,
    edgesSkipped: 0,
    scratchpadProcessed: 0,
    scratchpadInserted: 0,
    embeddingsRestored: 0,
    embeddingsRegenerated: 0
  };
  
  // Use transaction for atomicity
  const restoreTransaction = db.transaction(async () => {
    // Clear existing data if replace mode
    if (mode === 'replace') {
      db.prepare('DELETE FROM edges').run();
      db.prepare('DELETE FROM scratchpad').run();
      db.prepare('DELETE FROM memories').run();
    }
    
    // Restore memories
    for (const m of backup.memories) {
      stats.memoriesProcessed++;
      
      // Check if memory exists
      const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(m.id);
      
      if (existing && mode === 'merge') {
        stats.memoriesSkipped++;
        continue;
      }
      
      // Handle embedding
      let embeddingBuffer: Buffer | null = null;
      if (m.embedding_base64) {
        embeddingBuffer = Buffer.from(m.embedding_base64, 'base64');
        stats.embeddingsRestored++;
      }
      
      if (mode === 'replace' || !existing) {
        db.prepare(`
          INSERT OR REPLACE INTO memories 
          (id, content, type, tags, importance, strength, access_count, created_at, last_accessed, deleted_at, confidence, source_count, contradiction_count, embedding)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          m.id, m.content, m.type, m.tags, m.importance, m.strength, m.access_count,
          m.created_at, m.last_accessed, m.deleted_at, m.confidence, m.source_count, m.contradiction_count,
          embeddingBuffer
        );
        stats.memoriesInserted++;
      }
    }
    
    // Restore edges
    if (backup.edges) {
      for (const e of backup.edges) {
        stats.edgesProcessed++;
        
        const existing = db.prepare('SELECT id FROM edges WHERE id = ?').get(e.id);
        
        if (existing && mode === 'merge') {
          stats.edgesSkipped++;
          continue;
        }
        
        if (mode === 'replace' || !existing) {
          db.prepare(`
            INSERT OR REPLACE INTO edges 
            (id, from_id, to_id, relation_type, valid_from, valid_to, confidence, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(e.id, e.from_id, e.to_id, e.relation_type, e.valid_from, e.valid_to, e.confidence, e.metadata, e.created_at);
          stats.edgesInserted++;
        }
      }
    }
    
    // Restore scratchpad
    if (backup.scratchpad) {
      for (const s of backup.scratchpad) {
        stats.scratchpadProcessed++;
        
        const existing = db.prepare('SELECT key FROM scratchpad WHERE key = ?').get(s.key);
        
        if (existing && mode === 'merge') {
          continue;
        }
        
        if (mode === 'replace' || !existing) {
          db.prepare(`
            INSERT OR REPLACE INTO scratchpad (key, value, expires_at, created_at)
            VALUES (?, ?, ?, ?)
          `).run(s.key, s.value, s.expires_at, s.created_at);
          stats.scratchpadInserted++;
        }
      }
    }
  });
  
  // Execute transaction (note: transaction itself is sync, embedding gen is separate)
  restoreTransaction();
  
  // Regenerate missing embeddings if embedder is ready
  if (embedderReady) {
    const noEmbedding = db.prepare('SELECT * FROM memories WHERE embedding IS NULL AND deleted_at IS NULL').all() as MemoryRow[];
    for (const m of noEmbedding) {
      const embedding = await generateEmbedding(m.content);
      if (embedding) {
        db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(Buffer.from(embedding.buffer), m.id);
        stats.embeddingsRegenerated++;
      }
    }
  }
  
  return { success: true, stats };
}

function listBackups(directory?: string): { backups: Array<{ filename: string; path: string; created: string; sizeBytes: number }>; directory: string } {
  const backupDir = directory ? resolve(directory) : BACKUP_DIR;
  
  if (!existsSync(backupDir)) {
    return { backups: [], directory: backupDir };
  }
  
  const files = require('fs').readdirSync(backupDir) as string[];
  const backups = files
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => {
      const fullPath = join(backupDir, f);
      const stats = require('fs').statSync(fullPath);
      return {
        filename: f,
        path: fullPath,
        created: stats.birthtime.toISOString(),
        sizeBytes: stats.size
      };
    })
    .sort((a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime());
  
  return { backups, directory: backupDir };
}

// ============================================================================
// Bi-temporal Memory Operations (v1.8.1)
// ============================================================================

/**
 * Query memories as they existed at a specific point in time.
 * Implements "as-of" query for temporal reasoning.
 */
function memoryAtTime(asOf: string, query?: string, limit = 20, includeSuperseded = false) {
  const asOfDate = new Date(asOf);
  if (isNaN(asOfDate.getTime())) {
    throw new Error('Invalid asOf date format. Use ISO 8601 format (e.g., "2026-01-20T12:00:00Z")');
  }

  // Build query for memories valid at the given time
  let sql = `
    SELECT * FROM memories
    WHERE deleted_at IS NULL
    AND created_at <= ?
  `;
  const params: any[] = [asOf];

  // Exclude superseded memories unless explicitly requested
  if (!includeSuperseded) {
    sql += ` AND (superseded_by IS NULL OR valid_to > ?)`;
    params.push(asOf);
  }

  // Add text search if query provided
  if (query) {
    sql += ` AND content LIKE ?`;
    params.push(`%${sanitizeLikePattern(query)}%`);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const memories = db.prepare(sql).all(...params) as MemoryRow[];

  return {
    asOf,
    query: query || null,
    count: memories.length,
    includeSuperseded,
    memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      type: m.type,
      confidence: calculateEffectiveConfidence(m),
      created_at: m.created_at,
      valid_from: m.valid_from,
      valid_to: m.valid_to,
      superseded_by: m.superseded_by,
      is_current: m.superseded_by === null
    }))
  };
}

/**
 * Mark a memory as superseding (replacing) another memory.
 * The old memory is preserved for history but marked as no longer current.
 */
function supersedeMemory(oldMemoryId: string, newMemoryId: string, validFrom?: string) {
  // Verify both memories exist
  const oldMemory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(oldMemoryId) as MemoryRow | undefined;
  const newMemory = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(newMemoryId) as MemoryRow | undefined;

  if (!oldMemory) {
    throw new Error(`Old memory not found: ${oldMemoryId}`);
  }
  if (!newMemory) {
    throw new Error(`New memory not found: ${newMemoryId}`);
  }

  // Check if old memory is already superseded
  if (oldMemory.superseded_by) {
    return {
      success: false,
      error: 'Memory already superseded',
      superseded_by: oldMemory.superseded_by,
      superseded_at: oldMemory.valid_to
    };
  }

  const now = validFrom || new Date().toISOString();

  // Update old memory to mark it as superseded
  db.prepare(`
    UPDATE memories
    SET superseded_by = ?, valid_to = ?
    WHERE id = ?
  `).run(newMemoryId, now, oldMemoryId);

  // Update new memory to record what it supersedes
  db.prepare(`
    UPDATE memories
    SET supersedes = ?, valid_from = ?
    WHERE id = ?
  `).run(oldMemoryId, now, newMemoryId);

  // Create an edge to track the supersession relationship
  const edgeId = randomUUID();
  db.prepare(`
    INSERT INTO edges (id, from_id, to_id, relation_type, valid_from, confidence, metadata)
    VALUES (?, ?, ?, 'supersedes', ?, 1.0, '{}')
  `).run(edgeId, newMemoryId, oldMemoryId, now);

  return {
    success: true,
    oldMemory: {
      id: oldMemoryId,
      content_preview: oldMemory.content.slice(0, 100),
      valid_to: now,
      superseded_by: newMemoryId
    },
    newMemory: {
      id: newMemoryId,
      content_preview: newMemory.content.slice(0, 100),
      valid_from: now,
      supersedes: oldMemoryId
    },
    edge_id: edgeId
  };
}

/**
 * Get the supersession history of a memory.
 * Shows what the memory replaced and what replaced it.
 */
function getMemoryHistory(memoryId: string) {
  const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as MemoryRow | undefined;

  if (!memory) {
    throw new Error(`Memory not found: ${memoryId}`);
  }

  // Get chain of predecessors (what this memory replaced)
  const predecessors: any[] = [];
  let currentId = memory.supersedes;
  while (currentId) {
    const pred = db.prepare('SELECT id, content, created_at, valid_from, valid_to, supersedes FROM memories WHERE id = ?').get(currentId) as any;
    if (!pred) break;
    predecessors.push({
      id: pred.id,
      content_preview: pred.content.slice(0, 100),
      created_at: pred.created_at,
      valid_from: pred.valid_from,
      valid_to: pred.valid_to
    });
    currentId = pred.supersedes;
  }

  // Get chain of successors (what replaced this memory)
  const successors: any[] = [];
  currentId = memory.superseded_by;
  while (currentId) {
    const succ = db.prepare('SELECT id, content, created_at, valid_from, valid_to, superseded_by FROM memories WHERE id = ?').get(currentId) as any;
    if (!succ) break;
    successors.push({
      id: succ.id,
      content_preview: succ.content.slice(0, 100),
      created_at: succ.created_at,
      valid_from: succ.valid_from,
      valid_to: succ.valid_to
    });
    currentId = succ.superseded_by;
  }

  return {
    memory: {
      id: memory.id,
      content: memory.content,
      created_at: memory.created_at,
      valid_from: memory.valid_from,
      valid_to: memory.valid_to,
      is_current: memory.superseded_by === null,
      supersedes: memory.supersedes,
      superseded_by: memory.superseded_by
    },
    predecessors: predecessors.reverse(), // oldest first
    successors, // newest last
    chain_length: predecessors.length + successors.length + 1
  };
}

// ============================================================================
// MCP Server Setup
// ============================================================================
const server = new Server({ name: 'just-memory', version: '1.8.0' }, { capabilities: { tools: {} } });

// Tool schemas - 33 tools (28 + 5 new scratchpad: scratch_plan, scratch_plan_update, scratch_plans, scratch_restore, scratch_sessions)
const TOOLS = {
  // Core Memory (8)
  memory_store: { name: 'memory_store', description: 'Store a new memory with optional embedding generation', inputSchema: {
    type: 'object' as const, properties: {
      content: { type: 'string', description: 'Content to remember' },
      type: { type: 'string', default: 'note' },
      tags: { type: 'array', items: { type: 'string' } },
      importance: { type: 'number', minimum: 0, maximum: 1 },
      confidence: { type: 'number', minimum: 0, maximum: 1 }
    }, required: ['content']
  }},
  memory_recall: { name: 'memory_recall', description: 'Retrieve a memory by ID (boosts strength)', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id']
  }},
  memory_update: { name: 'memory_update', description: 'Edit existing memory (content, type, tags, importance, confidence). Regenerates embedding if content changes.', inputSchema: {
    type: 'object' as const, properties: {
      id: { type: 'string' }, content: { type: 'string' }, type: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      importance: { type: 'number', minimum: 0, maximum: 1 },
      confidence: { type: 'number', minimum: 0, maximum: 1 }
    }, required: ['id']
  }},
  memory_search: { name: 'memory_search', description: 'Search memories. Modes: keyword (LIKE), semantic (embeddings), hybrid (both). Hybrid recommended.', inputSchema: {
    type: 'object' as const, properties: {
      query: { type: 'string' },
      limit: { type: 'number', default: 10 },
      confidenceThreshold: { type: 'number', default: 0, description: 'Min confidence (0-1)' },
      mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], default: 'hybrid' },
      alpha: { type: 'number', default: 0.5, description: 'Hybrid weight: 0=pure semantic, 1=pure keyword' }
    }, required: ['query']
  }},
  memory_list: { name: 'memory_list', description: 'List recent memories', inputSchema: {
    type: 'object' as const, properties: {
      limit: { type: 'number', default: 20 },
      includeWeak: { type: 'boolean', default: false },
      includeUncertain: { type: 'boolean', default: false }
    }
  }},
  memory_delete: { name: 'memory_delete', description: 'Soft-delete memory (or permanent)', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' }, permanent: { type: 'boolean', default: false } }, required: ['id']
  }},
  memory_stats: { name: 'memory_stats', description: 'Database statistics including embedding coverage', inputSchema: {
    type: 'object' as const, properties: {}
  }},
  memory_embed: { name: 'memory_embed', description: 'Generate embeddings for existing memories. Omit IDs to embed all without embeddings.', inputSchema: {
    type: 'object' as const, properties: {
      ids: { type: 'array', items: { type: 'string' } }
    }
  }},
  
  // v1.8: Backup/Restore (2)
  memory_backup: { name: 'memory_backup', description: 'Export memories, edges, and scratchpad to JSON backup file. Default path: ~/.just-memory/backups/', inputSchema: {
    type: 'object' as const, properties: {
      path: { type: 'string', description: 'Custom backup file path (optional)' },
      includeDeleted: { type: 'boolean', default: false, description: 'Include soft-deleted memories' },
      includeScratchpad: { type: 'boolean', default: true, description: 'Include working memory' },
      includeEmbeddings: { type: 'boolean', default: false, description: 'Include embedding vectors (larger file)' }
    }
  }},
  memory_restore: { name: 'memory_restore', description: 'Import memories from backup file. Merge keeps existing, replace clears first.', inputSchema: {
    type: 'object' as const, properties: {
      path: { type: 'string', description: 'Backup file path to restore from' },
      restoreMode: { type: 'string', enum: ['merge', 'replace'], default: 'merge', description: 'merge=keep existing, replace=clear first' }
    }, required: ['path']
  }},
  memory_list_backups: { name: 'memory_list_backups', description: 'List available backup files. Default directory: ~/.just-memory/backups/', inputSchema: {
    type: 'object' as const, properties: {
      directory: { type: 'string', description: 'Custom directory to list backups from (optional)' }
    }
  }},
  
  // Confidence (3)
  memory_confirm: { name: 'memory_confirm', description: 'Confirm memory with additional source', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' }, sourceId: { type: 'string' } }, required: ['id']
  }},
  memory_contradict: { name: 'memory_contradict', description: 'Record contradiction to memory', inputSchema: {
    type: 'object' as const, properties: { id: { type: 'string' }, contradictingId: { type: 'string' } }, required: ['id']
  }},
  memory_confident: { name: 'memory_confident', description: 'Get high-confidence memories', inputSchema: {
    type: 'object' as const, properties: { confidenceThreshold: { type: 'number', default: 0.8 }, limit: { type: 'number', default: 10 } }
  }},
  
  // Edges (3)
  edge_create: { name: 'edge_create', description: 'Create bi-temporal edge between memories', inputSchema: {
    type: 'object' as const, properties: {
      fromId: { type: 'string' }, toId: { type: 'string' }, relationType: { type: 'string' },
      validFrom: { type: 'string' }, validTo: { type: 'string' },
      confidence: { type: 'number', default: 1 }, metadata: { type: 'object' }
    }, required: ['fromId', 'toId', 'relationType']
  }},
  edge_query: { name: 'edge_query', description: 'Query edges for a memory', inputSchema: {
    type: 'object' as const, properties: {
      memoryId: { type: 'string' },
      direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], default: 'both' },
      relationTypes: { type: 'array', items: { type: 'string' } },
      asOfDate: { type: 'string' }, includeExpired: { type: 'boolean', default: false }
    }, required: ['memoryId']
  }},
  edge_invalidate: { name: 'edge_invalidate', description: 'Invalidate an edge', inputSchema: {
    type: 'object' as const, properties: { edgeId: { type: 'string' }, validTo: { type: 'string' } }, required: ['edgeId']
  }},
  
  // Graph (1)
  graph_traverse: { name: 'graph_traverse', description: 'Traverse graph with spreading activation from seed memories', inputSchema: {
    type: 'object' as const, properties: {
      seedIds: { type: 'array', items: { type: 'string' } },
      maxHops: { type: 'number', default: 2 },
      decayFactor: { type: 'number', default: 0.5 },
      inhibitionThreshold: { type: 'number', default: 0.1 },
      minActivation: { type: 'number', default: 0.1 }
    }, required: ['seedIds']
  }},
  
  // Scratchpad (10) - Enhanced with auto-promotion and plan awareness
  scratch_set: { name: 'scratch_set', description: 'Set working memory value. Auto-promotes to long-term after 5 accesses.', inputSchema: {
    type: 'object' as const, properties: {
      key: { type: 'string' }, value: { type: 'string' }, ttlSeconds: { type: 'number' },
      category: { type: 'string', enum: ['general', 'plan', 'context', 'goal'], default: 'general' }
    }, required: ['key', 'value']
  }},
  scratch_get: { name: 'scratch_get', description: 'Get working memory value. Tracks access count for auto-promotion.', inputSchema: {
    type: 'object' as const, properties: { key: { type: 'string' } }, required: ['key']
  }},
  scratch_delete: { name: 'scratch_delete', description: 'Delete working memory key', inputSchema: {
    type: 'object' as const, properties: { key: { type: 'string' } }, required: ['key']
  }},
  scratch_clear: { name: 'scratch_clear', description: 'Clear all working memory and reset session', inputSchema: {
    type: 'object' as const, properties: {}
  }},
  scratch_list: { name: 'scratch_list', description: 'List working memory keys with access counts', inputSchema: {
    type: 'object' as const, properties: {}
  }},
  scratch_plan: { name: 'scratch_plan', description: 'Store a plan/goal with steps in working memory', inputSchema: {
    type: 'object' as const, properties: {
      planId: { type: 'string', description: 'Unique plan identifier' },
      description: { type: 'string', description: 'Plan description' },
      steps: { type: 'array', items: { type: 'string' }, description: 'Steps to complete the plan' },
      ttlHours: { type: 'number', default: 24, description: 'Hours until plan expires' }
    }, required: ['planId', 'description']
  }},
  scratch_plan_update: { name: 'scratch_plan_update', description: 'Update plan progress', inputSchema: {
    type: 'object' as const, properties: {
      planId: { type: 'string' },
      completedSteps: { type: 'array', items: { type: 'number' }, description: 'Indices of completed steps' },
      status: { type: 'string', enum: ['active', 'paused', 'completed', 'abandoned'] }
    }, required: ['planId', 'completedSteps']
  }},
  scratch_plans: { name: 'scratch_plans', description: 'List all active plans', inputSchema: {
    type: 'object' as const, properties: {}
  }},
  scratch_restore: { name: 'scratch_restore', description: 'Restore session context from current or previous session', inputSchema: {
    type: 'object' as const, properties: {
      sessionId: { type: 'string', description: 'Session ID to restore from (optional, defaults to current)' }
    }
  }},
  scratch_sessions: { name: 'scratch_sessions', description: 'List previous sessions for context restoration', inputSchema: {
    type: 'object' as const, properties: {}
  }},
  
  // Session (1)
  memory_briefing: { name: 'memory_briefing', description: 'Generate session briefing with recent important memories and items needing attention', inputSchema: {
    type: 'object' as const, properties: { maxTokens: { type: 'number', default: 2000 } }
  }},

  // Bi-temporal Memory (3) - Track when facts were valid AND when we learned them
  memory_at_time: { name: 'memory_at_time', description: 'Query memories as they existed at a point in time. Returns memories that were valid (not superseded) at the given timestamp.', inputSchema: {
    type: 'object' as const, properties: {
      asOf: { type: 'string', description: 'ISO timestamp to query memories at (e.g., "2026-01-20T12:00:00Z")' },
      query: { type: 'string', description: 'Optional search query to filter results' },
      limit: { type: 'number', default: 20, description: 'Maximum results to return' },
      includeSuperseded: { type: 'boolean', default: false, description: 'Include memories that were later superseded' }
    }, required: ['asOf']
  }},
  memory_supersede: { name: 'memory_supersede', description: 'Mark a memory as superseding (replacing) another memory. The old memory is marked invalid but preserved for history.', inputSchema: {
    type: 'object' as const, properties: {
      oldMemoryId: { type: 'string', description: 'ID of the memory being replaced' },
      newMemoryId: { type: 'string', description: 'ID of the new memory that replaces it' },
      validFrom: { type: 'string', description: 'When the new fact became valid (optional, defaults to now)' }
    }, required: ['oldMemoryId', 'newMemoryId']
  }},
  memory_history: { name: 'memory_history', description: 'Get the supersession history of a memory - what it replaced and what replaced it.', inputSchema: {
    type: 'object' as const, properties: {
      memoryId: { type: 'string', description: 'Memory ID to get history for' }
    }, required: ['memoryId']
  }}
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.values(TOOLS) }));

// Tool request handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args || {}) as ToolArgs;
  
  try {
    let result: any;
    
    switch (name) {
      // Core memory
      case 'memory_store': result = await storeMemory(a.content!, a.type, a.tags, a.importance, a.confidence); break;
      case 'memory_recall': result = recallMemory(a.id!); break;
      case 'memory_update': result = await updateMemory(a.id!, { content: a.content, type: a.type, tags: a.tags, importance: a.importance, confidence: a.confidence }); break;
      case 'memory_search': result = await searchMemories(a.query!, a.limit, a.confidenceThreshold, a.mode, a.alpha); break;
      case 'memory_list': result = listMemories(a.limit, a.includeWeak, a.includeUncertain); break;
      case 'memory_delete': result = deleteMemory(a.id!, a.permanent); break;
      case 'memory_stats': result = getStats(); break;
      case 'memory_embed': result = await embedMemories(a.ids); break;
      
      // v1.8: Backup/Restore
      case 'memory_backup': result = backupMemories(a.path, a.includeDeleted, a.includeScratchpad, a.includeEmbeddings); break;
      case 'memory_restore': result = await restoreMemories(a.path!, a.restoreMode); break;
      case 'memory_list_backups': result = listBackups(a.directory); break;
      
      // Confidence
      case 'memory_confirm': result = confirmMemory(a.id!, a.sourceId); break;
      case 'memory_contradict': result = contradictMemory(a.id!, a.contradictingId); break;
      case 'memory_confident': result = getConfidentMemories(a.confidenceThreshold, a.limit); break;
      
      // Edges
      case 'edge_create': result = createEdge(a.fromId!, a.toId!, a.relationType!, a.validFrom, a.validTo, a.confidence, a.metadata); break;
      case 'edge_query': result = queryEdges(a.memoryId!, a.direction, a.relationTypes, a.asOfDate, a.includeExpired); break;
      case 'edge_invalidate': result = invalidateEdge(a.edgeId!, a.validTo); break;
      
      // Graph
      case 'graph_traverse': result = traverseGraph(a.seedIds!, a.maxHops, a.decayFactor, a.inhibitionThreshold, a.minActivation); break;
      
      // Scratchpad (enhanced)
      case 'scratch_set': result = scratchSet(a.key!, a.value!, a.ttlSeconds, a.category); break;
      case 'scratch_get': result = scratchGet(a.key!); break;
      case 'scratch_delete': result = scratchDelete(a.key!); break;
      case 'scratch_clear': result = scratchClear(); break;
      case 'scratch_list': result = scratchList(); break;
      case 'scratch_plan': result = scratchPlan(a.planId!, a.description!, a.steps, a.ttlHours); break;
      case 'scratch_plan_update': result = scratchPlanUpdate(a.planId!, a.completedSteps!); break;
      case 'scratch_plans': result = scratchPlans(); break;
      case 'scratch_restore': result = scratchRestore(a.sessionId); break;
      case 'scratch_sessions': result = scratchSessions(); break;
      
      // Session
      case 'memory_briefing': result = generateBriefing(a.maxTokens); break;

      // Bi-temporal Memory
      case 'memory_at_time': result = memoryAtTime(a.asOf!, a.query, a.limit, a.includeSuperseded); break;
      case 'memory_supersede': result = supersedeMemory(a.oldMemoryId!, a.newMemoryId!, a.validFrom); break;
      case 'memory_history': result = getMemoryHistory(a.memoryId!); break;

      default:
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
    }
    
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: JSON.stringify({ error: errorMsg }) }] };
  }
});

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.error('[Just-Memory v1.8] Starting...');
  
  await initEmbedder();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('[Just-Memory v1.8.1] Server running - 33 tools available (bi-temporal + advanced scratchpad)');
}

main().catch(err => {
  console.error('[Just-Memory v1.8] Fatal error:', err);
  process.exit(1);
});
