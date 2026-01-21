/**
 * Just-Command MCP Server
 * 
 * A unified MCP server combining persistent memory, filesystem, and terminal capabilities.
 * Implements 23 tools for Claude Desktop/Claude.ai integration:
 * - Memory Module: 10 tools
 * - Filesystem Module: 8 tools
 * - Terminal Module: 5 tools
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
  type MemoryInput,
  type MemoryType,
} from './memory/index.js';

// Filesystem module imports
import {
  readFile,
  readMultipleFiles,
  writeFile,
  editBlock,
  createDirectory,
  listDirectory,
  moveFile,
  getFileInfo,
} from './filesystem/index.js';

// Terminal module imports
import {
  startProcess,
  interactWithProcess,
  readProcessOutput,
  listSessions,
  forceTerminate,
} from './terminal/index.js';

// P0 utilities
import { withTimeout, isClaudeDesktopMode } from './utils/index.js';

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

// ============================================================================
// Filesystem Tool Schemas
// ============================================================================

const ReadFileSchema = z.object({
  path: z.string().describe('Path to the file to read'),
  offset: z.number().min(0).optional().describe('Line offset (0-based)'),
  length: z.number().min(1).max(1000).optional().describe('Number of lines to read'),
  encoding: z.enum(['utf-8', 'base64', 'hex']).optional().describe('File encoding'),
});

const ReadMultipleFilesSchema = z.object({
  paths: z.array(z.string()).min(1).describe('Array of file paths to read'),
  encoding: z.enum(['utf-8', 'base64', 'hex']).optional(),
});

const WriteFileSchema = z.object({
  path: z.string().describe('Path to write to'),
  content: z.string().describe('Content to write'),
  mode: z.enum(['write', 'append']).optional().describe('Write mode'),
  createDirs: z.boolean().optional().describe('Create parent directories'),
});

const EditBlockSchema = z.object({
  path: z.string().describe('Path to the file to edit'),
  oldText: z.string().describe('Text to find and replace'),
  newText: z.string().describe('Replacement text'),
  expectedReplacements: z.number().min(1).optional().describe('Expected number of replacements'),
});

const CreateDirectorySchema = z.object({
  path: z.string().describe('Directory path to create'),
  recursive: z.boolean().optional().describe('Create parent directories'),
});

const ListDirectorySchema = z.object({
  path: z.string().describe('Directory path to list'),
  depth: z.number().min(1).max(5).optional().describe('Max depth (default: 1)'),
  includeHidden: z.boolean().optional().describe('Include hidden files'),
  pattern: z.string().optional().describe('Glob pattern filter'),
});

const MoveFileSchema = z.object({
  source: z.string().describe('Source path'),
  destination: z.string().describe('Destination path'),
  overwrite: z.boolean().optional().describe('Overwrite if exists'),
});

const GetFileInfoSchema = z.object({
  path: z.string().describe('Path to get info for'),
});

// ============================================================================
// Terminal Tool Schemas
// ============================================================================

const StartProcessSchema = z.object({
  command: z.string().describe('Command to run'),
  args: z.array(z.string()).optional().describe('Command arguments'),
  cwd: z.string().optional().describe('Working directory'),
  timeout: z.number().min(100).max(30000).optional().describe('Timeout in ms'),
});

const InteractProcessSchema = z.object({
  pid: z.number().describe('Process ID'),
  input: z.string().describe('Input to send'),
  timeout: z.number().min(100).max(30000).optional().describe('Timeout in ms'),
  waitForPrompt: z.boolean().optional().describe('Wait for prompt'),
});

const ReadOutputSchema = z.object({
  pid: z.number().describe('Process ID'),
  offset: z.number().min(0).optional().describe('Line offset'),
  length: z.number().min(1).max(1000).optional().describe('Lines to read'),
  timeout: z.number().min(0).max(30000).optional().describe('Wait timeout'),
});

const ListSessionsSchema = z.object({});

const ForceTerminateSchema = z.object({
  pid: z.number().describe('Process ID to terminate'),
  signal: z.enum(['SIGTERM', 'SIGKILL']).optional().describe('Signal to send'),
});



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
];

// ============================================================================
// Filesystem Tool Definitions
// ============================================================================

const FILESYSTEM_TOOLS: Tool[] = [
  {
    name: 'read_file',
    description: 'Read file with pagination and encoding support. Supports utf-8, base64, hex for binary files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        offset: { type: 'number', minimum: 0, description: 'Line offset (0-based)' },
        length: { type: 'number', minimum: 1, maximum: 1000, description: 'Lines to read' },
        encoding: { type: 'string', enum: ['utf-8', 'base64', 'hex'] },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_multiple_files',
    description: 'Read multiple files in batch. Returns content for each file or error.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Array of file paths' },
        encoding: { type: 'string', enum: ['utf-8', 'base64', 'hex'] },
      },
      required: ['paths'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to file. Supports write and append modes.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
        mode: { type: 'string', enum: ['write', 'append'] },
        createDirs: { type: 'boolean', description: 'Create parent directories' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_block',
    description: 'Surgical find/replace edit. Finds exact text and replaces it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File to edit' },
        oldText: { type: 'string', description: 'Text to find' },
        newText: { type: 'string', description: 'Replacement text' },
        expectedReplacements: { type: 'number', minimum: 1, description: 'Expected occurrences' },
      },
      required: ['path', 'oldText', 'newText'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory (recursive by default).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        recursive: { type: 'boolean' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List directory contents with depth control.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        depth: { type: 'number', minimum: 1, maximum: 5 },
        includeHidden: { type: 'boolean' },
        pattern: { type: 'string', description: 'Glob filter' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file. Errors if destination exists (set overwrite=true to replace).',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        destination: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'get_file_info',
    description: 'Get detailed file metadata (size, modified, permissions, line count).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

// ============================================================================
// Terminal Tool Definitions
// ============================================================================

const TERMINAL_TOOLS: Tool[] = [
  {
    name: 'start_process',
    description: 'Start a new process. Timeout enforced (5s in Claude Desktop mode).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', minimum: 100, maximum: 30000 },
      },
      required: ['command'],
    },
  },
  {
    name: 'interact_with_process',
    description: 'Send input to a running process and get output.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Process ID' },
        input: { type: 'string', description: 'Input to send' },
        timeout: { type: 'number', minimum: 100, maximum: 30000 },
        waitForPrompt: { type: 'boolean' },
      },
      required: ['pid', 'input'],
    },
  },
  {
    name: 'read_process_output',
    description: 'Read process output with pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Process ID' },
        offset: { type: 'number', minimum: 0 },
        length: { type: 'number', minimum: 1, maximum: 1000 },
        timeout: { type: 'number', minimum: 0, maximum: 30000 },
      },
      required: ['pid'],
    },
  },
  {
    name: 'list_sessions',
    description: 'List all active terminal sessions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'force_terminate',
    description: 'Force terminate a process.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Process ID' },
        signal: { type: 'string', enum: ['SIGTERM', 'SIGKILL'] },
      },
      required: ['pid'],
    },
  },
];

// Combine all tools
const ALL_TOOLS: Tool[] = [...MEMORY_TOOLS, ...FILESYSTEM_TOOLS, ...TERMINAL_TOOLS];



// ============================================================================
// Tool Handlers
// ============================================================================

async function handleToolCall(name: string, args: unknown): Promise<unknown> {
  const timeoutMs = isClaudeDesktopMode() ? 4500 : 30000;
  
  // Memory tools
  switch (name) {
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
    
    // Filesystem tools
    case 'read_file': {
      const input = ReadFileSchema.parse(args);
      return withTimeout(() => readFile(input), timeoutMs, 'read_file');
    }
    case 'read_multiple_files': {
      const input = ReadMultipleFilesSchema.parse(args);
      return withTimeout(() => readMultipleFiles(input), timeoutMs, 'read_multiple_files');
    }
    case 'write_file': {
      const input = WriteFileSchema.parse(args);
      return withTimeout(() => writeFile(input), timeoutMs, 'write_file');
    }
    case 'edit_block': {
      const input = EditBlockSchema.parse(args);
      return withTimeout(() => editBlock(input), timeoutMs, 'edit_block');
    }
    case 'create_directory': {
      const input = CreateDirectorySchema.parse(args);
      return withTimeout(() => createDirectory(input), timeoutMs, 'create_directory');
    }
    case 'list_directory': {
      const input = ListDirectorySchema.parse(args);
      return withTimeout(() => listDirectory(input), timeoutMs, 'list_directory');
    }
    case 'move_file': {
      const input = MoveFileSchema.parse(args);
      return withTimeout(() => moveFile(input), timeoutMs, 'move_file');
    }
    case 'get_file_info': {
      const input = GetFileInfoSchema.parse(args);
      return withTimeout(() => getFileInfo(input), timeoutMs, 'get_file_info');
    }
    
    // Terminal tools
    case 'start_process': {
      const input = StartProcessSchema.parse(args);
      return withTimeout(() => startProcess(input), timeoutMs, 'start_process');
    }
    case 'interact_with_process': {
      const input = InteractProcessSchema.parse(args);
      return withTimeout(() => interactWithProcess(input), timeoutMs, 'interact_with_process');
    }
    case 'read_process_output': {
      const input = ReadOutputSchema.parse(args);
      return withTimeout(() => readProcessOutput(input), timeoutMs, 'read_process_output');
    }
    case 'list_sessions': {
      ListSessionsSchema.parse(args);
      return withTimeout(() => listSessions(), timeoutMs, 'list_sessions');
    }
    case 'force_terminate': {
      const input = ForceTerminateSchema.parse(args);
      return withTimeout(() => forceTerminate(input), timeoutMs, 'force_terminate');
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
  { name: 'just-command', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: ALL_TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    const result = await handleToolCall(name, args ?? {});
    return {
      content: [{
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
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
  console.error('[just-command] Initializing database...');
  await initDatabase();
  
  console.error('[just-command] Initializing embeddings model...');
  try {
    await initEmbeddings();
    // Pre-warm the model with a dummy embedding to avoid cold start on first search
    console.error('[just-command] Pre-warming embeddings model...');
    await generateEmbedding('warmup');
    console.error('[just-command] Embeddings model ready');
  } catch (err) {
    console.error('[just-command] Warning: Embeddings init failed:', err);
    console.error('[just-command] Memory search will use BM25 fallback only');
  }
  
  console.error('[just-command] Starting MCP server (23 tools)...');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('[just-command] Server running on stdio');
  
  process.on('SIGINT', async () => {
    console.error('[just-command] Shutting down...');
    await closeDatabase();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.error('[just-command] Shutting down...');
    await closeDatabase();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[just-command] Fatal error:', error);
  process.exit(1);
});
