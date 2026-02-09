/**
 * Chat Ingestion System for Just-Memory
 *
 * Hierarchical Memory Architecture:
 *
 * Layer 1: LOSSLESS - Full conversations stored verbatim
 *   - conversations: session metadata
 *   - messages: individual messages with full content
 *   - tool_uses: tool calls and results (crucial for "the process")
 *
 * Layer 2: EXTRACTED - Atomic knowledge units
 *   - Derived facts, decisions, procedures from conversations
 *   - Links back to source messages for traceability
 *
 * Layer 3: SUMMARIZED - Condensed conversation summaries
 *   - Per-conversation summaries
 *   - Topic clusters across conversations
 *
 * Philosophy: "The process matters, not just the output"
 * - Every reasoning step is preserved
 * - Every tool call captures the exploration journey
 * - Summaries are derived views, never replacing originals
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'fs';
import { join, basename, dirname, resolve, sep } from 'path';
import { homedir } from 'os';
import { sanitizeLikePattern } from './validation.js';
import { generateEmbedding, generateSummary } from './models.js';
import { SUMMARIZATION_MODEL } from './config.js';

// ============================================================================
// Path Validation
// ============================================================================

/** Allowed base directories for chat file ingestion */
const ALLOWED_CHAT_BASES = [
  join(homedir(), '.claude'),
  join(homedir(), '.config', 'Claude'),
  join(homedir(), 'Library', 'Application Support', 'Claude'),
  join(homedir(), 'AppData', 'Roaming', 'Claude'),
];

/**
 * Validate that a file path resolves to within an allowed base directory.
 * Prevents path traversal attacks via symlinks or ../../ sequences.
 * Returns the resolved real path or null if invalid.
 */
function validateChatFilePath(filePath: string): string | null {
  try {
    const resolved = resolve(filePath);
    // Must exist to check real path
    if (!existsSync(resolved)) return null;
    const realPath = realpathSync(resolved);
    // Check against allowed bases
    for (const base of ALLOWED_CHAT_BASES) {
      const resolvedBase = resolve(base);
      if (realPath.startsWith(resolvedBase + sep) || realPath === resolvedBase) {
        return realPath;
      }
    }
    // If no allowed base matched, reject
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Types
// ============================================================================

interface ClaudeCodeMessage {
  type: 'user' | 'assistant' | 'queue-operation';
  parentUuid?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
    model?: string;
    id?: string;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

interface ParsedConversation {
  sessionId: string;
  source: 'claude-code' | 'claude-desktop';
  projectPath?: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  messages: ParsedMessage[];
  toolUses: ParsedToolUse[];
}

interface ParsedMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  parentId?: string;
  model?: string;
  tokenUsage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
}

interface ParsedToolUse {
  id: string;
  messageId: string;
  conversationId: string;
  toolName: string;
  input: string;
  output?: string;
  isError: boolean;
  timestamp: string;
}

// ============================================================================
// Database Schema
// ============================================================================

export function initChatSchema(db: Database.Database): void {
  // Layer 1: Lossless Storage

  // Conversations table - session-level metadata
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      source TEXT NOT NULL,                    -- 'claude-code', 'claude-desktop'
      source_path TEXT,                        -- original file path
      source_session_id TEXT,                  -- original session ID from source
      project_context TEXT,                    -- cwd or project path
      started_at TEXT NOT NULL,
      ended_at TEXT,
      message_count INTEGER DEFAULT 0,
      tool_use_count INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      model TEXT,                              -- primary model used
      version TEXT,                            -- claude code version
      raw_hash TEXT,                           -- SHA256 of raw content for dedup
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source, source_session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
    CREATE INDEX IF NOT EXISTS idx_conversations_started ON conversations(started_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_hash ON conversations(raw_hash);
  `);

  // Messages table - individual messages with full content
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      project_id TEXT DEFAULT 'global',
      role TEXT NOT NULL,                      -- 'user', 'assistant'
      content TEXT NOT NULL,                   -- full message content
      content_type TEXT DEFAULT 'text',        -- 'text', 'mixed' (has tool calls)
      parent_message_id TEXT,                  -- for threading
      sequence_num INTEGER,                    -- order in conversation
      timestamp TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      embedding BLOB,                          -- for semantic search within conversations
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conv_messages_project ON conversation_messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_conv_messages_role ON conversation_messages(role);
    CREATE INDEX IF NOT EXISTS idx_conv_messages_timestamp ON conversation_messages(timestamp);
  `);

  // Tool uses table - preserves "the process"
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_tool_uses (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      project_id TEXT DEFAULT 'global',
      tool_name TEXT NOT NULL,
      input_json TEXT,                         -- full input as JSON
      output_text TEXT,                        -- full output/result
      output_truncated INTEGER DEFAULT 0,      -- 1 if output was truncated
      is_error INTEGER DEFAULT 0,
      duration_ms INTEGER,
      sequence_num INTEGER,                    -- order within message
      timestamp TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conv_tools_message ON conversation_tool_uses(message_id);
    CREATE INDEX IF NOT EXISTS idx_conv_tools_conv ON conversation_tool_uses(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conv_tools_name ON conversation_tool_uses(tool_name);
    CREATE INDEX IF NOT EXISTS idx_conv_tools_project ON conversation_tool_uses(project_id);
  `);

  // Layer 2: Extracted Knowledge (links to existing memories table)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_sources (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      conversation_id TEXT,
      message_id TEXT,
      tool_use_id TEXT,
      extraction_type TEXT NOT NULL,           -- 'manual', 'auto', 'llm'
      confidence REAL DEFAULT 0.8,
      extracted_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mem_sources_memory ON memory_sources(memory_id);
    CREATE INDEX IF NOT EXISTS idx_mem_sources_conv ON memory_sources(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_mem_sources_message ON memory_sources(message_id);
  `);

  // Layer 3: Conversation Summaries
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      project_id TEXT DEFAULT 'global',
      summary_type TEXT NOT NULL,              -- 'brief', 'detailed', 'topics', 'decisions'
      content TEXT NOT NULL,
      model_used TEXT,                         -- which model generated summary
      created_at TEXT DEFAULT (datetime('now')),
      embedding BLOB,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conv_summaries_conv ON conversation_summaries(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conv_summaries_type ON conversation_summaries(summary_type);
  `);

  // Topic clusters - group related conversations
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_topics (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'global',
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
    );

    CREATE TABLE IF NOT EXISTS conversation_topic_links (
      conversation_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      relevance REAL DEFAULT 1.0,
      PRIMARY KEY (conversation_id, topic_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES conversation_topics(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_topic_links_topic ON conversation_topic_links(topic_id);
  `);

  console.error('[Chat Ingestion] Schema initialized');
}

// ============================================================================
// Claude Code JSONL Parser
// ============================================================================

const MAX_CHAT_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit (matches backup limit)

export function parseClaudeCodeJsonl(filePath: string): ParsedConversation | null {
  // Path traversal protection: validate file is within allowed chat directories
  const validPath = validateChatFilePath(filePath);
  if (!validPath) {
    console.error(`[Chat Ingestion] File path rejected (not within allowed chat directories)`);
    return null;
  }

  const fileSize = statSync(validPath).size;
  if (fileSize > MAX_CHAT_FILE_SIZE) {
    console.error(`[Chat Ingestion] File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB > 100MB limit)`);
    return null;
  }

  const content = readFileSync(validPath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length === 0) return null;

  const messages: ParsedMessage[] = [];
  const toolUses: ParsedToolUse[] = [];
  let sessionId = '';
  let projectPath = '';
  let startTime = '';
  let endTime = '';
  let sequenceNum = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    let entry: ClaudeCodeMessage;
    try {
      entry = JSON.parse(line);
    } catch {
      console.error(`[Chat Ingestion] Failed to parse JSONL line (skipping)`);
      continue;
    }

    // Skip queue operations
    if (entry.type === 'queue-operation') continue;

    // Extract session metadata
    if (!sessionId && entry.sessionId) {
      sessionId = entry.sessionId;
    }
    if (!projectPath && entry.cwd) {
      projectPath = entry.cwd;
    }

    // Track timestamps
    if (entry.timestamp) {
      if (!startTime || entry.timestamp < startTime) {
        startTime = entry.timestamp;
      }
      if (!endTime || entry.timestamp > endTime) {
        endTime = entry.timestamp;
      }
    }

    // Process messages
    if (entry.message && entry.uuid) {
      const msg = entry.message;

      // Extract text content
      let textContent = '';
      const contentBlocks: ContentBlock[] = [];

      if (typeof msg.content === 'string') {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          contentBlocks.push(block);
          if (block.type === 'text' && block.text) {
            textContent += (textContent ? '\n' : '') + block.text;
          }
        }
      }

      // Skip empty messages
      if (!textContent.trim() && contentBlocks.length === 0) continue;

      const messageId = entry.uuid;
      sequenceNum++;

      // Create message record
      messages.push({
        id: messageId,
        conversationId: sessionId,
        role: msg.role,
        content: textContent || JSON.stringify(msg.content),
        timestamp: entry.timestamp || new Date().toISOString(),
        parentId: entry.parentUuid || undefined,
        model: msg.model,
        tokenUsage: msg.usage ? {
          input: msg.usage.input_tokens || 0,
          output: msg.usage.output_tokens || 0,
          cacheRead: msg.usage.cache_read_input_tokens || 0,
          cacheCreation: msg.usage.cache_creation_input_tokens || 0,
        } : undefined,
      });

      // Extract tool uses from content blocks
      let toolSequence = 0;
      for (const block of contentBlocks) {
        if (block.type === 'tool_use' && block.name) {
          toolUses.push({
            id: block.id || randomUUID(),
            messageId,
            conversationId: sessionId,
            toolName: block.name,
            input: JSON.stringify(block.input || {}),
            isError: false,
            timestamp: entry.timestamp || new Date().toISOString(),
          });
          toolSequence++;
        } else if (block.type === 'tool_result' && block.tool_use_id) {
          // Find matching tool use and add output
          const matchingTool = toolUses.find(t => t.id === block.tool_use_id);
          if (matchingTool) {
            // content can be string, array of content blocks, or undefined
            let outputText = '';
            const blockContent = block.content as string | Array<{type: string; text?: string}> | undefined;
            if (typeof blockContent === 'string') {
              outputText = blockContent;
            } else if (Array.isArray(blockContent)) {
              // Extract text from content blocks
              outputText = blockContent
                .filter((c) => c.type === 'text' && c.text)
                .map((c) => c.text || '')
                .join('\n');
            }
            matchingTool.output = outputText;
            matchingTool.isError = block.is_error || false;
          }
        }
      }
    }
  }

  if (messages.length === 0) {
    console.error(`[Chat Ingestion] No messages found in file`);
    return null;
  }

  return {
    sessionId: sessionId || basename(validPath, '.jsonl'),
    source: 'claude-code',
    projectPath,
    startTime: startTime || new Date().toISOString(),
    endTime: endTime || new Date().toISOString(),
    messageCount: messages.length,
    messages,
    toolUses,
  };
}

// ============================================================================
// Ingestion Functions
// ============================================================================

export function ingestConversation(
  db: Database.Database,
  conversation: ParsedConversation,
  projectId: string = 'global'
): { conversationId: string; messagesImported: number; toolUsesImported: number } | null {

  // Check for duplicate
  const existing = db.prepare(`
    SELECT id FROM conversations WHERE source = ? AND source_session_id = ?
  `).get(conversation.source, conversation.sessionId) as { id: string } | undefined;

  if (existing) {
    console.error(`[Chat Ingestion] Conversation already imported: ${conversation.sessionId}`);
    return null;
  }

  const conversationId = randomUUID();

  // Calculate totals
  let totalInput = 0;
  let totalOutput = 0;
  for (const msg of conversation.messages) {
    if (msg.tokenUsage) {
      totalInput += msg.tokenUsage.input + msg.tokenUsage.cacheRead + msg.tokenUsage.cacheCreation;
      totalOutput += msg.tokenUsage.output;
    }
  }

  // Get primary model
  const assistantMsgs = conversation.messages.filter(m => m.role === 'assistant' && m.model);
  const primaryModel = assistantMsgs[0]?.model || 'unknown';

  // Insert in transaction
  const insertConversation = db.prepare(`
    INSERT INTO conversations (
      id, project_id, source, source_session_id, project_context,
      started_at, ended_at, message_count, tool_use_count,
      total_input_tokens, total_output_tokens, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMessage = db.prepare(`
    INSERT INTO conversation_messages (
      id, conversation_id, project_id, role, content, content_type,
      parent_message_id, sequence_num, timestamp, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertToolUse = db.prepare(`
    INSERT INTO conversation_tool_uses (
      id, message_id, conversation_id, project_id, tool_name,
      input_json, output_text, is_error, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    // Insert conversation - ensure all values are SQLite-bindable (no undefined)
    insertConversation.run(
      conversationId,
      projectId ?? 'global',
      conversation.source ?? 'unknown',
      conversation.sessionId ?? randomUUID(),
      conversation.projectPath ?? null,
      conversation.startTime ?? new Date().toISOString(),
      conversation.endTime ?? null,
      conversation.messageCount ?? 0,
      conversation.toolUses?.length ?? 0,
      totalInput ?? 0,
      totalOutput ?? 0,
      primaryModel ?? 'unknown'
    );

    // Insert messages
    let seq = 0;
    for (const msg of conversation.messages) {
      seq++;
      const hasToolCalls = conversation.toolUses.some(t => t.messageId === msg.id);
      // Ensure undefined values become null (SQLite can't bind undefined)
      const inputTokens = msg.tokenUsage?.input ?? null;
      const outputTokens = msg.tokenUsage?.output ?? null;
      const cacheReadTokens = msg.tokenUsage?.cacheRead ?? null;
      const cacheCreationTokens = msg.tokenUsage?.cacheCreation ?? null;
      insertMessage.run(
        msg.id ?? randomUUID(),
        conversationId,
        projectId ?? 'global',
        msg.role ?? 'unknown',
        msg.content ?? '',
        hasToolCalls ? 'mixed' : 'text',
        msg.parentId ?? null,
        seq,
        msg.timestamp ?? new Date().toISOString(),
        msg.model ?? null,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens
      );
    }

    // Insert tool uses
    for (const tool of conversation.toolUses) {
      insertToolUse.run(
        tool.id ?? randomUUID(),
        tool.messageId ?? '',
        conversationId,
        projectId ?? 'global',
        tool.toolName ?? 'unknown',
        tool.input ?? '',
        tool.output ?? null,
        tool.isError ? 1 : 0,
        tool.timestamp ?? new Date().toISOString()
      );
    }
  });

  transaction();

  console.error(`[Chat Ingestion] Imported conversation ${conversation.sessionId}: ${conversation.messages.length} messages, ${conversation.toolUses.length} tool uses`);

  return {
    conversationId,
    messagesImported: conversation.messages.length,
    toolUsesImported: conversation.toolUses.length,
  };
}

// ============================================================================
// Batch Ingestion
// ============================================================================

export function discoverClaudeCodeConversations(basePath?: string): string[] {
  const defaultPath = join(homedir(), '.claude', 'projects');
  const searchPath = basePath || defaultPath;

  // Path traversal protection: if a custom basePath is provided, validate it
  if (basePath) {
    const resolvedBase = resolve(basePath);
    let realBase: string;
    try {
      if (!existsSync(resolvedBase)) {
        console.error(`[Chat Ingestion] Path not found`);
        return [];
      }
      realBase = realpathSync(resolvedBase);
    } catch {
      console.error(`[Chat Ingestion] Cannot resolve path`);
      return [];
    }
    const isAllowed = ALLOWED_CHAT_BASES.some(allowed => {
      const resolvedAllowed = resolve(allowed);
      return realBase.startsWith(resolvedAllowed + sep) || realBase === resolvedAllowed;
    });
    if (!isAllowed) {
      console.error(`[Chat Ingestion] Base path rejected (not within allowed chat directories)`);
      return [];
    }
  }

  const jsonlFiles: string[] = [];

  if (!existsSync(searchPath)) {
    console.error(`[Chat Ingestion] Path not found`);
    return [];
  }

  function walkDir(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip subagents folder - those are internal agent logs
        if (entry.name !== 'subagents') {
          walkDir(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        // Only include top-level session files (UUID.jsonl pattern)
        const parent = basename(dirname(fullPath));
        if (!parent.startsWith('agent-')) {
          jsonlFiles.push(fullPath);
        }
      }
    }
  }

  walkDir(searchPath);
  return jsonlFiles;
}

export function ingestAllClaudeCode(
  db: Database.Database,
  projectId: string = 'global',
  basePath?: string
): { total: number; imported: number; skipped: number; errors: number } {
  const files = discoverClaudeCodeConversations(basePath);
  console.error(`[Chat Ingestion] Found ${files.length} conversation files`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const parsed = parseClaudeCodeJsonl(file);
      if (!parsed) {
        errors++;
        continue;
      }

      const result = ingestConversation(db, parsed, projectId);
      if (result) {
        imported++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[Chat Ingestion] Error processing ${file}:`, err);
      errors++;
    }
  }

  return { total: files.length, imported, skipped, errors };
}

// ============================================================================
// Query Functions
// ============================================================================

export function getConversationStats(db: Database.Database, projectId?: string): {
  totalConversations: number;
  totalMessages: number;
  totalToolUses: number;
  totalTokens: { input: number; output: number };
  bySource: Record<string, number>;
  byModel: Record<string, number>;
  dateRange: { earliest: string; latest: string };
} {
  const project = projectId || 'global';

  const convStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(message_count) as messages,
      SUM(tool_use_count) as tools,
      SUM(total_input_tokens) as input_tokens,
      SUM(total_output_tokens) as output_tokens,
      MIN(started_at) as earliest,
      MAX(ended_at) as latest
    FROM conversations
    WHERE project_id = ? OR project_id = 'global'
  `).get(project) as any;

  const bySource = db.prepare(`
    SELECT source, COUNT(*) as count
    FROM conversations
    WHERE project_id = ? OR project_id = 'global'
    GROUP BY source
  `).all(project) as { source: string; count: number }[];

  const byModel = db.prepare(`
    SELECT model, COUNT(*) as count
    FROM conversations
    WHERE project_id = ? OR project_id = 'global'
    GROUP BY model
  `).all(project) as { model: string; count: number }[];

  return {
    totalConversations: convStats.total || 0,
    totalMessages: convStats.messages || 0,
    totalToolUses: convStats.tools || 0,
    totalTokens: {
      input: convStats.input_tokens || 0,
      output: convStats.output_tokens || 0,
    },
    bySource: Object.fromEntries(bySource.map(r => [r.source, r.count])),
    byModel: Object.fromEntries(byModel.map(r => [r.model || 'unknown', r.count])),
    dateRange: {
      earliest: convStats.earliest || '',
      latest: convStats.latest || '',
    },
  };
}

export function searchConversations(
  db: Database.Database,
  query: string,
  projectId?: string,
  limit: number = 20
): {
  conversationId: string;
  messageId: string;
  role: string;
  content: string;
  timestamp: string;
  matchScore: number;
}[] {
  const project = projectId || 'global';

  // Simple keyword search for now (semantic search requires embeddings)
  const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (searchTerms.length === 0) return [];

  // Build LIKE clauses with escaped wildcards
  const likeClauses = searchTerms.map(() => "LOWER(content) LIKE ? ESCAPE '\\'").join(' AND ');
  const likeParams = searchTerms.map(t => `%${sanitizeLikePattern(t)}%`);

  const results = db.prepare(`
    SELECT
      conversation_id as conversationId,
      id as messageId,
      role,
      content,
      timestamp,
      1.0 as matchScore
    FROM conversation_messages
    WHERE (project_id = ? OR project_id = 'global')
      AND ${likeClauses}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(project, ...likeParams, limit) as any[];

  return results;
}

export function getConversation(
  db: Database.Database,
  conversationId: string
): {
  conversation: any;
  messages: any[];
  toolUses: any[];
} | null {
  const conversation = db.prepare(`
    SELECT * FROM conversations WHERE id = ?
  `).get(conversationId);

  if (!conversation) return null;

  const messages = db.prepare(`
    SELECT * FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY sequence_num
  `).all(conversationId);

  const toolUses = db.prepare(`
    SELECT * FROM conversation_tool_uses
    WHERE conversation_id = ?
    ORDER BY timestamp
  `).all(conversationId);

  return { conversation, messages, toolUses };
}

// ============================================================================
// Claude Desktop Export Parser (JSON format from data export)
// ============================================================================

interface ClaudeDesktopExportConversation {
  uuid: string;
  name: string;
  summary?: string;
  created_at: string;
  updated_at: string;
  account?: { uuid: string };
  chat_messages: ClaudeDesktopExportMessage[];
}

interface ClaudeDesktopExportMessage {
  uuid: string;
  text: string;
  content?: Array<{
    type: string;
    text?: string;
    start_timestamp?: string;
    stop_timestamp?: string;
  }>;
  sender: 'human' | 'assistant';
  created_at: string;
  updated_at: string;
  attachments?: any[];
  files?: any[];
}

export function parseClaudeDesktopExport(filePath: string): ParsedConversation[] {
  // Path traversal protection: validate file is within allowed chat directories
  const validPath = validateChatFilePath(filePath);
  if (!validPath) {
    console.error(`[Chat Ingestion] File path rejected (not within allowed chat directories)`);
    return [];
  }

  const fileSize = statSync(validPath).size;
  if (fileSize > MAX_CHAT_FILE_SIZE) {
    console.error(`[Chat Ingestion] File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB > 100MB limit)`);
    return [];
  }

  const content = readFileSync(validPath, 'utf-8');
  let data: ClaudeDesktopExportConversation[];

  try {
    data = JSON.parse(content);
  } catch {
    console.error(`[Chat Ingestion] Failed to parse JSON export file`);
    return [];
  }

  if (!Array.isArray(data)) {
    console.error('[Chat Ingestion] Expected array of conversations');
    return [];
  }

  const conversations: ParsedConversation[] = [];

  for (const conv of data) {
    if (!conv.chat_messages || conv.chat_messages.length === 0) continue;

    const messages: ParsedMessage[] = [];
    let prevMessageId: string | undefined;

    for (const msg of conv.chat_messages) {
      // Extract text content
      let textContent = msg.text || '';
      if (!textContent && msg.content) {
        textContent = msg.content
          .filter(c => c.type === 'text' && c.text)
          .map(c => c.text || '')
          .join('\n');
      }

      const messageId = msg.uuid || randomUUID();

      messages.push({
        id: messageId,
        conversationId: conv.uuid,
        role: msg.sender === 'human' ? 'user' : 'assistant',
        content: textContent,
        timestamp: msg.created_at || conv.created_at,
        parentId: prevMessageId,
        model: undefined, // Claude Desktop export doesn't include model info
        tokenUsage: undefined,
      });

      prevMessageId = messageId;
    }

    // Sort messages by timestamp
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const timestamps = messages.map(m => m.timestamp).filter(Boolean);

    conversations.push({
      sessionId: conv.uuid,
      source: 'claude-desktop',
      projectPath: undefined,
      startTime: timestamps[0] || conv.created_at,
      endTime: timestamps[timestamps.length - 1] || conv.updated_at,
      messageCount: messages.length,
      messages,
      toolUses: [], // Claude Desktop export doesn't include tool use details
    });
  }

  console.error(`[Chat Ingestion] Parsed ${conversations.length} conversations from Claude Desktop export`);
  return conversations;
}

export function ingestClaudeDesktopExport(
  db: Database.Database,
  filePath: string,
  projectId: string = 'global'
): { total: number; imported: number; skipped: number; errors: number } {
  const conversations = parseClaudeDesktopExport(filePath);
  console.error(`[Chat Ingestion] Ingesting ${conversations.length} Claude Desktop conversations`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const conv of conversations) {
    try {
      const result = ingestConversation(db, conv, projectId);
      if (result) {
        imported++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[Chat Ingestion] Error ingesting ${conv.sessionId}:`, err);
      errors++;
    }
  }

  return { total: conversations.length, imported, skipped, errors };
}

// ============================================================================
// Export for CLI usage
// ============================================================================

export type {
  ParsedConversation,
  ParsedMessage,
  ParsedToolUse,
};

// ============================================================================
// Layer 2: Mem0-Style Fact Extraction Pipeline
// ============================================================================
//
// Philosophy: Don't store everything, extract key facts
// - Complements Layer 1 (lossless) - never replaces it
// - Creates atomic, searchable knowledge units
// - Links back to source for traceability
//
// Fact Types:
// - fact: Verified information (e.g., "The project uses TypeScript")
// - decision: Choices made (e.g., "Decided to use SQLite over PostgreSQL")
// - preference: User preferences (e.g., "User prefers concise responses")
// - procedure: How to do something (e.g., "To deploy, run npm run build")
// - observation: General notes (e.g., "The codebase has 50k LOC")

export interface ExtractedFact {
  content: string;
  type: 'fact' | 'decision' | 'preference' | 'procedure' | 'observation' | 'identity';
  confidence: number;
  importance: number;
  tags: string[];
  sourceMessageId?: string;
  sourceConversationId?: string;
  entities?: string[];  // Named entities mentioned
}

interface ExtractionResult {
  conversationId: string;
  factsExtracted: number;
  duplicatesSkipped: number;
  facts: Array<{ id: string; content: string; type: string }>;
}

// Pattern-based fact extraction (fast, no LLM needed)
// v4.1 Phase 3: Tightened patterns to reduce garbage extraction
const FACT_PATTERNS = {
  decision: [
    /(?:we|I)\s+(?:decided|chose|went with|picked|selected)\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
    /(?:decision|choice):\s*(.+?)(?:\.|$)/gi,
    /(?:let's|we'll)\s+(?:go with|use|stick with)\s+(.+?)(?:\.|$)/gi,
  ],
  preference: [
    /(?:I)\s+(?:prefer|like)\s+(.+?)(?:\.|$)/gi,
    /(?:always)\s+(?:use|keep)\s+(.+?)(?:\.|$)/gi,
  ],
  procedure: [
    /(?:to\s+)?(?:run|execute|deploy|build|test|install)(?:ing)?\s*[,:]\s*(.+?)(?:\.|$)/gi,
    /(?:command|script|run):\s*`?([^`\n]+)`?/gi,
  ],
  fact: [
    /(?:the\s+)?(?:project|codebase|app|system)\s+(?:uses?|is|has|contains?)\s+(.+?)(?:\.|$)/gi,
    /(?:version|v)\s*(\d+(?:\.\d+)*)/gi,
  ],
  identity: [
    /(?:the\s+)?(?:primary|main|core|fundamental)\s+(?:goal|purpose|mission|objective)\s+(?:is|of\s+\w+\s+is)\s+(.+?)(?:\.|$)/gi,
    /(?:the\s+)?(?:philosophy|principle|vision|ethos)\s+(?:is|behind\s+\w+\s+is)\s+(.+?)(?:\.|$)/gi,
    /(?:this\s+)?(?:project|system|tool)\s+(?:exists?\s+to|is\s+(?:built|designed|meant)\s+(?:for|to))\s+(.+?)(?:\.|$)/gi,
    /(?:most\s+important|critical|essential)\s+(?:thing|aspect|part)\s+(?:is|about\s+\w+\s+is)\s+(.+?)(?:\.|$)/gi,
  ],
};

// Entity extraction patterns
const ENTITY_PATTERNS = {
  project: /(?:project|repo|repository)\s+["']?([A-Za-z0-9_-]{3,})["']?/gi,
  file: /(?:file|path)\s+["']?([A-Za-z0-9_/\\.-]+\.[a-z]{1,5})["']?/gi,
  technology: /(?:using|with|via)\s+(TypeScript|JavaScript|Python|Rust|Go|React|Vue|Angular|Node\.?js?|SQLite|PostgreSQL|MongoDB|Redis)/gi,
  person: /@([a-zA-Z0-9_-]+)(?!\/)/gi,  // negative lookahead excludes @scope/package
};

// Entity names to never create -- agent roles, npm scopes, common words
const ENTITY_NAME_BLOCKLIST = new Set([
  'strategist', 'completeness-auditor', 'quality-assessor', 'reviewer',
  'auditor', 'evaluator', 'analyzer', 'planner', 'coordinator',
  'modelcontextprotocol', 'anthropic', 'types', 'sdk',
  'setup', 'root', 'files', 'location', 'based', 'recovery',
  'contents', 'output', 'result', 'value', 'python',
]);

// Stop words for quality filtering -- extracted facts with >80% stop words are garbage
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'to','of','in','for','on','with','at','by','from','it',
  'that','this','these','those','its','my','your','his','her',
  'and','or','but','not','so','if','then','than',
  'i','we','you','they','he','she','me','us','them',
  'do','does','did','have','has','had','will','would','can','could',
  'just','also','very','really','already','still','only',
  'let','me','all','some','more','need','want','get',
]);

/**
 * Quality gate for extracted facts. Rejects fragments, stop-word soup, and formatting artifacts.
 */
export function isQualityFact(content: string): boolean {
  const trimmed = content.trim();

  // Minimum 4 words
  const words = trimmed.split(/\s+/);
  if (words.length < 4) return false;

  // Maximum 80% stop words
  const stopCount = words.filter(w => STOP_WORDS.has(w.toLowerCase())).length;
  if (stopCount / words.length > 0.8) return false;

  // Reject markdown/formatting artifacts
  if (/^\*\*[A-Z]+/.test(trimmed)) return false;
  if (/^[#*\-`]/.test(trimmed)) return false;

  // Reject meta-commentary / assistant self-narration
  if (/^(?:let me|I'll |I will |I need to|I should |I can |I'm going|looking at |searching for |checking |reading |examining )/i.test(trimmed)) return false;

  // Reject content that's mostly inline code
  const backtickCount = (trimmed.match(/`/g) || []).length;
  if (backtickCount >= 2 && trimmed.replace(/`[^`]*`/g, '').trim().length < 30) return false;

  // Reject mid-sentence fragments starting with common connective/article/verb words
  if (/^(?:a|an|the|to|and|but|or|so|for|in|on|at|by|with|from|of|it|its|this|that|also|just|have|has|had|actually|let|still|about|being|into|which|where|when|while|since|because|however|then|now|here|there|some|any|well|basically|obviously|apparently|maybe|perhaps|probably|should|could|would|might|was|were|am|are|is|been|do|does|did|get|got|going|using|how|what|why|who)\s/i.test(trimmed)
      && /^[a-z]/.test(trimmed)) return false;

  // Reject markdown table fragments, git log output, line-number arrows
  if (/\|.*\|/.test(trimmed)) return false;
  if (/^[0-9a-f]{7,}\s/.test(trimmed)) return false;
  if (/\d+→/.test(trimmed)) return false;

  // Reject truncated content (ends mid-word or with incomplete backtick expression)
  // Exclude numbers and common short endings (OK, no, etc.)
  if (/\s[a-zA-Z]{1,2}$/.test(trimmed) && trimmed.length < 100) return false;
  if (/`[^`]{0,3}$/.test(trimmed)) return false;

  // Reject malformed sentence boundaries (missing space after colon before uppercase)
  if (/[a-z]:[A-Z]/.test(trimmed) && !trimmed.includes('http')) return false;

  return true;
}

/**
 * Extract facts from a single message using pattern matching
 */
function extractFactsFromMessage(
  message: { id: string; content: string; role: string; conversationId: string },
  projectId: string
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = message.content;

  // Skip very short messages or tool outputs
  if (content.length < 20 || content.length > 10000) return facts;

  // Role-aware type filtering: assistant self-narration ("I'll use...", "Let me...")
  // pollutes decision/preference/procedure categories. Only extract identity+fact from assistants.
  const allowedTypes = message.role === 'assistant'
    ? new Set(['identity', 'fact'])
    : new Set(Object.keys(FACT_PATTERNS));

  // Extract entities mentioned
  const entities: string[] = [];
  for (const [entityType, patterns] of Object.entries(ENTITY_PATTERNS)) {
    const patternList = Array.isArray(patterns) ? patterns : [patterns];
    for (const pattern of patternList) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const entity = match[1] || match[2];
        if (entity && entity.length > 2 && !ENTITY_NAME_BLOCKLIST.has(entity.toLowerCase())) {
          entities.push(`${entityType}:${entity}`);
        }
      }
    }
  }

  // Extract facts by type
  for (const [factType, patterns] of Object.entries(FACT_PATTERNS)) {
    if (!allowedTypes.has(factType)) continue;
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const extracted = match[1]?.trim();
        if (extracted && extracted.length > 5 && extracted.length < 500) {
          // Skip if it's just code or technical noise
          if (extracted.match(/^[{}\[\]()]+$/) || extracted.match(/^\s*$/)) continue;
          // Quality gate: reject fragments, stop-word soup, formatting artifacts
          if (!isQualityFact(extracted)) continue;

          facts.push({
            content: extracted,
            type: factType as ExtractedFact['type'],
            confidence: 0.7,  // Pattern-based extraction has moderate confidence
            importance: factType === 'identity' ? 0.9 : factType === 'decision' ? 0.8 : factType === 'preference' ? 0.7 : 0.5,
            tags: [factType, projectId !== 'global' ? projectId : undefined].filter(Boolean) as string[],
            sourceMessageId: message.id,
            sourceConversationId: message.conversationId,
            entities: entities.length > 0 ? entities : undefined,
          });
        }
      }
    }
  }

  return facts;
}

/**
 * Extract key information from assistant tool usage
 * These often contain valuable procedural knowledge
 */
function extractFactsFromToolUse(
  toolUse: { id: string; toolName: string; input: string; output?: string; conversationId: string },
  projectId: string
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  // Focus on specific high-value tools
  const valuableTools = ['Bash', 'Edit', 'Write', 'Read'];
  if (!valuableTools.includes(toolUse.toolName)) return facts;

  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(toolUse.input);
  } catch {
    return facts;
  }

  // Extract commands from Bash tool -- only keep composite/pipeline commands with learning value
  if (toolUse.toolName === 'Bash' && input.command) {
    const command = String(input.command);
    const TRIVIAL_PREFIXES = ['ls', 'cd', 'git log', 'git status', 'git diff', 'git add',
      'find ', 'cat ', 'mkdir', 'npm test', 'npm run build', 'npm run ', 'echo '];
    const isTrivial = TRIVIAL_PREFIXES.some(p => command.startsWith(p));
    const isComposite = command.includes('|') || command.includes('&&') || command.includes('>');
    if (command.length > 20 && !isTrivial && isComposite) {
      facts.push({
        content: `Command used: ${command.substring(0, 300)}`,
        type: 'procedure',
        confidence: 0.8,
        importance: 0.6,
        tags: ['command', 'bash', projectId !== 'global' ? projectId : undefined].filter(Boolean) as string[],
        sourceConversationId: toolUse.conversationId,
      });
    }
  }

  // Extract file paths from Edit/Write/Read
  if (['Edit', 'Write', 'Read'].includes(toolUse.toolName) && input.file_path) {
    const filePath = String(input.file_path);
    // Just note that this file was modified, don't store content
    facts.push({
      content: `File ${toolUse.toolName === 'Read' ? 'accessed' : 'modified'}: ${filePath}`,
      type: 'observation',
      confidence: 1.0,  // This is definite
      importance: 0.3,  // Low importance, just tracking
      tags: ['file-operation', toolUse.toolName.toLowerCase()],
      sourceConversationId: toolUse.conversationId,
    });
  }

  return facts;
}

/**
 * Check if a fact is a duplicate or near-duplicate of existing memories
 */
export function isDuplicateFact(
  db: Database.Database,
  fact: ExtractedFact,
  projectId: string
): boolean {
  // Exact content match
  const exactMatch = db.prepare(`
    SELECT id FROM memories
    WHERE content = ? AND project_id = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(fact.content, projectId);

  if (exactMatch) return true;

  // Check for very similar content (substring match)
  const shortContent = fact.content.substring(0, 50);
  const similarMatch = db.prepare(`
    SELECT id FROM memories
    WHERE content LIKE ? ESCAPE '\\' AND project_id = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(`%${sanitizeLikePattern(shortContent)}%`, projectId);

  return !!similarMatch;
}

/**
 * Store an extracted fact in the memories table with source link
 */
export function storeExtractedFact(
  db: Database.Database,
  fact: ExtractedFact,
  projectId: string
): string | null {
  const memoryId = randomUUID().replace(/-/g, '');

  try {
    // Insert into memories table
    db.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      memoryId,
      projectId,
      fact.content,
      fact.type,
      JSON.stringify(fact.tags),
      fact.importance,
      fact.confidence
    );

    // Create source link
    if (fact.sourceMessageId || fact.sourceConversationId) {
      const sourceId = randomUUID().replace(/-/g, '');
      db.prepare(`
        INSERT INTO memory_sources (id, memory_id, conversation_id, message_id, extraction_type, confidence)
        VALUES (?, ?, ?, ?, 'auto', ?)
      `).run(
        sourceId,
        memoryId,
        fact.sourceConversationId || null,
        fact.sourceMessageId || null,
        fact.confidence
      );
    }

    // Link entities if any
    if (fact.entities && fact.entities.length > 0) {
      for (const entityRef of fact.entities) {
        const [entityType, entityName] = entityRef.split(':');
        if (entityType && entityName) {
          // Create or get entity
          db.prepare(`
            INSERT OR IGNORE INTO entities (id, project_id, name, entity_type, observations)
            VALUES (?, ?, ?, ?, '[]')
          `).run(
            randomUUID().replace(/-/g, ''),
            projectId,
            entityName,
            entityType
          );

          // Add memory reference as entity observation
          const entity = db.prepare(`SELECT id, observations FROM entities WHERE name = ? AND project_id = ?`).get(entityName, projectId) as { id: string; observations: string } | undefined;
          if (entity) {
            const obs: string[] = JSON.parse(entity.observations || '[]');
            const ref = `Referenced in memory ${memoryId}`;
            if (!obs.includes(ref)) {
              obs.push(ref);
              db.prepare(`UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(JSON.stringify(obs), entity.id);
            }
          }
        }
      }
    }

    return memoryId;
  } catch (err) {
    console.error(`[Fact Extraction] Failed to store fact: ${err}`);
    return null;
  }
}

/**
 * High-precision garbage detector for ALL memories (not just auto-extracted).
 * More conservative than isQualityFact() — only flags definite garbage patterns.
 * Safe to run on manually-stored memories.
 */
export function isDefiniteGarbage(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 10) return true;
  // Truncated content (ends mid-word with 1-2 alpha chars)
  if (/\s[a-zA-Z]{1,2}$/.test(trimmed) && trimmed.length < 80) return true;
  // Meta-commentary (assistant self-narration)
  if (/^(?:let me|I'll |I will |I need to |looking at |searching for |checking )/i.test(trimmed)) return true;
  // Malformed sentence boundaries (missing space after colon before uppercase)
  if (/[a-z]:[A-Z]/.test(trimmed) && !trimmed.includes('http')) return true;
  // Fragment starting with lowercase connective/verb
  if (/^[a-z]/.test(trimmed) && /^(?:have|has|had|actually|let|still|about|being|which|where|when|basically|obviously)\s/.test(trimmed)) return true;
  // Incomplete backtick expression
  if (/`[^`]{0,3}$/.test(trimmed)) return true;
  return false;
}

/**
 * Clean up garbage auto-extracted facts and entities.
 * Finds memories linked via memory_sources with extraction_type='auto',
 * re-evaluates them through isQualityFact(), and deletes failures.
 * Strategy 3: Also scans ALL memories for definite garbage patterns.
 * Also removes garbage entities (stop words, very short names).
 */
export function cleanupGarbageFacts(
  db: Database.Database,
  projectId: string = 'global'
): { memoriesDeleted: number; entitiesDeleted: number } {
  let memoriesDeleted = 0;
  let entitiesDeleted = 0;

  // Strategy 1: Delete auto-extracted memories that fail quality gate
  // Auto-extracted facts have memory_sources with extraction_type = 'auto'
  const autoExtracted = db.prepare(`
    SELECT m.id, m.content FROM memories m
    INNER JOIN memory_sources ms ON ms.memory_id = m.id
    WHERE ms.extraction_type = 'auto'
      AND m.deleted_at IS NULL
      AND (m.project_id = ? OR m.project_id = 'global')
  `).all(projectId) as Array<{ id: string; content: string }>;

  // Strategy 2: Also catch auto-extracted memories without memory_sources link
  // These have confidence ~0.7, single-element tag arrays matching fact types
  const suspectMemories = db.prepare(`
    SELECT id, content, tags FROM memories
    WHERE deleted_at IS NULL
      AND (project_id = ? OR project_id = 'global')
      AND confidence >= 0.69 AND confidence <= 0.71
  `).all(projectId) as Array<{ id: string; content: string; tags: string }>;

  const autoIds = new Set(autoExtracted.map(m => m.id));
  const factTypes = new Set(['fact', 'decision', 'preference', 'procedure', 'identity', 'observation']);

  // Merge both sets
  for (const m of suspectMemories) {
    if (autoIds.has(m.id)) continue;
    try {
      const tags: string[] = JSON.parse(m.tags || '[]');
      // Single-tag memories where the tag is a fact type are likely auto-extracted
      if (tags.length === 1 && factTypes.has(tags[0])) {
        autoExtracted.push(m);
      }
    } catch { /* skip malformed tags */ }
  }

  const deleteTransaction = db.transaction(() => {
    for (const mem of autoExtracted) {
      if (!isQualityFact(mem.content)) {
        db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`).run(mem.id);
        // Also clean up the source link
        db.prepare(`DELETE FROM memory_sources WHERE memory_id = ?`).run(mem.id);
        memoriesDeleted++;
      }
    }

    // Clean up garbage entities: stop words, very short names, common words, agent roles
    const ENTITY_STOP_WORDS = new Set([
      ...STOP_WORDS,
      ...ENTITY_NAME_BLOCKLIST,
      'wants', 'needs', 'says', 'goes', 'makes', 'takes', 'gives',
      'context', 'structure', 'stories', 'things', 'stuff', 'way',
      'app', 'code', 'file', 'data', 'test', 'type', 'name',
    ]);

    const allEntities = db.prepare(`
      SELECT id, name, observations FROM entities
      WHERE project_id = ? OR project_id = 'global'
    `).all(projectId) as Array<{ id: string; name: string; observations: string }>;

    // Case-insensitive entity dedup: keep first occurrence, delete duplicates
    const entityNamesSeen = new Map<string, string>();
    for (const entity of allEntities) {
      const nameLower = entity.name.toLowerCase();

      // Delete garbage entities (stop words, short names, blocklisted)
      if (nameLower.length < 3 || ENTITY_STOP_WORDS.has(nameLower)) {
        db.prepare(`DELETE FROM entities WHERE id = ?`).run(entity.id);
        entitiesDeleted++;
        continue;
      }

      // Delete case-duplicate entities (keep first seen)
      if (entityNamesSeen.has(nameLower)) {
        db.prepare(`DELETE FROM entities WHERE id = ?`).run(entity.id);
        entitiesDeleted++;
        continue;
      }
      entityNamesSeen.set(nameLower, entity.id);

      // Clean orphaned observations (references to deleted memories)
      try {
        const obs: string[] = JSON.parse(entity.observations || '[]');
        const validObs = obs.filter(o => {
          const memIdMatch = o.match(/memory\s+([a-f0-9]+)/);
          if (!memIdMatch) return true;
          const mem = db.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(memIdMatch[1]);
          return !!mem;
        });
        if (validObs.length !== obs.length) {
          db.prepare('UPDATE entities SET observations = ? WHERE id = ?')
            .run(JSON.stringify(validObs), entity.id);
        }
      } catch { /* skip malformed observations */ }
    }

    // Strategy 3: Universal garbage scan on ALL remaining memories (v4.2)
    // Catches manually-stored garbage that strategies 1 & 2 miss
    // Note: deleted_at IS NULL excludes memories already soft-deleted by Strategy 1 above
    const allMemories = db.prepare(`
      SELECT id, content FROM memories
      WHERE deleted_at IS NULL AND (project_id = ? OR project_id = 'global')
    `).all(projectId) as Array<{ id: string; content: string }>;

    for (const mem of allMemories) {
      if (isDefiniteGarbage(mem.content)) {
        db.prepare(`UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`).run(mem.id);
        memoriesDeleted++;
      }
    }
  });

  deleteTransaction();

  return { memoriesDeleted, entitiesDeleted };
}

/**
 * Extract facts from a conversation (all messages and tool uses)
 */
export function extractFactsFromConversation(
  db: Database.Database,
  conversationId: string,
  projectId: string = 'global'
): ExtractionResult {
  const result: ExtractionResult = {
    conversationId,
    factsExtracted: 0,
    duplicatesSkipped: 0,
    facts: [],
  };

  // Get messages
  const messages = db.prepare(`
    SELECT id, content, role, conversation_id as conversationId
    FROM conversation_messages
    WHERE conversation_id = ? AND role IN ('assistant', 'user')
  `).all(conversationId) as Array<{ id: string; content: string; role: string; conversationId: string }>;

  // Get tool uses
  const toolUses = db.prepare(`
    SELECT id, tool_name as toolName, input_json as input, output_text as output, conversation_id as conversationId
    FROM conversation_tool_uses
    WHERE conversation_id = ?
  `).all(conversationId) as Array<{ id: string; toolName: string; input: string; output?: string; conversationId: string }>;

  const allFacts: ExtractedFact[] = [];

  // Extract from messages
  for (const msg of messages) {
    const msgFacts = extractFactsFromMessage(msg, projectId);
    allFacts.push(...msgFacts);
  }

  // Extract from tool uses
  for (const tu of toolUses) {
    const tuFacts = extractFactsFromToolUse(tu, projectId);
    allFacts.push(...tuFacts);
  }

  // Dedupe and store
  const storeTransaction = db.transaction(() => {
    for (const fact of allFacts) {
      if (isDuplicateFact(db, fact, projectId)) {
        result.duplicatesSkipped++;
        continue;
      }

      const memoryId = storeExtractedFact(db, fact, projectId);
      if (memoryId) {
        result.factsExtracted++;
        result.facts.push({ id: memoryId, content: fact.content, type: fact.type });
      }
    }
  });

  storeTransaction();

  return result;
}

/**
 * Batch extract facts from all un-processed conversations
 */
export function extractFactsBatch(
  db: Database.Database,
  projectId: string = 'global',
  limit: number = 100
): { processed: number; totalFacts: number; totalDuplicates: number } {
  // Find conversations that haven't been processed yet
  // (no entries in memory_sources for them)
  const unprocessed = db.prepare(`
    SELECT DISTINCT c.id
    FROM conversations c
    LEFT JOIN memory_sources ms ON c.id = ms.conversation_id
    WHERE ms.id IS NULL
      AND (c.project_id = ? OR c.project_id = 'global')
    LIMIT ?
  `).all(projectId, limit) as Array<{ id: string }>;

  let totalFacts = 0;
  let totalDuplicates = 0;

  for (const conv of unprocessed) {
    const result = extractFactsFromConversation(db, conv.id, projectId);
    totalFacts += result.factsExtracted;
    totalDuplicates += result.duplicatesSkipped;
  }

  console.error(`[Fact Extraction] Processed ${unprocessed.length} conversations, extracted ${totalFacts} facts, skipped ${totalDuplicates} duplicates`);

  return { processed: unprocessed.length, totalFacts, totalDuplicates };
}

// ============================================================================
// Layer 3: Conversation Summarization (v4.2)
// ============================================================================

// Common stop words for topic extraction TF-IDF
const TOPIC_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about',
  'against', 'up', 'down', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your', 'yours',
  'he', 'him', 'his', 'she', 'her', 'hers', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'any', 'also', 'get', 'got', 'let',
  'make', 'like', 'still', 'now', 'even', 'new', 'well', 'way',
  'use', 'using', 'file', 'code', 'line', 'one', 'two', 'see', 'look',
]);

/**
 * Summarize a single conversation using the local summarization model.
 */
export async function summarizeConversation(
  db: Database.Database,
  conversationId: string,
  projectId: string = 'global'
): Promise<{ id: string; summary: string; summary_type: string } | { error: string }> {
  // Check conversation exists
  const conv = db.prepare(`
    SELECT id FROM conversations WHERE id = ? AND (project_id = ? OR project_id = 'global')
  `).get(conversationId, projectId) as any;
  if (!conv) return { error: 'Conversation not found' };

  // Check if already summarized
  const existing = db.prepare(`
    SELECT id, content FROM conversation_summaries WHERE conversation_id = ? AND summary_type = 'brief'
  `).get(conversationId) as any;
  if (existing) return { id: existing.id, summary: existing.content, summary_type: 'brief' };

  // Load messages
  const messages = db.prepare(`
    SELECT role, content FROM conversation_messages
    WHERE conversation_id = ? ORDER BY timestamp ASC
  `).all(conversationId) as Array<{ role: string; content: string }>;

  if (messages.length === 0) return { error: 'No messages in conversation' };

  // Build text for summarization
  // Keep most recent messages (they're most important), skip very long tool outputs
  let textParts: string[] = [];
  for (const msg of messages) {
    const content = msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content;
    textParts.push(`${msg.role}: ${content}`);
  }

  // Truncate from the beginning if too long, keeping most recent
  let text = textParts.join('\n');
  if (text.length > 4000) {
    // Keep the last ~4000 chars (most recent context)
    text = text.slice(-4000);
  }

  const summary = await generateSummary(text, { max_length: 150, min_length: 30 });
  if (!summary) return { error: 'Summarization failed - model may not be loaded' };

  // Generate embedding for the summary
  const embedding = await generateEmbedding(summary);
  const embeddingBuffer = embedding ? Buffer.from(new Uint8Array(embedding.buffer)) : null;

  const summaryId = randomUUID().replace(/-/g, '');
  db.prepare(`
    INSERT INTO conversation_summaries (id, conversation_id, project_id, summary_type, content, model_used, embedding)
    VALUES (?, ?, ?, 'brief', ?, ?, ?)
  `).run(summaryId, conversationId, projectId, summary, SUMMARIZATION_MODEL, embeddingBuffer);

  return { id: summaryId, summary, summary_type: 'brief' };
}

/**
 * Batch-summarize conversations that don't have summaries yet.
 */
export async function summarizeBatch(
  db: Database.Database,
  projectId: string = 'global',
  limit: number = 5
): Promise<{ summarized: number; errors: number }> {
  // Find conversations with messages but no summaries
  const unsummarized = db.prepare(`
    SELECT DISTINCT c.id
    FROM conversations c
    INNER JOIN conversation_messages cm ON c.id = cm.conversation_id
    LEFT JOIN conversation_summaries cs ON c.id = cs.conversation_id AND cs.summary_type = 'brief'
    WHERE cs.id IS NULL
      AND (c.project_id = ? OR c.project_id = 'global')
    LIMIT ?
  `).all(projectId, limit) as Array<{ id: string }>;

  let summarized = 0;
  let errors = 0;

  for (const conv of unsummarized) {
    try {
      const result = await summarizeConversation(db, conv.id, projectId);
      if ('error' in result) {
        errors++;
      } else {
        summarized++;
      }
    } catch {
      errors++;
    }
  }

  if (summarized > 0) {
    console.error(`[Just-Memory] Summarized ${summarized} conversations (${errors} errors)`);
  }

  return { summarized, errors };
}

/**
 * Extract topics from a conversation using keyword frequency analysis.
 * No LLM needed — uses TF-IDF-like word frequency with stop word filtering.
 */
export function extractConversationTopics(
  db: Database.Database,
  conversationId: string,
  projectId: string = 'global'
): string[] {
  const messages = db.prepare(`
    SELECT content FROM conversation_messages
    WHERE conversation_id = ? ORDER BY timestamp ASC
  `).all(conversationId) as Array<{ content: string }>;

  if (messages.length === 0) return [];

  // Collect word frequencies (TF)
  const wordFreq = new Map<string, number>();
  const allText = messages.map(m => m.content).join(' ');
  const words = allText.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);

  for (const word of words) {
    if (word.length < 3 || TOPIC_STOP_WORDS.has(word)) continue;
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }

  // Also extract 2-word phrases
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i], w2 = words[i + 1];
    if (w1.length < 3 || w2.length < 3 || TOPIC_STOP_WORDS.has(w1) || TOPIC_STOP_WORDS.has(w2)) continue;
    const phrase = `${w1} ${w2}`;
    wordFreq.set(phrase, (wordFreq.get(phrase) || 0) + 1);
  }

  // Sort by frequency, take top terms
  const sorted = [...wordFreq.entries()]
    .filter(([, count]) => count >= 3) // minimum frequency threshold
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const topicNames = sorted.map(([word]) => word);

  // Upsert topics and create links
  for (const name of topicNames) {
    // Upsert topic
    db.prepare(`
      INSERT INTO conversation_topics (id, project_id, name)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id, name) DO NOTHING
    `).run(randomUUID().replace(/-/g, ''), projectId, name);

    // Get topic ID
    const topic = db.prepare(`
      SELECT id FROM conversation_topics WHERE project_id = ? AND name = ?
    `).get(projectId, name) as any;

    if (topic) {
      const relevance = (wordFreq.get(name) || 0) / (sorted[0]?.[1] || 1);
      db.prepare(`
        INSERT INTO conversation_topic_links (conversation_id, topic_id, relevance)
        VALUES (?, ?, ?)
        ON CONFLICT(conversation_id, topic_id) DO UPDATE SET relevance = excluded.relevance
      `).run(conversationId, topic.id, relevance);
    }
  }

  return topicNames;
}

/**
 * Search conversation summaries by keyword and/or semantic similarity.
 */
export function searchConversationSummaries(
  db: Database.Database,
  query: string,
  projectId: string = 'global',
  limit: number = 10
): Array<{ id: string; conversation_id: string; summary: string; relevance: number }> {
  const safeQuery = sanitizeLikePattern(query);
  const results = db.prepare(`
    SELECT id, conversation_id, content as summary, summary_type, model_used, created_at
    FROM conversation_summaries
    WHERE (project_id = ? OR project_id = 'global')
      AND content LIKE '%' || ? || '%'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(projectId, safeQuery, limit) as any[];

  return results.map((r: any) => ({
    id: r.id,
    conversation_id: r.conversation_id,
    summary: r.summary,
    relevance: 1.0, // keyword match
  }));
}
