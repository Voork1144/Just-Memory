/**
 * Just-Memory MCP Server
 * 
 * A focused MCP server for persistent memory capabilities.
 * Implements 17 tools for Claude Desktop/Claude.ai integration:
 * - Memory Module: 16 tools (store, recall, search, delete, recover, update, list, stats, briefing, export, backup, restore, list_backups, link, refresh_context, entity_create)
 * - Utility: 1 tool (get_config)
 * 
 * NOTE: Filesystem, Terminal, and Search modules have been removed as Desktop Commander
 * already provides these capabilities. This server focuses solely on persistent memory.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Memory module imports
import {
  initDatabase,
  closeDatabase,
  getDatabaseStats,
  initEmbeddings,
  generateEmbedding,
  storeMemory,
  recallMemory,
  updateMemory,
  deleteMemory,
  recoverMemory,
  listRecentMemories,
  listDeletedMemories,
  searchMemories,
  backupDatabase,
  restoreDatabase,
  listBackups,
  linkMemory,
  createEntity,
  refreshContext,
  type MemoryInput,
  type MemoryType,
  type MemoryLinkInput,
  type EntityInput,
} from './memory/index.js';

// P0 utilities
import { withTimeout, isClaudeDesktopMode, getConfig } from './utils/index.js';

// ============================================================================
// Memory Tool Schemas (Zod validation)
// ============================================================================

const MemoryStoreSchema = z.object({
  content: z.string().min(1).describe('The memory content to store'),
  type: z.enum(['fact', 'event', 'observation', 'preference', 'note', 'decision']).optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  projectId: z.string().optional(),
  importance: z.number().min(0).max(1).optional(),
  decayEnabled: z.boolean().optional(),
});

const MemoryRecallSchema = z.object({
  id: z.string().describe('The memory ID to recall'),
});

const MemorySearchSchema = z.object({
  query: z.string().min(1).describe('Search query for semantic search'),
  limit: z.number().min(1).max(50).optional().default(10),
  type: z.enum(['fact', 'event', 'observation', 'preference', 'note', 'decision']).optional(),
  projectId: z.string().optional(),
  minScore: z.number().min(0).max(1).optional(),
  includeDeleted: z.boolean().optional().default(false),
});

const MemoryDeleteSchema = z.object({
  id: z.string().describe('The memory ID to delete'),
  permanent: z.boolean().optional().default(false),
});

const MemoryRecoverSchema = z.object({
  id: z.string().describe('The memory ID to recover'),
});

const MemoryUpdateSchema = z.object({
  id: z.string().describe('The memory ID to update'),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).optional(),
  decayEnabled: z.boolean().optional(),
});

const MemoryListSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  type: z.enum(['fact', 'event', 'observation', 'preference', 'note', 'decision']).optional(),
  projectId: z.string().optional(),
  includeDeleted: z.boolean().optional().default(false),
});

const MemoryStatsSchema = z.object({});

const MemoryBriefingSchema = z.object({
  maxTokens: z.number().min(100).max(1000).optional().default(300),
  projectId: z.string().optional(),
});

const MemoryExportSchema = z.object({
  format: z.enum(['json', 'markdown']).optional().default('json'),
  projectId: z.string().optional(),
  includeDeleted: z.boolean().optional().default(false),
});

const MemoryBackupSchema = z.object({
  description: z.string().optional().describe('Optional description for the backup'),
});

const MemoryRestoreSchema = z.object({
  backupPath: z.string().describe('Full path to the backup file'),
});

const MemoryListBackupsSchema = z.object({
  limit: z.number().min(1).max(50).optional().default(20),
});

const MemoryLinkSchema = z.object({
  memoryId: z.string().describe('The memory ID to link'),
  filePath: z.string().optional().describe('File path to associate'),
  commitHash: z.string().optional().describe('Git commit hash to associate'),
  url: z.string().optional().describe('URL to associate'),
});

const MemoryRefreshContextSchema = z.object({
  projectId: z.string().optional(),
  maxTokens: z.number().min(100).max(1000).optional().default(300),
});

const MemoryEntityCreateSchema = z.object({
  name: z.string().describe('Entity name'),
  type: z.string().describe('Entity type (e.g., person, project, concept)'),
  description: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  projectId: z.string().optional(),
});

// Utility tool schemas
const GetConfigSchema = z.object({});

// ============================================================================
// Memory Tool Definitions
// ============================================================================

const MEMORY_TOOLS: Tool[] = [
  {
    name: 'memory_store',
    description: 'Store a new memory with optional metadata. Use for important facts, decisions, preferences that should persist.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The memory content to store' },
        type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
        tags: { type: 'array', items: { type: 'string' } },
        source: { type: 'string' },
        projectId: { type: 'string' },
        importance: { type: 'number', minimum: 0, maximum: 1 },
        decayEnabled: { type: 'boolean' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Retrieve a specific memory by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_search',
    description: 'Semantic search across stored memories using hybrid BM25 + vector search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
        type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
        projectId: { type: 'string' },
        minScore: { type: 'number', minimum: 0, maximum: 1 },
        includeDeleted: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete a memory (soft delete by default, recoverable).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        permanent: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_recover',
    description: 'Recover a soft-deleted memory.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_update',
    description: 'Update an existing memory\'s content or metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'number', minimum: 0, maximum: 1 },
        decayEnabled: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_list',
    description: 'List recent memories with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100 },
        offset: { type: 'number', minimum: 0 },
        type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision'] },
        projectId: { type: 'string' },
        includeDeleted: { type: 'boolean' },
      },
    },
  },
  {
    name: 'memory_stats',
    description: 'Get database statistics and memory counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_briefing',
    description: 'Generate a session briefing with relevant context (~300 tokens). Use at session start.',
    inputSchema: {
      type: 'object',
      properties: {
        maxTokens: { type: 'number', minimum: 100, maximum: 1000 },
        projectId: { type: 'string' },
      },
    },
  },
  {
    name: 'memory_export',
    description: 'Export memories in JSON or Markdown format.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'markdown'] },
        projectId: { type: 'string' },
        includeDeleted: { type: 'boolean' },
      },
    },
  },
  {
    name: 'memory_backup',
    description: 'Create a backup of the memory database. Returns backup info.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Optional description for the backup' },
      },
    },
  },
  {
    name: 'memory_restore',
    description: 'Restore memory database from a backup file. Use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        backupPath: { type: 'string', description: 'Full path to the backup file' },
      },
      required: ['backupPath'],
    },
  },
  {
    name: 'memory_list_backups',
    description: 'List available memory database backups.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 50, description: 'Max backups to list' },
      },
    },
  },
  {
    name: 'memory_link',
    description: 'Associate a memory with a file, git commit, or URL for reference tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        memoryId: { type: 'string', description: 'Memory ID to link' },
        filePath: { type: 'string', description: 'File path to associate' },
        commitHash: { type: 'string', description: 'Git commit hash' },
        url: { type: 'string', description: 'URL to associate' },
      },
      required: ['memoryId'],
    },
  },
  {
    name: 'memory_refresh_context',
    description: 'Regenerate and return current session context. Use mid-session when context feels stale.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        maxTokens: { type: 'number', minimum: 100, maximum: 1000 },
      },
    },
  },
  {
    name: 'memory_entity_create',
    description: 'Create a knowledge graph entity for organizing related memories.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Entity name' },
        type: { type: 'string', description: 'Entity type (person, project, concept, etc.)' },
        description: { type: 'string' },
        properties: { type: 'object', description: 'Additional properties' },
        projectId: { type: 'string' },
      },
      required: ['name', 'type'],
    },
  },
];

// ============================================================================
// Utility Tool Definitions
// ============================================================================

const UTILITY_TOOLS: Tool[] = [
  {
    name: 'get_config',
    description: 'Get current server configuration including version, timeout settings, and module status.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// Combine all tools (Memory only - filesystem/terminal/search removed, use Desktop Commander)
const ALL_TOOLS: Tool[] = [...MEMORY_TOOLS, ...UTILITY_TOOLS];

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleToolCall(name: string, args: unknown): Promise<unknown> {
  const timeoutMs = isClaudeDesktopMode() ? 4500 : 30000;
  
  switch (name) {
    // Memory tools
    case 'memory_store': {
      const input = MemoryStoreSchema.parse(args);
      return withTimeout(() => storeMemory(input as MemoryInput), timeoutMs, 'memory_store');
    }
    case 'memory_recall': {
      const { id } = MemoryRecallSchema.parse(args);
      return withTimeout(() => recallMemory(id), timeoutMs, 'memory_recall');
    }
    case 'memory_search': {
      const input = MemorySearchSchema.parse(args);
      return withTimeout(() => searchMemories(input.query, {
        limit: input.limit,
        type: input.type as MemoryType | undefined,
        projectId: input.projectId,
        minScore: input.minScore,
        includeDeleted: input.includeDeleted,
      }), timeoutMs, 'memory_search');
    }
    case 'memory_delete': {
      const { id, permanent } = MemoryDeleteSchema.parse(args);
      return withTimeout(() => deleteMemory(id, permanent), timeoutMs, 'memory_delete');
    }
    case 'memory_recover': {
      const { id } = MemoryRecoverSchema.parse(args);
      return withTimeout(() => recoverMemory(id), timeoutMs, 'memory_recover');
    }
    case 'memory_update': {
      const input = MemoryUpdateSchema.parse(args);
      return withTimeout(() => updateMemory(input.id, {
        content: input.content,
        tags: input.tags,
        importance: input.importance,
        decayEnabled: input.decayEnabled,
      }), timeoutMs, 'memory_update');
    }
    case 'memory_list': {
      const input = MemoryListSchema.parse(args);
      return withTimeout(() => {
        if (input.includeDeleted) {
          return listDeletedMemories(input.limit);
        }
        return listRecentMemories(input.limit, input.offset, input.type as MemoryType | undefined, input.projectId);
      }, timeoutMs, 'memory_list');
    }
    case 'memory_stats': {
      MemoryStatsSchema.parse(args);
      return withTimeout(() => getDatabaseStats(), timeoutMs, 'memory_stats');
    }
    case 'memory_briefing': {
      const input = MemoryBriefingSchema.parse(args);
      return withTimeout(() => generateBriefing(input.maxTokens, input.projectId), timeoutMs, 'memory_briefing');
    }
    case 'memory_export': {
      const input = MemoryExportSchema.parse(args);
      return withTimeout(() => exportMemories(input.format, input.projectId, input.includeDeleted), timeoutMs, 'memory_export');
    }
    case 'memory_backup': {
      const { description } = MemoryBackupSchema.parse(args);
      return withTimeout(() => backupDatabase(description), timeoutMs, 'memory_backup');
    }
    case 'memory_restore': {
      const { backupPath } = MemoryRestoreSchema.parse(args);
      return withTimeout(() => restoreDatabase(backupPath), timeoutMs, 'memory_restore');
    }
    case 'memory_list_backups': {
      const { limit } = MemoryListBackupsSchema.parse(args);
      return withTimeout(() => listBackups(limit), timeoutMs, 'memory_list_backups');
    }
    case 'memory_link': {
      const input = MemoryLinkSchema.parse(args);
      return withTimeout(() => linkMemory(input as MemoryLinkInput), timeoutMs, 'memory_link');
    }
    case 'memory_refresh_context': {
      const { projectId, maxTokens } = MemoryRefreshContextSchema.parse(args);
      return withTimeout(() => refreshContext(projectId, maxTokens), timeoutMs, 'memory_refresh_context');
    }
    case 'memory_entity_create': {
      const input = MemoryEntityCreateSchema.parse(args);
      return withTimeout(() => createEntity(input as EntityInput), timeoutMs, 'memory_entity_create');
    }
    
    // Utility tools
    case 'get_config': {
      GetConfigSchema.parse(args);
      return withTimeout(() => getConfig(), timeoutMs, 'get_config');
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function generateBriefing(maxTokens: number = 300, projectId?: string): Promise<string> {
  const memories = await listRecentMemories(20, 0, undefined, projectId);
  const sorted = memories.sort((a, b) => 
    (b.importance - a.importance) || 
    (new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  );
  
  const charLimit = maxTokens * 4;
  let briefing = '## Session Briefing\n\n';
  let charCount = briefing.length;
  
  const byType: Record<string, typeof memories> = {};
  for (const mem of sorted) {
    if (!byType[mem.type]) byType[mem.type] = [];
    byType[mem.type]!.push(mem);
  }
  
  for (const [type, mems] of Object.entries(byType)) {
    const section = `### ${type.charAt(0).toUpperCase() + type.slice(1)}s\n`;
    if (charCount + section.length > charLimit) break;
    briefing += section;
    charCount += section.length;
    
    for (const mem of mems.slice(0, 3)) {
      const line = `- ${mem.content.slice(0, 100)}${mem.content.length > 100 ? '...' : ''}\n`;
      if (charCount + line.length > charLimit) break;
      briefing += line;
      charCount += line.length;
    }
    briefing += '\n';
  }
  
  return briefing;
}

async function exportMemories(format: 'json' | 'markdown' = 'json', projectId?: string, includeDeleted: boolean = false): Promise<string> {
  const memories = includeDeleted 
    ? await listDeletedMemories(1000)
    : await listRecentMemories(1000, 0, undefined, projectId);
  
  if (format === 'json') {
    return JSON.stringify(memories, null, 2);
  }
  
  let md = '# Memory Export\n\n';
  md += `Exported: ${new Date().toISOString()}\n`;
  md += `Total: ${memories.length} memories\n\n`;
  
  for (const mem of memories) {
    md += `## ${mem.id}\n\n`;
    md += `- **Type:** ${mem.type}\n`;
    md += `- **Created:** ${mem.createdAt}\n`;
    md += `- **Tags:** ${mem.tags.join(', ') || 'none'}\n`;
    md += `- **Importance:** ${mem.importance}\n\n`;
    md += `${mem.content}\n\n---\n\n`;
  }
  
  return md;
}

// ============================================================================
// Server Setup
// ============================================================================

const server = new Server(
  { name: 'just-memory', version: '0.5.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: ALL_TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    const result = await handleToolCall(name, args ?? {});
    let textResult: string;
    if (typeof result === 'string') {
      textResult = result;
    } else if (result === undefined || result === null) {
      textResult = 'null';
    } else {
      textResult = JSON.stringify(result, null, 2);
    }
    return {
      content: [{
        type: 'text',
        text: textResult,
      }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.error('[just-memory] Initializing database...');
  await initDatabase();
  
  console.error('[just-memory] Initializing embeddings model...');
  try {
    await initEmbeddings();
    console.error('[just-memory] Pre-warming embeddings model...');
    await generateEmbedding('warmup');
    console.error('[just-memory] Embeddings model ready');
  } catch (err) {
    console.error('[just-memory] Warning: Embeddings init failed:', err);
    console.error('[just-memory] Memory search will use BM25 fallback only');
  }
  
  console.error('[just-memory] Starting MCP server (17 tools - Memory only)...');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('[just-memory] Server running on stdio');
  console.error('[just-memory] Note: Filesystem/Terminal/Search removed - use Desktop Commander');
  
  process.on('SIGINT', async () => {
    console.error('[just-memory] Shutting down...');
    await closeDatabase();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.error('[just-memory] Shutting down...');
    await closeDatabase();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[just-memory] Fatal error:', error);
  process.exit(1);
});
