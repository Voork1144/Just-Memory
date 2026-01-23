/**
 * Just-Command MCP Server
 * 
 * A unified MCP server combining persistent memory, filesystem, terminal, and search capabilities.
 * Implements 26 tools for Claude Desktop/Claude.ai integration:
 * - Memory Module: 10 tools
 * - Filesystem Module: 8 tools
 * - Terminal Module: 5 tools
 * - Search Module: 3 tools
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

// Search module imports
import {
  startSearchTool,
  getSearchResultsTool,
  stopSearchTool,
  type SearchOptions,
} from './search/index.js';

// P0 utilities
import { withTimeout, isClaudeDesktopMode } from './utils/index.js';
