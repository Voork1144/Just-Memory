/**
 * Tests for src/tool-handlers.ts
 * Dispatch routing for all tools, sub-dispatchers, error handling.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { dispatchToolCall, type ToolDispatch } from '../src/tool-handlers.js';

/** Create a mock ToolDispatch that records calls and returns canned results. */
function createMockDispatch(): ToolDispatch & { calls: Array<{ method: string; args: any[] }> } {
  const calls: Array<{ method: string; args: any[] }> = [];

  function track(method: string) {
    return (...args: any[]) => {
      calls.push({ method, args });
      return { ok: true, method };
    };
  }

  function trackAsync(method: string) {
    return async (...args: any[]) => {
      calls.push({ method, args });
      return { ok: true, method };
    };
  }

  return {
    calls,
    // Memory CRUD
    storeMemory: trackAsync('storeMemory'),
    recallMemory: track('recallMemory'),
    updateMemory: trackAsync('updateMemory'),
    deleteMemory: track('deleteMemory'),
    findContradictionsProactive: trackAsync('findContradictionsProactive'),

    // Search
    hybridSearch: trackAsync('hybridSearch'),
    listMemories: track('listMemories'),

    // Confidence
    confirmMemory: track('confirmMemory'),
    contradictMemory: track('contradictMemory'),

    // Edges
    createEdge: track('createEdge'),
    queryEdges: track('queryEdges'),
    invalidateEdge: track('invalidateEdge'),

    // Scratchpad
    scratchSet: track('scratchSet'),
    scratchGet: track('scratchGet'),
    scratchDelete: track('scratchDelete'),
    scratchList: track('scratchList'),
    scratchClear: track('scratchClear'),

    // Entities
    createEntity: track('createEntity'),
    getEntity: track('getEntity'),
    searchEntities: track('searchEntities'),
    observeEntity: track('observeEntity'),
    deleteEntity: track('deleteEntity'),
    linkEntities: track('linkEntities'),
    defineEntityType: track('defineEntityType'),
    getTypeHierarchy: track('getTypeHierarchy'),
    listEntityTypes: track('listEntityTypes'),
    searchEntitiesByTypeHierarchy: track('searchEntitiesByTypeHierarchy'),

    // Suggestions
    suggestFromContext: track('suggestFromContext'),

    // Scheduled Tasks
    createScheduledTask: track('createScheduledTask'),
    listScheduledTasks: track('listScheduledTasks'),
    checkDueTasks: track('checkDueTasks'),
    completeScheduledTask: track('completeScheduledTask'),
    cancelScheduledTask: track('cancelScheduledTask'),

    // Contradictions
    scanContradictions: track('scanContradictions'),
    getPendingResolutions: track('getPendingResolutions'),
    resolveContradiction: track('resolveContradiction'),

    // Backup
    backupMemories: track('backupMemories'),
    restoreMemories: track('restoreMemories'),
    listBackups: track('listBackups'),

    // Stats
    getStats: track('getStats'),
    getToolHistory: track('getToolHistory') as any,

    // Embeddings
    reembedOrphaned: trackAsync('reembedOrphaned') as any,

    // Briefing
    getBriefingResult: track('getBriefingResult'),

    // Task tracking
    setCurrentTask: track('setCurrentTask') as any,
    updateTaskProgress: track('updateTaskProgress') as any,
    clearCurrentTask: track('clearCurrentTask') as any,
    getCurrentTask: track('getCurrentTask') as any,

    // Projects
    listProjects: track('listProjects'),
    setCurrentProject: track('setCurrentProject'),

    // Health
    getHealthInfo: trackAsync('getHealthInfo'),

    // Chat
    discoverConversations: (...args: any[]) => {
      calls.push({ method: 'discoverConversations', args });
      return []; // returns array for count
    },
    parseAndIngest: track('parseAndIngest'),
    ingestAll: track('ingestAll'),
    ingestExport: track('ingestExport'),
    getConversationStats: track('getConversationStats'),
    searchConversations: track('searchConversations'),
    getConversation: track('getConversation'),
    listConversations: track('listConversations'),
    extractFacts: track('extractFacts'),
    extractFactsBatch: track('extractFactsBatch'),
    summarizeConversation: trackAsync('summarizeConversation'),
    summarizeBatch: trackAsync('summarizeBatch'),
    searchSummaries: track('searchSummaries'),
    extractTopics: track('extractTopics'),

    // Helpers
    getEffectiveProject: (pid?: string) => pid || 'test-project',
  };
}

// ============================================================================
// Core Dispatch Routing
// ============================================================================

describe('dispatchToolCall', () => {
  describe('Memory CRUD routing', () => {
    it('should dispatch memory_store', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_store', { content: 'test', type: 'fact' }, d);
      assert.strictEqual(d.calls[0].method, 'storeMemory');
      assert.strictEqual(d.calls[0].args[0], 'test');
    });

    it('should dispatch memory_recall', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_recall', { id: 'abc' }, d);
      assert.strictEqual(d.calls[0].method, 'recallMemory');
      assert.strictEqual(d.calls[0].args[0], 'abc');
    });

    it('should dispatch memory_update with filtered fields', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_update', { id: 'abc', content: 'new', extraField: 'ignored' }, d);
      assert.strictEqual(d.calls[0].method, 'updateMemory');
      const updateObj = d.calls[0].args[1];
      assert.strictEqual(updateObj.content, 'new');
      assert.strictEqual(updateObj.extraField, undefined); // not passed through
    });

    it('should dispatch memory_delete', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_delete', { id: 'abc', permanent: true }, d);
      assert.strictEqual(d.calls[0].method, 'deleteMemory');
      assert.strictEqual(d.calls[0].args[1], true);
    });
  });

  describe('Search routing', () => {
    it('should dispatch memory_search', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_search', { query: 'test query' }, d);
      assert.strictEqual(d.calls[0].method, 'hybridSearch');
    });

    it('should dispatch memory_list', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_list', { limit: 5 }, d);
      assert.strictEqual(d.calls[0].method, 'listMemories');
    });

    it('should dispatch memory_find_contradictions', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_find_contradictions', { content: 'test' }, d);
      assert.strictEqual(d.calls[0].method, 'findContradictionsProactive');
    });
  });

  describe('Confidence routing', () => {
    it('should dispatch confirm action', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_confidence', { action: 'confirm', id: 'abc' }, d);
      assert.strictEqual(d.calls[0].method, 'confirmMemory');
    });

    it('should dispatch contradict action', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_confidence', { action: 'contradict', id: 'abc' }, d);
      assert.strictEqual(d.calls[0].method, 'contradictMemory');
    });

    it('should return error for unknown confidence action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_confidence', { action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Edge routing', () => {
    it('should dispatch create edge', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_edge', { action: 'create', from_id: 'a', to_id: 'b', relation_type: 'rel' }, d);
      assert.strictEqual(d.calls[0].method, 'createEdge');
    });

    it('should dispatch query edges', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_edge', { action: 'query', memory_id: 'a' }, d);
      assert.strictEqual(d.calls[0].method, 'queryEdges');
    });

    it('should dispatch invalidate edge', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_edge', { action: 'invalidate', edge_id: 'e1' }, d);
      assert.strictEqual(d.calls[0].method, 'invalidateEdge');
    });

    it('should return error for unknown edge action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_edge', { action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Scratchpad routing', () => {
    for (const action of ['set', 'get', 'delete', 'list', 'clear']) {
      it(`should dispatch scratch ${action}`, async () => {
        const d = createMockDispatch();
        const methodMap: Record<string, string> = {
          set: 'scratchSet', get: 'scratchGet', delete: 'scratchDelete',
          list: 'scratchList', clear: 'scratchClear',
        };
        await dispatchToolCall('memory_scratch', { action, key: 'k', value: 'v' }, d);
        assert.strictEqual(d.calls[0].method, methodMap[action]);
      });
    }

    it('should return error for unknown scratch action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_scratch', { action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Entity routing', () => {
    it('should dispatch entity create', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'create', name: 'Test' }, d);
      assert.strictEqual(d.calls[0].method, 'createEntity');
    });

    it('should dispatch entity get', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'get', name: 'Test' }, d);
      assert.strictEqual(d.calls[0].method, 'getEntity');
    });

    it('should dispatch entity search', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'search', query: 'test' }, d);
      assert.strictEqual(d.calls[0].method, 'searchEntities');
    });

    it('should dispatch entity observe with string normalization', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'observe', name: 'Test', observations: 'single string' }, d);
      assert.strictEqual(d.calls[0].method, 'observeEntity');
      // observations should be normalized to array
      assert.ok(Array.isArray(d.calls[0].args[1]));
    });

    it('should dispatch entity delete', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'delete', name: 'Test' }, d);
      assert.strictEqual(d.calls[0].method, 'deleteEntity');
    });

    it('should dispatch entity link', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'link', from: 'A', to: 'B', relation_type: 'knows' }, d);
      assert.strictEqual(d.calls[0].method, 'linkEntities');
    });

    it('should return error for unknown entity action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_entity', { action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Entity types sub-dispatch', () => {
    it('should dispatch types define', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'types', type_action: 'define', type_name: 'custom' }, d);
      assert.strictEqual(d.calls[0].method, 'defineEntityType');
    });

    it('should dispatch types hierarchy', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'types', type_action: 'hierarchy', type_name: 'person' }, d);
      assert.strictEqual(d.calls[0].method, 'getTypeHierarchy');
    });

    it('should dispatch types list', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'types', type_action: 'list' }, d);
      assert.strictEqual(d.calls[0].method, 'listEntityTypes');
    });

    it('should dispatch types search_hierarchical', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_entity', { action: 'types', type_action: 'search_hierarchical', entity_type: 'person' }, d);
      assert.strictEqual(d.calls[0].method, 'searchEntitiesByTypeHierarchy');
    });

    it('should return error for unknown type_action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_entity', { action: 'types', type_action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Scheduled tasks routing', () => {
    it('should dispatch schedule action', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_scheduled', { action: 'schedule', title: 'Test', schedule: 'in 1 hour' }, d);
      assert.strictEqual(d.calls[0].method, 'createScheduledTask');
    });

    it('should dispatch list action', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_scheduled', { action: 'list' }, d);
      assert.strictEqual(d.calls[0].method, 'listScheduledTasks');
    });

    it('should dispatch check action', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_scheduled', { action: 'check' }, d);
      assert.strictEqual(d.calls[0].method, 'checkDueTasks');
    });

    it('should dispatch complete action', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_scheduled', { action: 'complete', task_id: 't1' }, d);
      assert.strictEqual(d.calls[0].method, 'completeScheduledTask');
    });

    it('should dispatch cancel action', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_scheduled', { action: 'cancel', task_id: 't1' }, d);
      assert.strictEqual(d.calls[0].method, 'cancelScheduledTask');
    });

    it('should return error for unknown task action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_scheduled', { action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Contradiction resolution routing', () => {
    it('should dispatch scan', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_contradictions', { action: 'scan' }, d);
      assert.strictEqual(d.calls[0].method, 'scanContradictions');
    });

    it('should dispatch pending', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_contradictions', { action: 'pending' }, d);
      assert.strictEqual(d.calls[0].method, 'getPendingResolutions');
    });

    it('should dispatch resolve', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_contradictions', { action: 'resolve', resolution_id: 'r1', resolution_type: 'keep_newer' }, d);
      assert.strictEqual(d.calls[0].method, 'resolveContradiction');
    });

    it('should return error for unknown contradictions action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_contradictions', { action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Backup routing', () => {
    it('should dispatch create (default action)', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_backup', {}, d);
      assert.strictEqual(d.calls[0].method, 'backupMemories');
    });

    it('should dispatch restore with path', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_backup', { action: 'restore', path: '/some/path.json' }, d);
      assert.strictEqual(d.calls[0].method, 'restoreMemories');
    });

    it('should error on restore without path', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_backup', { action: 'restore' }, d);
      assert.ok(result.error);
      assert.match(result.error, /path is required/i);
    });

    it('should dispatch list', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_backup', { action: 'list' }, d);
      assert.strictEqual(d.calls[0].method, 'listBackups');
    });

    it('should return error for unknown backup action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_backup', { action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Task tracking routing', () => {
    it('should dispatch set with description', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_task', { action: 'set', description: 'Do thing' }, d);
      assert.strictEqual(d.calls[0].method, 'setCurrentTask');
      assert.ok(result.success);
    });

    it('should error on set without description', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_task', { action: 'set' }, d);
      assert.ok(result.error);
    });

    it('should dispatch update with step info', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_task', { action: 'update', step: 1, step_description: 'Step 1 done' }, d);
      assert.strictEqual(d.calls[0].method, 'updateTaskProgress');
    });

    it('should error on update without step info', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_task', { action: 'update' }, d);
      assert.ok(result.error);
    });

    it('should dispatch clear', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_task', { action: 'clear' }, d);
      assert.strictEqual(d.calls[0].method, 'clearCurrentTask');
      assert.ok(result.success);
    });

    it('should dispatch get (default)', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_task', { action: 'get' }, d);
      assert.strictEqual(d.calls[0].method, 'getCurrentTask');
    });
  });

  describe('Project routing', () => {
    it('should dispatch project list', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_project', { action: 'list' }, d);
      assert.strictEqual(d.calls[0].method, 'listProjects');
    });

    it('should dispatch project set', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_project', { action: 'set', project_id: 'new-proj' }, d);
      assert.strictEqual(d.calls[0].method, 'setCurrentProject');
    });

    it('should error on project set without project_id', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_project', { action: 'set' }, d);
      assert.ok(result.error);
    });

    it('should default to list for unknown project action', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_project', { action: 'unknown' }, d);
      assert.strictEqual(d.calls[0].method, 'listProjects');
    });
  });

  describe('Chat routing', () => {
    it('should dispatch discover', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_chat', { action: 'discover' }, d);
      assert.strictEqual(d.calls[0].method, 'discoverConversations');
      assert.strictEqual(result.count, 0); // empty array
    });

    it('should dispatch ingest', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'ingest', file_path: '/some/file.jsonl' }, d);
      assert.strictEqual(d.calls[0].method, 'parseAndIngest');
    });

    it('should dispatch ingest_all', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'ingest_all' }, d);
      assert.strictEqual(d.calls[0].method, 'ingestAll');
    });

    it('should dispatch ingest_export', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'ingest_export', file_path: '/f.json' }, d);
      assert.strictEqual(d.calls[0].method, 'ingestExport');
    });

    it('should dispatch stats', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'stats' }, d);
      assert.strictEqual(d.calls[0].method, 'getConversationStats');
    });

    it('should dispatch search', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'search', query: 'test' }, d);
      assert.strictEqual(d.calls[0].method, 'searchConversations');
    });

    it('should dispatch get', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'get', conversation_id: 'c1' }, d);
      assert.strictEqual(d.calls[0].method, 'getConversation');
    });

    it('should dispatch list', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'list' }, d);
      assert.strictEqual(d.calls[0].method, 'listConversations');
    });

    it('should dispatch extract_facts', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'extract_facts', conversation_id: 'c1' }, d);
      assert.strictEqual(d.calls[0].method, 'extractFacts');
    });

    it('should dispatch extract_facts_batch', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'extract_facts_batch' }, d);
      assert.strictEqual(d.calls[0].method, 'extractFactsBatch');
    });

    it('should dispatch summarize', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'summarize', conversation_id: 'c1' }, d);
      assert.strictEqual(d.calls[0].method, 'summarizeConversation');
    });

    it('should dispatch summarize_batch', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'summarize_batch' }, d);
      assert.strictEqual(d.calls[0].method, 'summarizeBatch');
    });

    it('should dispatch search_summaries', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'search_summaries', query: 'test' }, d);
      assert.strictEqual(d.calls[0].method, 'searchSummaries');
    });

    it('should dispatch extract_topics', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_chat', { action: 'extract_topics', conversation_id: 'c1' }, d);
      assert.strictEqual(d.calls[0].method, 'extractTopics');
    });

    it('should return error for unknown chat action', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_chat', { action: 'invalid' }, d);
      assert.ok(result.error);
    });
  });

  describe('Other tools', () => {
    it('should dispatch memory_suggest', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_suggest', { context: 'some context' }, d);
      assert.strictEqual(d.calls[0].method, 'suggestFromContext');
    });

    it('should dispatch memory_stats', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_stats', {}, d);
      assert.strictEqual(d.calls[0].method, 'getStats');
    });

    it('should dispatch memory_tool_history', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_tool_history', { limit: 10 }, d);
      assert.strictEqual(d.calls[0].method, 'getToolHistory');
    });

    it('should dispatch memory_rebuild_embeddings', async () => {
      const d = createMockDispatch();
      const result = await dispatchToolCall('memory_rebuild_embeddings', { limit: 25 }, d);
      assert.strictEqual(d.calls[0].method, 'reembedOrphaned');
      assert.ok('reembedded' in result);
    });

    it('should dispatch memory_briefing', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_briefing', {}, d);
      assert.strictEqual(d.calls[0].method, 'getBriefingResult');
    });

    it('should dispatch memory_health', async () => {
      const d = createMockDispatch();
      await dispatchToolCall('memory_health', {}, d);
      assert.strictEqual(d.calls[0].method, 'getHealthInfo');
    });
  });

  describe('Error handling', () => {
    it('should throw on unknown tool name', async () => {
      const d = createMockDispatch();
      await assert.rejects(
        () => dispatchToolCall('nonexistent_tool', {}, d),
        { message: /Unknown tool: nonexistent_tool/ }
      );
    });
  });
});
