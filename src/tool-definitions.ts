/**
 * Just-Memory v5.0 — Tool Definitions
 * Static MCP tool schema definitions (23 tools).
 * Extracted from monolith — pure data, no logic.
 */

export const TOOLS = [
  // Memory CRUD
  {
    name: 'memory_store',
    description: 'Store a new memory with automatic contradiction detection. Returns any potential contradictions found.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to remember (max 100KB)' },
        type: { type: 'string', enum: ['fact', 'event', 'observation', 'preference', 'note', 'decision', 'procedure'], default: 'note' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Up to 20 tags' },
        importance: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
        confidence: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
        project_id: { type: 'string', description: 'Project scope (auto-detected if omitted)' }
      },
      required: ['content']
    }
  },
  {
    name: 'memory_recall',
    description: 'Recall a memory by ID. Strengthens the memory and returns related contradictions.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'memory_update',
    description: 'Update a memory. Checks for new contradictions if content changes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID' },
        content: { type: 'string' },
        type: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'number' },
        confidence: { type: 'number' }
      },
      required: ['id']
    }
  },
  {
    name: 'memory_delete',
    description: 'Delete a memory (soft delete by default, permanent with flag)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        permanent: { type: 'boolean', default: false }
      },
      required: ['id']
    }
  },
  // Search
  {
    name: 'memory_search',
    description: 'Hybrid search (keyword + semantic) across memories',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', default: 10 },
        confidenceThreshold: { type: 'number', default: 0, minimum: 0, maximum: 1 },
        project_id: { type: 'string' }
      },
      required: ['query']
    }
  },
  {
    name: 'memory_list',
    description: 'List recent memories',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 20 },
        includeDeleted: { type: 'boolean', default: false },
        project_id: { type: 'string' }
      }
    }
  },
  // Proactive Contradiction Finder (v2.1)
  {
    name: 'memory_find_contradictions',
    description: 'PROACTIVELY find contradictions for given content using semantic similarity, negation patterns, and factual claim comparison. Use this BEFORE storing to check for conflicts.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to check for contradictions' },
        limit: { type: 'number', default: 10, description: 'Max contradictions to return' },
        project_id: { type: 'string', description: 'Project scope' }
      },
      required: ['content']
    }
  },
  // Confidence (unified)
  {
    name: 'memory_confidence',
    description: 'Adjust memory confidence. Actions: confirm (increase), contradict (decrease)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['confirm', 'contradict'], description: 'Operation' },
        id: { type: 'string', description: 'Memory ID to adjust' },
        related_id: { type: 'string', description: 'Optional related memory ID (confirming or contradicting source)' }
      },
      required: ['action', 'id']
    }
  },
  // Edges (unified)
  {
    name: 'memory_edge',
    description: 'Memory relationships. Actions: create (link memories), query (find edges), invalidate (mark edge as expired)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'query', 'invalidate'], description: 'Operation' },
        from_id: { type: 'string', description: 'Source memory ID (for create)' },
        to_id: { type: 'string', description: 'Target memory ID (for create)' },
        relation_type: { type: 'string', description: 'Relation type (for create)' },
        confidence: { type: 'number', default: 1.0, description: 'Confidence (for create)' },
        metadata: { type: 'object', description: 'Extra metadata (for create)' },
        memory_id: { type: 'string', description: 'Memory to query (for query)' },
        direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], default: 'both', description: 'Edge direction (for query)' },
        edge_id: { type: 'string', description: 'Edge ID to invalidate (for invalidate)' },
        project_id: { type: 'string' }
      },
      required: ['action']
    }
  },

  // Scratchpad (unified)
  {
    name: 'memory_scratch',
    description: 'Working memory scratchpad. Actions: set (store key/value with optional TTL), get (retrieve), delete (remove key), list (show all keys), clear (remove all)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set', 'get', 'delete', 'list', 'clear'], description: 'Operation to perform' },
        key: { type: 'string', description: 'Key name (required for set/get/delete)' },
        value: { type: 'string', description: 'Value to store (required for set)' },
        ttl_seconds: { type: 'number', description: 'Optional TTL in seconds (for set)' },
        project_id: { type: 'string' }
      },
      required: ['action']
    }
  },
  // Entities (unified)
  {
    name: 'memory_entity',
    description: 'Entity management. Actions: create (new entity), get (with relations), search, observe (add observations), delete, link (relate two entities), types (manage type hierarchy)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'get', 'search', 'observe', 'delete', 'link', 'types'], description: 'Operation' },
        name: { type: 'string', description: 'Entity name (for create/get/observe/delete)' },
        entity_type: { type: 'string', default: 'concept', description: 'Entity type (for create/search)' },
        observations: { type: 'array', items: { type: 'string' }, description: 'Observations (for create/observe)' },
        query: { type: 'string', description: 'Search query (for search)' },
        from: { type: 'string', description: 'Source entity (for link)' },
        relation_type: { type: 'string', description: 'Relation type (for link)' },
        to: { type: 'string', description: 'Target entity (for link)' },
        type_action: { type: 'string', enum: ['define', 'hierarchy', 'list', 'search_hierarchical'], description: 'Type operation (for types)' },
        type_name: { type: 'string', description: 'Type name (for types define/hierarchy)' },
        parent_type: { type: 'string', description: 'Parent type (for types define)' },
        type_description: { type: 'string', description: 'Type description (for types define)' },
        limit: { type: 'number', default: 20 },
        project_id: { type: 'string' }
      },
      required: ['action']
    }
  },
  // Proactive Retrieval (access patterns & suggestions)
  {
    name: 'memory_suggest',
    description: 'Get memory suggestions based on context text. Analyzes keywords and returns relevant memories.',
    inputSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: 'Context text to analyze for suggestions' },
        limit: { type: 'number', default: 10 },
        project_id: { type: 'string' }
      },
      required: ['context']
    }
  },

  // Scheduled Tasks (unified)
  {
    name: 'memory_scheduled',
    description: 'Task scheduling. Actions: schedule (create new), list (show tasks), check (trigger due), complete, cancel. Schedule supports cron or natural language.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['schedule', 'list', 'check', 'complete', 'cancel'], description: 'Operation' },
        task_id: { type: 'string', description: 'Task ID (for complete/cancel)' },
        title: { type: 'string', description: 'Task title (for schedule)' },
        schedule: { type: 'string', description: 'Cron or natural language like "in 30 minutes" (for schedule)' },
        description: { type: 'string', description: 'Task description (for schedule)' },
        recurring: { type: 'boolean', default: false, description: 'Repeat on schedule (for schedule)' },
        status: { type: 'string', enum: ['pending', 'triggered', 'completed', 'cancelled'], description: 'Filter (for list)' },
        limit: { type: 'number', default: 50, description: 'Max results (for list)' },
        project_id: { type: 'string' }
      },
      required: ['action']
    }
  },

  // Contradiction Resolution (unified)
  {
    name: 'memory_contradictions',
    description: 'Handle contradictions. Actions: scan (find unresolved), pending (list awaiting decision), resolve (choose which to keep/merge)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['scan', 'pending', 'resolve'], description: 'Operation' },
        resolution_id: { type: 'string', description: 'Resolution request ID (for resolve)' },
        resolution_type: { type: 'string', enum: ['keep_first', 'keep_second', 'keep_both', 'merge', 'delete_both'], description: 'How to resolve' },
        merged_content: { type: 'string', description: 'New content if merging' },
        note: { type: 'string', description: 'Resolution note' },
        auto_create_resolutions: { type: 'boolean', default: true, description: 'Auto-create resolutions (for scan)' },
        limit: { type: 'number', default: 20 },
        project_id: { type: 'string' }
      },
      required: ['action']
    }
  },

  // Backup/Restore (unified)
  {
    name: 'memory_backup',
    description: 'Backup/restore memories. Actions: create (make backup), restore (from file), list (show backups)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'restore', 'list'], default: 'create', description: 'Operation' },
        path: { type: 'string', description: 'Backup file path (for restore)' },
        mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge', description: 'Restore mode' },
        project_id: { type: 'string' }
      }
    }
  },
  // Stats
  {
    name: 'memory_stats',
    description: 'Get memory statistics including contradiction counts',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project to get stats for, omit for all' }
      }
    }
  },
  {
    name: 'memory_tool_history',
    description: 'Get recent tool call history. Preserves the exploration journey - every tool call, every reasoning path, not just outcomes. Essential for understanding how solutions were reached.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Filter by specific tool name' },
        success: { type: 'boolean', description: 'Filter by success/failure' },
        since: { type: 'string', description: 'ISO timestamp to filter from' },
        limit: { type: 'number', default: 50, description: 'Max results (max 200)' },
        project_id: { type: 'string', description: 'Filter by project' }
      }
    }
  },
  // Embeddings
  {
    name: 'memory_rebuild_embeddings',
    description: 'Backfill missing embeddings for memories in batches. Use when memories lack embeddings for semantic search. Set force_rebuild=true to regenerate ALL embeddings (useful for migrating to new embedding model/dimensions).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', default: 50, description: 'Max memories to process per batch' },
        project_id: { type: 'string', description: 'Project scope (optional)' },
        force_rebuild: { type: 'boolean', default: false, description: 'If true, regenerate embeddings for ALL memories (not just orphaned). Use for dimension migration.' }
      }
    }
  },
  // Briefing
  {
    name: 'memory_briefing',
    description: 'Generate a session briefing with core knowledge (high-importance) and recent memories. Content is truncated; use memory_recall for full text. CALL THIS FIRST if you don\'t remember calling it in this conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        maxTokens: { type: 'number', default: 500 },
        project_id: { type: 'string' }
      }
    }
  },
  // v3.12: Task tracking for context recovery
  {
    name: 'memory_task',
    description: 'Track current task for recovery after context loss. Actions: set (start task), update (checkpoint), clear (task done), get (current status)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set', 'update', 'clear', 'get'], description: 'Operation' },
        description: { type: 'string', description: 'Task description (for set)' },
        total_steps: { type: 'number', description: 'Total steps in task (for set, optional)' },
        step: { type: 'number', description: 'Current step number (for update)' },
        step_description: { type: 'string', description: 'What was done in this step (for update)' }
      },
      required: ['action']
    }
  },
  // Project Management (unified)
  {
    name: 'memory_project',
    description: 'Project management. Actions: list (all projects with counts), set (switch context)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'set'], default: 'list', description: 'Operation' },
        project_id: { type: 'string', description: 'Project ID (for set)' },
        path: { type: 'string', description: 'Project path (for set)' }
      }
    }
  },
  // Health check (v3.13)
  {
    name: 'memory_health',
    description: 'Health check. Returns server status, uptime, model readiness, and database connectivity.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // Chat Ingestion (unified, v3.2 + v4.2 summarization)
  {
    name: 'memory_chat',
    description: 'Chat history ingestion. Actions: discover (find JSONL files), ingest (single file), ingest_all (batch), ingest_export (Claude Desktop export), stats, search, get (by ID), list, extract_facts, extract_facts_batch, summarize (single conversation), summarize_batch (batch), search_summaries, extract_topics',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['discover', 'ingest', 'ingest_all', 'ingest_export', 'stats', 'search', 'get', 'list', 'extract_facts', 'extract_facts_batch', 'summarize', 'summarize_batch', 'search_summaries', 'extract_topics'], description: 'Operation' },
        file_path: { type: 'string', description: 'File path (for ingest/ingest_export)' },
        base_path: { type: 'string', description: 'Base path to search (for discover/ingest_all)' },
        conversation_id: { type: 'string', description: 'Conversation ID (for get/extract_facts)' },
        query: { type: 'string', description: 'Search query (for search)' },
        limit: { type: 'number', default: 20, description: 'Max results' },
        project_id: { type: 'string' }
      },
      required: ['action']
    }
  }
];
