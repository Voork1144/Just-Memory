/**
 * Just-Memory v5.0 — Shared Type Definitions
 *
 * Database row interfaces, aggregate query shapes, and function result types.
 * Eliminates `any` casts throughout the codebase.
 *
 * Convention:
 *   - *Row     = raw SQLite row (matches CREATE TABLE columns)
 *   - *Result  = shaped return value from a business-logic function
 */
import type { RunResult } from 'better-sqlite3';

// Re-export RunResult so other modules can reference it from one place
export type { RunResult };

// ============================================================================
// Database Row Types (match CREATE TABLE schemas in schema.ts)
// ============================================================================

export interface MemoryRow {
  id: string;
  project_id: string;
  content: string;
  type: string;
  tags: string;            // JSON-encoded string[]
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
  // Emotional context columns (migration-added)
  sentiment?: string;
  emotion_intensity?: number;
  emotion_labels?: string;  // JSON-encoded string[]
  user_mood?: string | null;
  updated_at?: string;
}

/** MemoryRow with an extra `similarity` field from semantic/cosine search */
export interface MemoryRowWithSimilarity extends MemoryRow {
  similarity: number;
}

/** MemoryRow with an extra `keywordScore` field from keyword search */
export interface MemoryRowWithKeywordScore extends MemoryRow {
  keywordScore: number;
}

/** MemoryRow with an optional `fts_rank` from FTS5 */
export interface MemoryRowWithFTSRank extends MemoryRow {
  fts_rank?: number;
}

export interface EdgeRow {
  id: string;
  project_id: string;
  from_id: string;
  to_id: string;
  relation_type: string;
  valid_from: string;
  valid_to: string | null;
  confidence: number;
  metadata: string;        // JSON-encoded object
  created_at: string;
}

/** EdgeRow joined with extra content from a related memory */
export interface EdgeRowWithContent extends EdgeRow {
  other_content?: string;
}

export interface ScratchpadRow {
  key: string;
  project_id: string;
  value: string;
  expires_at: string | null;
  created_at: string;
}

export interface EntityRow {
  id: string;
  project_id: string;
  name: string;
  entity_type: string;
  observations: string;    // JSON-encoded string[]
  created_at: string;
  updated_at: string;
}

export interface EntityRelationRow {
  id: string;
  project_id: string;
  from_entity: string;
  to_entity: string;
  relation_type: string;
  created_at: string;
}

export interface EntityTypeRow {
  name: string;
  parent_type: string | null;
  description: string | null;
  created_at: string;
}

export interface ContradictionResolutionRow {
  id: string;
  project_id: string;
  memory_id_1: string;
  memory_id_2: string;
  resolution_type: string;
  chosen_memory: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ScheduledTaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  cron_expression: string | null;
  next_run: string | null;
  last_run: string | null;
  status: string;
  recurring: number;       // SQLite INTEGER boolean (0 or 1)
  memory_id: string | null;
  action_type: string;
  action_data: string;     // JSON-encoded object
  created_at: string;
  updated_at: string;
}

export interface ToolCallRow {
  id: string;
  tool_name: string;
  arguments: string;       // JSON-encoded object
  output: string | null;
  success: number;         // SQLite INTEGER boolean (0 or 1)
  error: string | null;
  duration_ms: number | null;
  project_id: string;
  timestamp: string;
}

// ============================================================================
// Aggregate / Partial Query Row Types
// ============================================================================

/** Generic COUNT(*) as count result */
export interface CountRow {
  count: number;
}

/** Generic COUNT(*) as cnt result */
export interface CntRow {
  cnt: number;
}

/** Memories total/active aggregate */
export interface MemoryCountsRow {
  total: number;
  active: number;
}

/** AVG(confidence) as avg */
export interface AvgConfidenceRow {
  avg: number | null;
}

/** Type breakdown: SELECT type, COUNT(*) as count */
export interface TypeCountRow {
  type: string;
  count: number;
}

/** Project memory listing */
export interface ProjectMemoryRow {
  project_id: string;
  memory_count: number;
  last_activity: string;
}

/** Project entity count */
export interface ProjectEntityRow {
  project_id: string;
  entity_count: number;
}

/** Tool stats aggregate row */
export interface ToolStatsRow {
  tool_name: string;
  total_calls: number;
  successful: number;
  failed: number;
  avg_duration_ms: number | null;
  max_duration_ms: number | null;
  first_call: string;
  last_call: string;
}

/** Tool summary aggregate row */
export interface ToolSummaryRow {
  total_calls: number;
  successful: number;
  failed: number;
  avg_duration_ms: number | null;
}

/** AVG(access_count) as avg */
export interface AvgAccessRow {
  avg: number | null;
}

/** SELECT id, content — minimal memory for re-embedding */
export interface MemoryIdContent {
  id: string;
  content: string;
}

/** SELECT id, content — minimal memory for enrichment */
export interface IdContentRow {
  id: string;
  content: string;
}

/** SELECT parent_type FROM entity_types */
export interface ParentTypeRow {
  parent_type: string | null;
}

/** SELECT name FROM entity_types */
export interface EntityTypeNameRow {
  name: string;
}

/** Scratchpad value read (only `value` column needed) */
export interface ScratchpadValueRow {
  value: string;
}

/** SELECT id, score from vector search */
export interface VecScoreRow {
  id: string;
  score: number;
}

/** Contradiction scan edge join */
export interface ContradictionScanEdge extends EdgeRow {
  from_content: string;
  to_content: string;
  from_created_at: string;
  to_created_at: string;
}

/** Pending resolution join with memory content */
export interface PendingResolutionRow extends ContradictionResolutionRow {
  memory1_content: string;
  memory2_content: string;
}

/** Consolidation memory row (includes embedding) */
export interface ConsolidationMemoryRow {
  id: string;
  content: string;
  type: string;
  tags: string;
  importance: number;
  confidence: number;
  access_count: number;
  created_at: string;
  embedding: Buffer | null;
}

// ============================================================================
// Qdrant REST Client Types
// ============================================================================

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: {
    project_id: string;
    deleted: boolean;
  };
}

export interface QdrantSearchResult {
  id: string | number;
  score: number;
}

export interface QdrantCollectionInfo {
  points_count: number;
}

export interface QdrantCollectionConfig {
  vectors: {
    size: number;
    distance: string;
    on_disk?: boolean;
  };
  quantization_config?: {
    scalar: {
      type: string;
      quantile: number;
      always_ram: boolean;
    };
  };
  hnsw_config?: {
    m: number;
    ef_construct: number;
    on_disk?: boolean;
  };
}

export interface QdrantSearchParams {
  vector: number[];
  limit: number;
  score_threshold?: number;
  with_payload?: boolean;
  filter?: QdrantFilter;
}

export interface QdrantFilterCondition {
  key?: string;
  match?: { value?: boolean | string; any?: string[] };
  has_id?: string[];
}

export interface QdrantFilter {
  must?: QdrantFilterCondition[];
  must_not?: QdrantFilterCondition[];
}

export interface QdrantDeleteSelector {
  points: string[];
}

// ============================================================================
// Chat Ingestion Table Rows (from chat-ingestion.ts schema)
// ============================================================================

export interface ConversationRow {
  id: string;
  project_id: string;
  session_id: string | null;
  title: string | null;
  source_file: string;
  message_count: number;
  tool_use_count: number;
  first_message_at: string | null;
  last_message_at: string | null;
  model: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  cwd: string | null;
  version: string | null;
  ingested_at: string;
}

/** Row returned by chatListConversations inline SQL query */
export interface ChatConversationListRow {
  id: string;
  source: string;
  source_session_id: string | null;
  project_context: string | null;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  tool_use_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  model: string | null;
}

/** Result returned by chatParseAndIngest */
export type ChatParseAndIngestResult =
  | { conversationId: string; messagesImported: number; toolUsesImported: number }
  | { error: string; file?: string; sessionId?: string };

export interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  message_index: number;
  token_count: number | null;
  model: string | null;
  timestamp: string | null;
  parent_uuid: string | null;
}

export interface ConversationToolUseRow {
  id: string;
  conversation_id: string;
  message_id: string;
  tool_name: string;
  tool_input: string;      // JSON
  tool_output: string | null;
  tool_index: number;
}

export interface MemorySourceRow {
  id: string;
  memory_id: string;
  conversation_id: string;
  message_id: string | null;
  extraction_type: string;
  created_at: string;
}

export interface ConversationSummaryRow {
  id: string;
  conversation_id: string;
  summary: string;
  summary_type: string;
  model_used: string | null;
  created_at: string;
  embedding: Buffer | null;
}

export interface ConversationTopicRow {
  id: string;
  name: string;
  project_id: string;
  frequency: number;
  created_at: string;
}

export interface ConversationTopicLinkRow {
  topic_id: string;
  conversation_id: string;
  relevance: number;
}

// ============================================================================
// Tool Dispatch Argument Types (replace `args: any` in tool-handlers.ts)
// ============================================================================

/**
 * Union type for all tool call arguments dispatched by dispatchToolCall.
 * Each tool receives a Record with string keys; the dispatch switch
 * destructures the relevant fields. Using Record<string, unknown>
 * is the minimal safe type that replaces `any`.
 */
export type ToolArgs = Record<string, unknown>;

// ============================================================================
// Session Types
// ============================================================================

export interface LastToolState {
  tool: string;
  timestamp: string;
}

export interface CrashState {
  crashed: boolean;
  lastHeartbeat?: string;
  lastTool?: LastToolState;
  workingFiles?: string[];
  sessionStart?: string;
  previousSessionId?: string;
}

// ============================================================================
// Result Types (shaped returns from business-logic functions)
// ============================================================================

/** Truncated memory for list/search/briefing results */
export interface MemorySummary {
  id: string;
  project_id: string;
  content: string;
  content_truncated: boolean;
  type: string;
  tags: string[];
  importance: number;
  confidence: number;
  deleted?: boolean;
}

/** Tool history entry (shaped from ToolCallRow) */
export interface ToolHistoryEntry {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  output_preview: string | null;
  success: boolean;
  error: string | null;
  duration_ms: number | null;
  project_id: string;
  timestamp: string;
}

/** Tool stats response */
export interface ToolStatsResult {
  summary: {
    total_calls: number;
    successful: number;
    failed: number;
    success_rate: string;
    avg_duration_ms: number;
  };
  by_tool: Array<{
    tool: string;
    calls: number;
    successful: number;
    failed: number;
    success_rate: string;
    avg_ms: number;
    max_ms: number;
    first_call: string;
    last_call: string;
  }>;
  project_id: string;
}

/** Similar memory pair (consolidation) */
export interface SimilarMemoryPair {
  memory1: { id: string; content: string };
  memory2: { id: string; content: string };
  similarity: number;
  method: string;
  suggestion: string;
}

// ============================================================================
// ToolDispatch Return Types
// Typed return values for ToolDispatch interface methods.
// Many methods return a union of error/success — the generic ToolResult
// base captures the common `error?` shape.
// ============================================================================

/** Generic tool result that may carry an `error` field */
export interface ToolResultBase {
  error?: string;
  [key: string]: unknown;
}

/** storeMemory result */
export interface StoreMemoryResult {
  id: string;
  project_id: string;
  content: string;
  content_truncated: boolean;
  type: string;
  tags: string[];
  importance: number;
  confidence: number;
  strength: number;
  embeddingWarning?: string;
  contradictions: Array<{
    id: string;
    type: string;
    confidence: number;
    explanation: string;
    suggestedAction: string;
    preview: string;
  }>;
}

/** recallMemory result (success path) */
export interface RecallMemoryResult {
  id: string;
  project_id: string;
  content: string;
  confidence: number;
  confidenceLevel: string;
  confidenceNote?: string;
  type: string;
  tags: string[];
  importance: number;
  strength: number;
  access_count: number;
  created_at: string;
  last_accessed: string;
  contradictions: Array<{
    type: string;
    otherMemoryId: string;
    preview?: string;
    metadata: Record<string, unknown>;
  }>;
}

/** updateMemory result (success path) */
export interface UpdateMemoryResult {
  id: string;
  project_id: string;
  content: string;
  content_truncated: boolean;
  type: string;
  tags: string[];
  importance: number;
  confidence: number;
  updated: boolean;
  newContradictions: Array<{
    id: string;
    type: string;
    explanation: string;
    preview: string;
  }>;
}

/** deleteMemory result (success path) */
export interface DeleteMemoryResult {
  deleted: boolean;
  permanent: boolean;
  id: string;
  canRestore?: boolean;
}

/** findContradictionsProactive result */
export interface ProactiveContradictionResult {
  query: string;
  project_id: string;
  summary: {
    totalFound: number;
    byType: {
      semantic: number;
      factual: number;
      negation: number;
      antonym: number;
      temporal: number;
    };
    actionRequired: number;
    reviewSuggested: number;
  };
  contradictions: Array<{
    id: string;
    type: string;
    confidence: number;
    similarity: number;
    explanation: string;
    suggestedAction: string;
    content: string;
  }>;
}

/** confirmMemory result (success path) */
export interface ConfirmMemoryResult {
  id: string;
  project_id: string;
  confidence: number;
  source_count: number;
  confirmed: boolean;
}

/** contradictMemory result (success path) */
export interface ContradictMemoryResult {
  id: string;
  project_id: string;
  confidence: number;
  contradiction_count: number;
  contradicted: boolean;
}

/** createEdge result */
export interface CreateEdgeResult {
  id: string;
  project_id: string;
  from_id: string;
  to_id: string;
  relation_type: string;
  confidence: number;
}

/** queryEdges result (single edge with parsed metadata) */
export interface EdgeWithParsedMetadata extends Omit<EdgeRow, 'metadata'> {
  metadata: Record<string, unknown>;
}

/** invalidateEdge result */
export interface InvalidateEdgeResult {
  id: string;
  invalidated: boolean;
}

/** scratchSet result */
export interface ScratchSetResult {
  key: string;
  project_id: string;
  stored: boolean;
  expiresAt: string | null;
}

/** scratchGet result */
export interface ScratchGetResult {
  key: string;
  value: string | null;
  expiresAt?: string | null;
  createdAt?: string;
}

/** scratchDelete result */
export interface ScratchDeleteResult {
  key: string;
  deleted: boolean;
}

/** scratchList result */
export interface ScratchListResult {
  project_id: string;
  keys: ScratchpadRow[];
}

/** scratchClear result */
export interface ScratchClearResult {
  project_id: string;
  cleared: number;
}

/** createEntity result (may include merged flag) */
export interface CreateEntityResult {
  id: string;
  project_id: string;
  name: string;
  entityType: string;
  observations: string[];
  created?: boolean;
  merged?: boolean;
}

/** getEntity result (success path) */
export interface GetEntityResult {
  id: string;
  project_id: string;
  name: string;
  entityType: string;
  observation_count: number;
  observations: string[];
  relations: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}

/** searchEntities result (single entry) */
export interface EntitySearchEntry {
  id: string;
  project_id: string;
  name: string;
  entityType: string;
  observation_count: number;
  observations: string[];
}

/** observeEntity result (success path) */
export interface ObserveEntityResult {
  id: string;
  name: string;
  added: number;
  total_observations: number;
}

/** deleteEntity result (success path) */
export interface DeleteEntityResult {
  name: string;
  deleted: boolean;
}

/** linkEntities result (success path) */
export interface LinkEntitiesResult {
  id?: string;
  project_id?: string;
  from: string;
  relationType: string;
  to: string;
  linked?: boolean;
  alreadyExists?: boolean;
}

/** defineEntityType result */
export interface DefineEntityTypeResult {
  name?: string;
  parentType?: string | null;
  description?: string | null;
  created?: boolean;
  updated?: boolean;
  error?: string;
}

/** getTypeHierarchy result (success path) */
export interface TypeHierarchyResult {
  name: string;
  description: string | null;
  parentType: string | null;
  ancestors: string[];
  descendants: string[];
  depth: number;
}

/** listEntityTypes result (single entry) */
export interface EntityTypeEntry {
  name: string;
  parentType: string | null;
  description: string | null;
  depth: number;
  subtypeCount: number;
}

/** searchEntitiesByTypeHierarchy result */
export interface TypeHierarchySearchResult {
  searchedType: string;
  includedTypes: string[];
  count: number;
  entities: Array<{
    id: string;
    name: string;
    entityType: string;
    observations: string[];
  }>;
}

/** suggestFromContext result */
export interface SuggestFromContextResult {
  context?: string;
  keywords?: string[];
  suggestions: Array<{
    id: string;
    content: string;
    content_truncated: boolean;
    type: string;
    tags: string[];
    confidence: number;
  }>;
  reason?: string;
}

/** createScheduledTask result (success path) */
export interface CreateScheduledTaskResult {
  id?: string;
  title?: string;
  description?: string | null;
  schedule?: string;
  nextRun?: string;
  recurring?: boolean;
  actionType?: string;
  error?: string;
  scheduleExpr?: string;
  hint?: string;
}

/** listScheduledTasks result */
export interface ListScheduledTasksResult {
  count: number;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    cronExpression: string | null;
    nextRun: string | null;
    lastRun: string | null;
    status: string;
    recurring: boolean;
    actionType: string;
    memoryId: string | null;
  }>;
}

/** checkDueTasks result */
export interface CheckDueTasksResult {
  checked_at: string;
  triggered_count: number;
  triggered: Array<{
    id: string;
    title: string;
    description: string | null;
    actionType: string;
    actionData: Record<string, unknown>;
    memoryId: string | null;
    wasRecurring: boolean;
  }>;
}

/** completeScheduledTask result */
export interface CompleteScheduledTaskResult {
  taskId?: string;
  title?: string;
  status?: string;
  completedAt?: string;
  error?: string;
  currentStatus?: string;
}

/** cancelScheduledTask result */
export interface CancelScheduledTaskResult {
  taskId?: string;
  title?: string;
  status?: string;
  cancelledAt?: string;
  error?: string;
}

/** scanContradictions result */
export interface ScanContradictionsResult {
  project_id: string;
  unresolved_count: number;
  new_resolutions_created: number;
  auto_resolved: number;
  contradictions: Array<{
    edge_id: string;
    type: string;
    memory1: { id: string; content: string };
    memory2: { id: string; content: string };
    confidence: number;
  }>;
  new_resolutions: Array<{
    id: string;
    memory_id_1: string;
    memory_id_2: string;
    auto_resolved?: string;
  }>;
}

/** getPendingResolutions result */
export interface PendingResolutionsResult {
  pending_count: number;
  resolutions: Array<{
    id: string;
    memory1: { id: string; content: string };
    memory2: { id: string; content: string };
    created_at: string;
  }>;
}

/** resolveContradiction result */
export interface ResolveContradictionResult {
  resolutionId?: string;
  resolutionType?: string;
  chosenMemory?: string | null;
  note?: string;
  resolved_at?: string;
  error?: string;
  memory_id_1?: string;
  memory_id_2?: string;
  m1_exists?: boolean;
  m2_exists?: boolean;
}

/** backupMemories result */
export interface BackupResult {
  filename: string;
  filepath: string;
  counts: {
    memories: number;
    entities: number;
    relations: number;
    edges: number;
  };
  cleanup: { removed: string[]; kept: number };
}

/** restoreMemories result */
export interface RestoreResult {
  restored?: {
    memories: number;
    entities: number;
    relations: number;
    edges: number;
  };
  project_id?: string;
  mode?: string;
  note?: string;
  error?: string;
  path?: string;
  size?: number;
  maxSize?: number;
}

/** listBackups result */
export interface ListBackupsResult {
  backups: Array<{
    filename: string;
    filepath: string;
    size: number;
    created: string;
  }>;
  directory?: string;
}

/** getStats result */
export interface StatsResult {
  project_id: string;
  memories: {
    total: number;
    active: number;
    withEmbeddings: number;
    avgConfidence: number;
  };
  entities: number;
  edges: {
    total: number;
    contradictions: number;
  };
  typeBreakdown: TypeCountRow[];
}

/** getBriefingResult result */
export interface BriefingResult {
  project_id: string;
  core_memories: MemorySummary[];
  recent_memories: MemorySummary[];
  entities: Array<{
    name: string;
    entityType: string;
    observation_count: number;
    observations: string[];
  }>;
  stats: StatsResult;
  crash_recovery: {
    detected: boolean;
    message: string;
    last_heartbeat?: string;
    last_tool?: { tool: string; timestamp: string };
    working_files?: string[];
    previous_session_start?: string;
  } | null;
  in_progress_task: TaskState | null;
  briefing_seq: number;
  pending_tasks: Array<{
    title: string;
    description: string | null;
    next_run: string | null;
  }> | null;
  current_session_id: string;
}

/** getCurrentTask result */
export interface TaskState {
  description: string;
  totalSteps: number | null;
  currentStep: number;
  startedAt: string;
  lastUpdated?: string;
  steps: Array<{ step: number; description: string; timestamp: string }>;
}

/** listProjects result */
export interface ListProjectsResult {
  current: string;
  projects: Array<{
    id: string;
    memoryCount: number;
    entityCount: number;
    lastActivity: string;
  }>;
}

/** setCurrentProject result */
export interface SetProjectResult {
  project_id: string;
  path: string | null;
  set: boolean;
}

/** getHealthInfo result */
export interface HealthResult {
  status: string;
  version: string;
  session_id: string;
  uptime_seconds: number;
  models: {
    embedder: boolean;
    nli: boolean;
    vectorlite: boolean;
    embedding_model: string;
    embedding_dim: number;
  };
  vector_store: {
    backend: string;
    ready: boolean;
    vectors: number;
    pending_embeddings: number;
  };
  concurrency: {
    max_writers: number;
    [key: string]: unknown;
  };
  database: {
    path: string;
    integrity: boolean;
    memories: number;
    migrations: number;
  };
  project: string;
}

/** consolidation run result */
export interface ConsolidationResult {
  project_id: string;
  started_at: string;
  idle_detected: boolean;
  strengthened: number;
  decayed: number;
  scratchpad_cleaned: number;
  tool_logs_pruned: number;
  garbage_cleaned: { memoriesDeleted: number; entitiesDeleted: number };
  similar_memories: SimilarMemoryPair[];
  duration_ms: number;
  reembedded?: number;
  autoBackup?: BackupResult | null;
  skipped?: boolean;
  reason?: string;
  locked_by?: string;
}

/** Qdrant collection info response */
export interface QdrantCollectionInfoResponse {
  points_count?: number;
  [key: string]: unknown;
}

/** Integrity check pragma result */
export interface IntegrityCheckRow {
  integrity_check: string;
}

/** Simple count result with 'c' alias */
export interface SimpleCountRow {
  c: number;
}

/** Project ID only row (for embedding worker) */
export interface ProjectIdRow {
  project_id: string;
}
