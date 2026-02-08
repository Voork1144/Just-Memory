/**
 * Just-Memory v4.3 — Tool Handlers
 * Dispatches MCP tool calls to the appropriate handler functions.
 * Extracted from monolith — uses ToolDispatch interface for dependency injection.
 *
 * The monolith builds a ToolDispatch object from its wrapper functions,
 * then passes it here. This module has no direct access to db, vectorStore,
 * or any other monolith state.
 */

// ============================================================================
// ToolDispatch Interface
// ============================================================================

/**
 * All operations the tool handler dispatch needs.
 * The monolith builds this object from its wrapper functions.
 */
export interface ToolDispatch {
  // Memory CRUD
  storeMemory(content: string, type?: string, tags?: string[], importance?: number, confidence?: number, projectId?: string): Promise<any>;
  recallMemory(id: string, projectId?: string): any;
  updateMemory(id: string, updates: { content?: string; type?: string; tags?: string[]; importance?: number; confidence?: number }, projectId?: string): Promise<any>;
  deleteMemory(id: string, permanent?: boolean, projectId?: string): any;
  findContradictionsProactive(content: string, projectId?: string, limit?: number): Promise<any>;

  // Search
  hybridSearch(query: string, projectId: string, limit?: number, confidenceThreshold?: number): Promise<any>;
  listMemories(projectId?: string, limit?: number, includeDeleted?: boolean): any;

  // Confidence
  confirmMemory(id: string, sourceId?: string, projectId?: string): any;
  contradictMemory(id: string, contradictingId?: string, projectId?: string): any;

  // Edges
  createEdge(fromId: string, toId: string, relationType: string, confidence?: number, metadata?: any, projectId?: string): any;
  queryEdges(memoryId: string, direction?: string, projectId?: string): any;
  invalidateEdge(edgeId: string): any;

  // Scratchpad
  scratchSet(key: string, value: string, ttlSeconds?: number, projectId?: string): any;
  scratchGet(key: string, projectId?: string): any;
  scratchDelete(key: string, projectId?: string): any;
  scratchList(projectId?: string): any;
  scratchClear(projectId?: string): any;

  // Entities
  createEntity(name: string, entityType?: string, observations?: string[], projectId?: string): any;
  getEntity(name: string, projectId?: string): any;
  searchEntities(query: string, entityType?: string, projectId?: string, limit?: number): any;
  observeEntity(name: string, observations: string[], projectId?: string): any;
  deleteEntity(name: string, projectId?: string): any;
  linkEntities(from: string, relationType: string, to: string, projectId?: string): any;
  defineEntityType(name: string, parentType?: string, description?: string): any;
  getTypeHierarchy(typeName: string): any;
  listEntityTypes(): any;
  searchEntitiesByTypeHierarchy(entityType: string, query?: string, projectId?: string, limit?: number): any;

  // Suggestions
  suggestFromContext(contextText: string, projectId?: string, limit?: number): any;

  // Scheduled Tasks
  createScheduledTask(title: string, schedule: string, description?: string, recurring?: boolean, actionType?: string, actionData?: any, memoryId?: string, projectId?: string): any;
  listScheduledTasks(status?: string, projectId?: string, limit?: number): any;
  checkDueTasks(projectId?: string): any;
  completeScheduledTask(taskId: string): any;
  cancelScheduledTask(taskId: string): any;

  // Contradictions
  scanContradictions(projectId?: string, autoCreate?: boolean): any;
  getPendingResolutions(projectId?: string, limit?: number): any;
  resolveContradiction(resolutionId: string, resolutionType: string, note?: string, mergedContent?: string): any;

  // Backup
  backupMemories(projectId?: string): any;
  restoreMemories(path: string, mode?: string, targetProject?: string): any;
  listBackups(): any;

  // Stats
  getStats(projectId?: string): any;
  getToolHistory(toolName?: string, success?: boolean, since?: string, limit?: number, projectId?: string): any[];

  // Embeddings
  reembedOrphaned(projectId?: string, limit?: number, forceRebuild?: boolean): Promise<number>;

  // Briefing
  getBriefingResult(projectId?: string, maxTokens?: number): any;

  // Task tracking
  setCurrentTask(description: string, totalSteps?: number): void;
  updateTaskProgress(step: number, stepDescription: string): void;
  clearCurrentTask(): void;
  getCurrentTask(): any;

  // Projects
  listProjects(): any;
  setCurrentProject(projectId: string, path?: string): any;

  // Health
  getHealthInfo(): Promise<any>;

  // Chat
  discoverConversations(basePath?: string): any;
  parseAndIngest(filePath: string, projectId?: string): any;
  ingestAll(projectId?: string, basePath?: string): any;
  ingestExport(filePath: string, projectId?: string): any;
  getConversationStats(projectId?: string): any;
  searchConversations(query: string, projectId?: string, limit?: number): any;
  getConversation(conversationId: string): any;
  listConversations(projectId?: string, limit?: number): any;
  extractFacts(conversationId: string, projectId?: string): any;
  extractFactsBatch(projectId?: string, limit?: number): any;
  summarizeConversation(conversationId: string, projectId?: string): Promise<any>;
  summarizeBatch(projectId?: string, limit?: number): Promise<any>;
  searchSummaries(query: string, projectId?: string, limit?: number): any;
  extractTopics(conversationId: string, projectId?: string): any;

  // Project-aware helpers
  getEffectiveProject(projectId?: string): string;
}

// ============================================================================
// Dispatch Function
// ============================================================================

/**
 * Dispatches an MCP tool call to the appropriate handler.
 * Returns the result object (caller wraps in MCP response format).
 * Throws on unknown tool name.
 */
export async function dispatchToolCall(
  name: string,
  args: any,
  d: ToolDispatch,
): Promise<any> {
  switch (name) {
    // ---- Memory CRUD ----
    case 'memory_store':
      return d.storeMemory(args.content, args.type, args.tags, args.importance, args.confidence, args.project_id);

    case 'memory_recall':
      return d.recallMemory(args.id, args.project_id);

    case 'memory_update':
      // v3.13: Pick only allowed fields to prevent dynamic SQL field injection
      return d.updateMemory(args.id, {
        content: args.content,
        type: args.type,
        tags: args.tags,
        importance: args.importance,
        confidence: args.confidence,
      }, args.project_id);

    case 'memory_delete':
      return d.deleteMemory(args.id, args.permanent, args.project_id);

    // ---- Search ----
    case 'memory_search':
      return d.hybridSearch(args.query, d.getEffectiveProject(args.project_id), args.limit || 10, args.confidenceThreshold || 0);

    case 'memory_list':
      return d.listMemories(args.project_id, args.limit, args.includeDeleted);

    // ---- Proactive Contradiction Finder ----
    case 'memory_find_contradictions':
      return d.findContradictionsProactive(args.content, args.project_id, args.limit || 10);

    // ---- Confidence (unified) ----
    case 'memory_confidence':
      switch (args.action) {
        case 'confirm':
          return d.confirmMemory(args.id, args.related_id, args.project_id);
        case 'contradict':
          return d.contradictMemory(args.id, args.related_id, args.project_id);
        default:
          return { error: `Unknown confidence action: ${args.action}` };
      }

    // ---- Edges (unified) ----
    case 'memory_edge':
      switch (args.action) {
        case 'create':
          return d.createEdge(args.from_id, args.to_id, args.relation_type, args.confidence, args.metadata, args.project_id);
        case 'query':
          return d.queryEdges(args.memory_id, args.direction, args.project_id);
        case 'invalidate':
          return d.invalidateEdge(args.edge_id);
        default:
          return { error: `Unknown edge action: ${args.action}` };
      }

    // ---- Scratchpad (unified) ----
    case 'memory_scratch':
      switch (args.action) {
        case 'set':
          return d.scratchSet(args.key, args.value, args.ttl_seconds, args.project_id);
        case 'get':
          return d.scratchGet(args.key, args.project_id);
        case 'delete':
          return d.scratchDelete(args.key, args.project_id);
        case 'list':
          return d.scratchList(args.project_id);
        case 'clear':
          return d.scratchClear(args.project_id);
        default:
          return { error: `Unknown scratch action: ${args.action}` };
      }

    // ---- Entities (unified) ----
    case 'memory_entity':
      return dispatchEntity(args, d);

    // ---- Proactive Retrieval ----
    case 'memory_suggest':
      return d.suggestFromContext(args.context, args.project_id, args.limit);

    // ---- Scheduled Tasks (unified) ----
    case 'memory_scheduled':
      switch (args.action) {
        case 'schedule':
          return d.createScheduledTask(args.title, args.schedule, args.description, args.recurring, 'reminder', undefined, undefined, args.project_id);
        case 'list':
          return d.listScheduledTasks(args.status, args.project_id, args.limit);
        case 'check':
          return d.checkDueTasks(args.project_id);
        case 'complete':
          return d.completeScheduledTask(args.task_id);
        case 'cancel':
          return d.cancelScheduledTask(args.task_id);
        default:
          return { error: `Unknown task action: ${args.action}` };
      }

    // ---- Contradiction Resolution (unified) ----
    case 'memory_contradictions':
      switch (args.action) {
        case 'scan':
          return d.scanContradictions(args.project_id, args.auto_create_resolutions);
        case 'pending':
          return d.getPendingResolutions(args.project_id, args.limit);
        case 'resolve':
          return d.resolveContradiction(args.resolution_id, args.resolution_type, args.note, args.merged_content);
        default:
          return { error: `Unknown contradictions action: ${args.action}` };
      }

    // ---- Backup/Restore (unified) ----
    case 'memory_backup':
      switch (args.action || 'create') {
        case 'create':
          return d.backupMemories(args.project_id);
        case 'restore':
          if (!args.path) {
            return { error: 'path is required for restore action' };
          }
          return d.restoreMemories(args.path, args.mode, args.project_id);
        case 'list':
          return d.listBackups();
        default:
          return { error: `Unknown backup action: ${args.action}` };
      }

    // ---- Stats ----
    case 'memory_stats':
      return d.getStats(args.project_id);

    case 'memory_tool_history':
      return d.getToolHistory(args.tool_name, args.success, args.since, args.limit, args.project_id);

    // ---- Embeddings ----
    case 'memory_rebuild_embeddings': {
      const rebuildLimit = args.limit ?? 50;
      const rebuildProject = d.getEffectiveProject(args.project_id);
      const forceRebuild = args.force_rebuild ?? false;
      const rebuildCount = await d.reembedOrphaned(rebuildProject, rebuildLimit, forceRebuild);
      return { reembedded: rebuildCount, project_id: rebuildProject || 'all', force_rebuild: forceRebuild };
    }

    // ---- Briefing ----
    case 'memory_briefing':
      return d.getBriefingResult(args.project_id, args.maxTokens);

    // ---- Task tracking ----
    case 'memory_task':
      switch (args.action) {
        case 'set':
          if (!args.description) {
            return { error: 'description is required for set action' };
          }
          d.setCurrentTask(args.description, args.total_steps);
          return { success: true, task: d.getCurrentTask() };
        case 'update':
          if (args.step === undefined || !args.step_description) {
            return { error: 'step and step_description are required for update action' };
          }
          d.updateTaskProgress(args.step, args.step_description);
          return { success: true, task: d.getCurrentTask() };
        case 'clear':
          d.clearCurrentTask();
          return { success: true, message: 'Task cleared' };
        case 'get':
        default: {
          const task = d.getCurrentTask();
          return task ? { task } : { task: null, message: 'No task in progress' };
        }
      }

    // ---- Project Management (unified) ----
    case 'memory_project':
      switch (args.action) {
        case 'list':
          return d.listProjects();
        case 'set':
          if (!args.project_id) {
            return { error: 'project_id is required for set action' };
          }
          return d.setCurrentProject(args.project_id, args.path);
        default:
          return d.listProjects(); // default to list
      }

    // ---- Health check ----
    case 'memory_health':
      return d.getHealthInfo();

    // ---- Chat Ingestion (unified) ----
    case 'memory_chat':
      return dispatchChat(args, d);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ============================================================================
// Sub-dispatchers for deeply nested switches
// ============================================================================

function dispatchEntity(args: any, d: ToolDispatch): any {
  switch (args.action) {
    case 'create': {
      // v3.13: Normalize observations array (handle MCP serialization)
      let createObs = args.observations;
      if (typeof createObs === 'string') {
        try { createObs = JSON.parse(createObs); } catch { createObs = [createObs]; }
      }
      if (createObs && !Array.isArray(createObs)) createObs = [String(createObs)];
      return d.createEntity(args.name, args.entity_type, createObs, args.project_id);
    }
    case 'get':
      return d.getEntity(args.name, args.project_id);
    case 'search':
      return d.searchEntities(args.query, args.entity_type, args.project_id, args.limit);
    case 'observe': {
      // v3.13: Normalize observations array (handle MCP serialization)
      let obs = args.observations;
      if (typeof obs === 'string') {
        try { obs = JSON.parse(obs); } catch { obs = [obs]; }
      }
      if (obs && !Array.isArray(obs)) obs = [String(obs)];
      if (!obs || !Array.isArray(obs)) obs = [];
      return d.observeEntity(args.name, obs, args.project_id);
    }
    case 'delete':
      return d.deleteEntity(args.name, args.project_id);
    case 'link':
      return d.linkEntities(args.from, args.relation_type, args.to, args.project_id);
    case 'types':
      return dispatchEntityTypes(args, d);
    default:
      return { error: `Unknown entity action: ${args.action}` };
  }
}

function dispatchEntityTypes(args: any, d: ToolDispatch): any {
  switch (args.type_action) {
    case 'define':
      return d.defineEntityType(args.type_name, args.parent_type, args.type_description);
    case 'hierarchy':
      return d.getTypeHierarchy(args.type_name);
    case 'list':
      return d.listEntityTypes();
    case 'search_hierarchical':
      return d.searchEntitiesByTypeHierarchy(args.entity_type, args.query, args.project_id, args.limit);
    default:
      return { error: `Unknown type_action: ${args.type_action}` };
  }
}

function dispatchChat(args: any, d: ToolDispatch): any | Promise<any> {
  switch (args.action) {
    case 'discover': {
      const files = d.discoverConversations(args.base_path);
      return { files, count: (files as any[]).length };
    }
    case 'ingest':
      return d.parseAndIngest(args.file_path, args.project_id);
    case 'ingest_all':
      return d.ingestAll(args.project_id, args.base_path);
    case 'ingest_export':
      return d.ingestExport(args.file_path, args.project_id);
    case 'stats':
      return d.getConversationStats(args.project_id);
    case 'search':
      return d.searchConversations(args.query, args.project_id, args.limit || 20);
    case 'get': {
      const conv = d.getConversation(args.conversation_id);
      return conv || { error: 'Conversation not found', id: args.conversation_id };
    }
    case 'list':
      return d.listConversations(args.project_id, args.limit);
    case 'extract_facts':
      return d.extractFacts(args.conversation_id, args.project_id);
    case 'extract_facts_batch':
      return d.extractFactsBatch(args.project_id, args.limit || 100);
    case 'summarize':
      return d.summarizeConversation(args.conversation_id, args.project_id);
    case 'summarize_batch':
      return d.summarizeBatch(args.project_id, args.limit || 5);
    case 'search_summaries':
      return d.searchSummaries(args.query, args.project_id, args.limit || 10);
    case 'extract_topics':
      return d.extractTopics(args.conversation_id, args.project_id);
    default:
      return { error: `Unknown chat action: ${args.action}` };
  }
}
