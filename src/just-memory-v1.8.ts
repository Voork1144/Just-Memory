/**
 * Just-Memory v1.8 - Agents Edition
 *
 * Adds AI agent management on top of v1.7's semantic search.
 *
 * New features:
 * - Agents table for storing AI agent configurations
 * - agent_create - Create a new agent
 * - agent_get - Get agent by ID
 * - agent_update - Update agent properties
 * - agent_list - List agents with filtering
 * - agent_delete - Soft/hard delete agents
 * - agent_stats - Get agent statistics
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  initDatabase,
  closeDatabase,
  initEmbeddings,
  createAgent,
  getAgent,
  getAgentByName,
  updateAgent,
  listAgents,
  deleteAgent,
  recoverAgent,
  getAgentStats,
  type AgentInput,
  type AgentType,
  type AgentStatus,
} from './memory/index.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const AGENT_TOOLS = [
  {
    name: 'agent_create',
    description: 'Create a new AI agent with configuration',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Unique agent name' },
        type: {
          type: 'string',
          enum: ['assistant', 'specialist', 'coordinator', 'custom'],
          default: 'assistant',
          description: 'Agent type',
        },
        description: { type: 'string', description: 'What this agent does' },
        systemPrompt: { type: 'string', description: 'System prompt/instructions for the agent' },
        projectId: { type: 'string', description: 'Project isolation ID' },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of capabilities or tool names',
        },
        config: {
          type: 'object',
          description: 'Agent configuration object',
        },
        metadata: {
          type: 'object',
          description: 'Arbitrary metadata',
        },
        status: {
          type: 'string',
          enum: ['active', 'inactive', 'archived'],
          default: 'active',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'agent_get',
    description: 'Get an agent by ID or name',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        name: { type: 'string', description: 'Agent name (alternative to ID)' },
        projectId: { type: 'string', description: 'Project ID (for name lookup)' },
      },
    },
  },
  {
    name: 'agent_update',
    description: 'Update an existing agent',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Agent ID to update' },
        name: { type: 'string', description: 'New name' },
        type: {
          type: 'string',
          enum: ['assistant', 'specialist', 'coordinator', 'custom'],
        },
        description: { type: 'string' },
        systemPrompt: { type: 'string' },
        projectId: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
        config: { type: 'object' },
        metadata: { type: 'object' },
        status: {
          type: 'string',
          enum: ['active', 'inactive', 'archived'],
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'agent_list',
    description: 'List agents with optional filtering',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Filter by project' },
        type: {
          type: 'string',
          enum: ['assistant', 'specialist', 'coordinator', 'custom'],
          description: 'Filter by type',
        },
        status: {
          type: 'string',
          enum: ['active', 'inactive', 'archived'],
          description: 'Filter by status',
        },
        limit: { type: 'number', default: 20, description: 'Max results' },
        offset: { type: 'number', default: 0, description: 'Pagination offset' },
      },
    },
  },
  {
    name: 'agent_delete',
    description: 'Delete an agent (soft delete by default)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Agent ID to delete' },
        permanent: { type: 'boolean', default: false, description: 'Hard delete if true' },
      },
      required: ['id'],
    },
  },
  {
    name: 'agent_recover',
    description: 'Recover a soft-deleted agent',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Agent ID to recover' },
      },
      required: ['id'],
    },
  },
  {
    name: 'agent_stats',
    description: 'Get agent statistics',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Filter by project' },
      },
    },
  },
];

// =============================================================================
// Tool Arguments Type
// =============================================================================

interface ToolArgs {
  // Agent fields
  id?: string;
  name?: string;
  type?: AgentType;
  description?: string;
  systemPrompt?: string;
  projectId?: string;
  capabilities?: string[];
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  status?: AgentStatus;
  permanent?: boolean;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Tool Handler
// =============================================================================

async function handleAgentTool(
  name: string,
  args: ToolArgs
): Promise<unknown> {
  switch (name) {
    case 'agent_create': {
      const input: AgentInput = {
        name: args.name!,
        type: args.type,
        description: args.description,
        systemPrompt: args.systemPrompt,
        projectId: args.projectId,
        capabilities: args.capabilities,
        config: args.config,
        metadata: args.metadata,
        status: args.status,
      };
      return await createAgent(input);
    }

    case 'agent_get': {
      if (args.id) {
        const agent = getAgent(args.id);
        if (!agent) return { error: 'Agent not found', id: args.id };
        return agent;
      }
      if (args.name) {
        const agent = getAgentByName(args.name, args.projectId);
        if (!agent) return { error: 'Agent not found', name: args.name };
        return agent;
      }
      return { error: 'Either id or name is required' };
    }

    case 'agent_update': {
      const updates: Partial<AgentInput> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.type !== undefined) updates.type = args.type;
      if (args.description !== undefined) updates.description = args.description;
      if (args.systemPrompt !== undefined) updates.systemPrompt = args.systemPrompt;
      if (args.projectId !== undefined) updates.projectId = args.projectId;
      if (args.capabilities !== undefined) updates.capabilities = args.capabilities;
      if (args.config !== undefined) updates.config = args.config;
      if (args.metadata !== undefined) updates.metadata = args.metadata;
      if (args.status !== undefined) updates.status = args.status;

      const agent = await updateAgent(args.id!, updates);
      if (!agent) return { error: 'Agent not found', id: args.id };
      return agent;
    }

    case 'agent_list': {
      return listAgents({
        projectId: args.projectId,
        type: args.type,
        status: args.status,
        limit: args.limit,
        offset: args.offset,
      });
    }

    case 'agent_delete': {
      const deleted = deleteAgent(args.id!, args.permanent ?? false);
      return {
        deleted,
        id: args.id,
        permanent: args.permanent ?? false,
      };
    }

    case 'agent_recover': {
      const agent = recoverAgent(args.id!);
      if (!agent) return { error: 'Agent not found or not deleted', id: args.id };
      return agent;
    }

    case 'agent_stats': {
      return getAgentStats(args.projectId);
    }

    default:
      throw new Error(`Unknown agent tool: ${name}`);
  }
}

// =============================================================================
// MCP Server Setup
// =============================================================================

const server = new Server(
  { name: 'just-memory', version: '1.8.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: AGENT_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args || {}) as ToolArgs;

  try {
    const result = await handleAgentTool(name, a);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (e: unknown) {
    return {
      content: [
        { type: 'text', text: `Error: ${e instanceof Error ? e.message : e}` },
      ],
      isError: true,
    };
  }
});

// =============================================================================
// Main
// =============================================================================

async function main() {
  // Initialize database with vector search
  initDatabase({ enableVectorSearch: true });

  // Initialize embeddings engine
  await initEmbeddings();

  // Connect MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Just-Memory v1.8 running (Agents Edition)');
}

main().catch(console.error);

process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});
