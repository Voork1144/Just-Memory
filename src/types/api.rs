//! API result types — MemorySummary, StoreMemoryResult, BriefingResult, etc.
//! These must serialize to the exact same JSON shape as the TypeScript version.

use serde::{Deserialize, Serialize};

use super::core::{
    ArchitectureInsight, EdgeRow, ScratchpadRow, TypeCountRow,
};

// ============================================================================
// Result Types (shaped returns from business-logic functions)
// ============================================================================

/// Truncated memory for list/search/briefing results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySummary {
    pub id: String,
    pub project_id: String,
    pub content: String,
    pub content_truncated: bool,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub tags: Vec<String>,
    pub importance: f64,
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    // Scoring (v5.4 M4)
    #[serde(rename = "combinedScore", skip_serializing_if = "Option::is_none")]
    pub combined_score: Option<f64>,
    #[serde(rename = "rerankScore", skip_serializing_if = "Option::is_none")]
    pub rerank_score: Option<f64>,
    // Temporal reasoning (v5.2)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<String>,
    // M7 A7.3: Concept memberships
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concepts: Option<Vec<MemorySummaryConceptRef>>,
}

/// Concept reference attached to a MemorySummary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySummaryConceptRef {
    pub name: Option<String>,
    pub probability: f64,
}

/// Concept membership for a memory (same shape as MemorySummaryConceptRef).
pub type ConceptMembership = MemorySummaryConceptRef;

/// Tool history entry (shaped from ToolCallRow).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolHistoryEntry {
    pub id: String,
    pub tool: String,
    pub args: serde_json::Value,
    pub output_preview: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub project_id: String,
    pub timestamp: String,
}

/// Tool stats response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolStatsResult {
    pub summary: ToolStatsSummary,
    pub by_tool: Vec<ToolStatsEntry>,
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolStatsSummary {
    pub total_calls: i64,
    pub successful: i64,
    pub failed: i64,
    pub success_rate: String,
    pub avg_duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolStatsEntry {
    pub tool: String,
    pub calls: i64,
    pub successful: i64,
    pub failed: i64,
    pub success_rate: String,
    pub avg_ms: f64,
    pub max_ms: i64,
    pub first_call: String,
    pub last_call: String,
}

/// Similar memory pair (consolidation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarMemoryPair {
    pub memory1: MemoryIdContent,
    pub memory2: MemoryIdContent,
    pub similarity: f64,
    pub method: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryIdContent {
    pub id: String,
    pub content: String,
}

// ============================================================================
// ToolDispatch Return Types
// ============================================================================

/// storeMemory result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreMemoryResult {
    pub id: String,
    pub project_id: String,
    pub content: String,
    pub content_truncated: bool,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub tags: Vec<String>,
    pub importance: f64,
    pub confidence: f64,
    pub strength: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(rename = "embeddingWarning", skip_serializing_if = "Option::is_none")]
    pub embedding_warning: Option<String>,
    pub contradictions: Vec<StoreContradictionInfo>,
    // v5.2: IDs of auto-superseded memories
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superseded: Option<Vec<String>>,
    // M3: Semantic dedup metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deduplicated: Option<bool>,
    #[serde(rename = "duplicateOf", skip_serializing_if = "Option::is_none")]
    pub duplicate_of: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub similarity: Option<f64>,
    #[serde(rename = "dedupAction", skip_serializing_if = "Option::is_none")]
    pub dedup_action: Option<String>,
    // M3: Auto-enrichment metadata
    #[serde(rename = "autoEnriched", skip_serializing_if = "Option::is_none")]
    pub auto_enriched: Option<AutoEnrichmentInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreContradictionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub contradiction_type: String,
    pub confidence: f64,
    pub explanation: String,
    #[serde(rename = "suggestedAction")]
    pub suggested_action: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoEnrichmentInfo {
    #[serde(rename = "autoClassified")]
    pub auto_classified: bool,
    #[serde(rename = "autoTagged")]
    pub auto_tagged: bool,
    #[serde(rename = "autoScored")]
    pub auto_scored: bool,
}

/// recallMemory result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecallMemoryResult {
    pub id: String,
    pub project_id: String,
    pub content: String,
    pub confidence: f64,
    #[serde(rename = "confidenceLevel")]
    pub confidence_level: String,
    #[serde(rename = "confidenceNote", skip_serializing_if = "Option::is_none")]
    pub confidence_note: Option<String>,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub tags: Vec<String>,
    pub importance: f64,
    pub strength: f64,
    pub access_count: i64,
    pub created_at: String,
    pub last_accessed: String,
    pub contradictions: Vec<RecallContradictionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecallContradictionInfo {
    #[serde(rename = "type")]
    pub contradiction_type: String,
    #[serde(rename = "otherMemoryId")]
    pub other_memory_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub metadata: serde_json::Value,
}

/// updateMemory result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMemoryResult {
    pub id: String,
    pub project_id: String,
    pub content: String,
    pub content_truncated: bool,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub tags: Vec<String>,
    pub importance: f64,
    pub confidence: f64,
    pub updated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(rename = "newContradictions")]
    pub new_contradictions: Vec<UpdateContradictionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateContradictionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub contradiction_type: String,
    pub explanation: String,
    pub preview: String,
}

/// deleteMemory result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteMemoryResult {
    pub deleted: bool,
    pub permanent: bool,
    pub id: String,
    #[serde(rename = "canRestore", skip_serializing_if = "Option::is_none")]
    pub can_restore: Option<bool>,
}

/// findContradictionsProactive result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProactiveContradictionResult {
    pub query: String,
    pub project_id: String,
    pub summary: ProactiveContradictionSummary,
    pub contradictions: Vec<ProactiveContradictionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProactiveContradictionSummary {
    #[serde(rename = "totalFound")]
    pub total_found: i64,
    #[serde(rename = "byType")]
    pub by_type: ContradictionTypeCounts,
    #[serde(rename = "actionRequired")]
    pub action_required: i64,
    #[serde(rename = "reviewSuggested")]
    pub review_suggested: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContradictionTypeCounts {
    pub semantic: i64,
    pub factual: i64,
    pub negation: i64,
    pub antonym: i64,
    pub temporal: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProactiveContradictionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub contradiction_type: String,
    pub confidence: f64,
    pub similarity: f64,
    pub explanation: String,
    #[serde(rename = "suggestedAction")]
    pub suggested_action: String,
    pub content: String,
}

/// confirmMemory result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmMemoryResult {
    pub id: String,
    pub project_id: String,
    pub confidence: f64,
    pub source_count: i64,
    pub confirmed: bool,
}

/// contradictMemory result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContradictMemoryResult {
    pub id: String,
    pub project_id: String,
    pub confidence: f64,
    pub contradiction_count: i64,
    pub contradicted: bool,
}

/// createEdge result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEdgeResult {
    pub id: String,
    pub project_id: String,
    pub from_id: String,
    pub to_id: String,
    pub relation_type: String,
    pub confidence: f64,
}

/// queryEdges result — EdgeRow with parsed metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeWithParsedMetadata {
    pub id: String,
    pub project_id: String,
    pub from_id: String,
    pub to_id: String,
    pub relation_type: String,
    pub valid_from: String,
    pub valid_to: Option<String>,
    pub confidence: f64,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

impl EdgeWithParsedMetadata {
    /// Build from an EdgeRow, parsing the JSON metadata string.
    pub fn from_edge_row(row: &EdgeRow) -> Self {
        let metadata = serde_json::from_str(&row.metadata)
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        Self {
            id: row.id.clone(),
            project_id: row.project_id.clone(),
            from_id: row.from_id.clone(),
            to_id: row.to_id.clone(),
            relation_type: row.relation_type.clone(),
            valid_from: row.valid_from.clone(),
            valid_to: row.valid_to.clone(),
            confidence: row.confidence,
            metadata,
            created_at: row.created_at.clone(),
        }
    }
}

/// invalidateEdge result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvalidateEdgeResult {
    pub id: String,
    pub invalidated: bool,
}

// ============================================================================
// Scratchpad Results
// ============================================================================

/// scratchSet result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchSetResult {
    pub key: String,
    pub project_id: String,
    pub stored: bool,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
}

/// scratchGet result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchGetResult {
    pub key: String,
    pub value: Option<String>,
    #[serde(rename = "expiresAt", skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// scratchDelete result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchDeleteResult {
    pub key: String,
    pub deleted: bool,
}

/// scratchList result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchListResult {
    pub project_id: String,
    pub keys: Vec<ScratchpadRow>,
}

/// scratchClear result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchClearResult {
    pub project_id: String,
    pub cleared: i64,
}

// ============================================================================
// Entity Results
// ============================================================================

/// createEntity result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEntityResult {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(rename = "entityType")]
    pub entity_type: String,
    pub observations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged: Option<bool>,
}

/// getEntity result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetEntityResult {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(rename = "entityType")]
    pub entity_type: String,
    pub observation_count: i64,
    pub observations: Vec<String>,
    pub relations: Vec<EntityRelationInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityRelationInfo {
    pub from: String,
    pub to: String,
    #[serde(rename = "type")]
    pub relation_type: String,
}

/// searchEntities result (single entry).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitySearchEntry {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(rename = "entityType")]
    pub entity_type: String,
    pub observation_count: i64,
    pub observations: Vec<String>,
}

/// observeEntity result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObserveEntityResult {
    pub id: String,
    pub name: String,
    pub added: i64,
    pub total_observations: i64,
}

/// deleteEntity result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteEntityResult {
    pub name: String,
    pub deleted: bool,
}

/// linkEntities result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkEntitiesResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub from: String,
    #[serde(rename = "relationType")]
    pub relation_type: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked: Option<bool>,
    #[serde(rename = "alreadyExists", skip_serializing_if = "Option::is_none")]
    pub already_exists: Option<bool>,
}

// ============================================================================
// Entity Type Hierarchy Results
// ============================================================================

/// defineEntityType result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefineEntityTypeResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "parentType", skip_serializing_if = "Option::is_none")]
    pub parent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// getTypeHierarchy result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeHierarchyResult {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "parentType")]
    pub parent_type: Option<String>,
    pub ancestors: Vec<String>,
    pub descendants: Vec<String>,
    pub depth: i64,
}

/// listEntityTypes result (single entry).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityTypeEntry {
    pub name: String,
    #[serde(rename = "parentType")]
    pub parent_type: Option<String>,
    pub description: Option<String>,
    pub depth: i64,
    #[serde(rename = "subtypeCount")]
    pub subtype_count: i64,
}

/// searchEntitiesByTypeHierarchy result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeHierarchySearchResult {
    #[serde(rename = "searchedType")]
    pub searched_type: String,
    #[serde(rename = "includedTypes")]
    pub included_types: Vec<String>,
    pub count: i64,
    pub entities: Vec<TypeHierarchySearchEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeHierarchySearchEntity {
    pub id: String,
    pub name: String,
    #[serde(rename = "entityType")]
    pub entity_type: String,
    pub observations: Vec<String>,
}

// ============================================================================
// Suggestion Results
// ============================================================================

/// suggestFromContext result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestFromContextResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    pub suggestions: Vec<SuggestionEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestionEntry {
    pub id: String,
    pub content: String,
    pub content_truncated: bool,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub tags: Vec<String>,
    pub confidence: f64,
}

// ============================================================================
// Scheduled Task Results
// ============================================================================

/// createScheduledTask result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateScheduledTaskResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    #[serde(rename = "nextRun", skip_serializing_if = "Option::is_none")]
    pub next_run: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurring: Option<bool>,
    #[serde(rename = "actionType", skip_serializing_if = "Option::is_none")]
    pub action_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "scheduleExpr", skip_serializing_if = "Option::is_none")]
    pub schedule_expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

/// listScheduledTasks result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListScheduledTasksResult {
    pub count: i64,
    pub tasks: Vec<ScheduledTaskEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTaskEntry {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "cronExpression")]
    pub cron_expression: Option<String>,
    #[serde(rename = "nextRun")]
    pub next_run: Option<String>,
    #[serde(rename = "lastRun")]
    pub last_run: Option<String>,
    pub status: String,
    pub recurring: bool,
    #[serde(rename = "actionType")]
    pub action_type: String,
    #[serde(rename = "memoryId")]
    pub memory_id: Option<String>,
}

/// checkDueTasks result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckDueTasksResult {
    pub checked_at: String,
    pub triggered_count: i64,
    pub triggered: Vec<TriggeredTaskEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggeredTaskEntry {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "actionType")]
    pub action_type: String,
    #[serde(rename = "actionData")]
    pub action_data: serde_json::Value,
    #[serde(rename = "memoryId")]
    pub memory_id: Option<String>,
    #[serde(rename = "wasRecurring")]
    pub was_recurring: bool,
}

/// completeScheduledTask result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteScheduledTaskResult {
    #[serde(rename = "taskId", skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(rename = "completedAt", skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "currentStatus", skip_serializing_if = "Option::is_none")]
    pub current_status: Option<String>,
}

/// cancelScheduledTask result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelScheduledTaskResult {
    #[serde(rename = "taskId", skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(rename = "cancelledAt", skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ============================================================================
// Contradiction Scan / Resolution Results
// ============================================================================

/// scanContradictions result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanContradictionsResult {
    pub project_id: String,
    pub unresolved_count: i64,
    pub new_resolutions_created: i64,
    pub auto_resolved: i64,
    pub contradictions: Vec<ScanContradictionEntry>,
    pub new_resolutions: Vec<ScanResolutionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanContradictionEntry {
    pub edge_id: String,
    #[serde(rename = "type")]
    pub contradiction_type: String,
    pub memory1: MemoryIdContent,
    pub memory2: MemoryIdContent,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResolutionEntry {
    pub id: String,
    pub memory_id_1: String,
    pub memory_id_2: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_resolved: Option<String>,
}

/// getPendingResolutions result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingResolutionsResult {
    pub pending_count: i64,
    pub resolutions: Vec<PendingResolutionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingResolutionEntry {
    pub id: String,
    pub memory1: MemoryIdContent,
    pub memory2: MemoryIdContent,
    pub created_at: String,
}

/// resolveContradiction result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveContradictionResult {
    #[serde(rename = "resolutionId", skip_serializing_if = "Option::is_none")]
    pub resolution_id: Option<String>,
    #[serde(rename = "resolutionType", skip_serializing_if = "Option::is_none")]
    pub resolution_type: Option<String>,
    #[serde(rename = "chosenMemory", skip_serializing_if = "Option::is_none")]
    pub chosen_memory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_id_1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_id_2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub m1_exists: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub m2_exists: Option<bool>,
}

// ============================================================================
// Backup / Restore Results
// ============================================================================

/// backupMemories result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub filename: String,
    pub filepath: String,
    pub counts: BackupCounts,
    pub cleanup: BackupCleanup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupCounts {
    pub memories: i64,
    pub entities: i64,
    pub relations: i64,
    pub edges: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupCleanup {
    pub removed: Vec<String>,
    pub kept: i64,
}

/// restoreMemories result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restored: Option<BackupCounts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    #[serde(rename = "maxSize", skip_serializing_if = "Option::is_none")]
    pub max_size: Option<i64>,
}

/// listBackups result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListBackupsResult {
    pub backups: Vec<BackupEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    pub filename: String,
    pub filepath: String,
    pub size: i64,
    pub created: String,
}

// ============================================================================
// Stats Result
// ============================================================================

/// getStats result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsResult {
    pub project_id: String,
    pub memories: StatsMemories,
    pub entities: i64,
    pub edges: StatsEdges,
    pub hebbian: StatsHebbian,
    pub concepts: StatsConcepts,
    pub tension: StatsTension,
    #[serde(rename = "typeBreakdown")]
    pub type_breakdown: Vec<TypeCountRow>,
    #[serde(rename = "tierBreakdown")]
    pub tier_breakdown: Vec<TypeCountRow>,
    pub compressed: i64,
    #[serde(rename = "avgMaturity")]
    pub avg_maturity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsMemories {
    pub total: i64,
    pub active: i64,
    #[serde(rename = "withEmbeddings")]
    pub with_embeddings: i64,
    #[serde(rename = "avgConfidence")]
    pub avg_confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsEdges {
    pub total: i64,
    pub contradictions: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsHebbian {
    pub co_retrieval_edges: i64,
    pub avg_weight: f64,
    pub max_weight: f64,
    pub total_co_retrievals: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsConcepts {
    pub total: i64,
    pub stable: i64,
    pub avg_cluster_size: f64,
    pub avg_cohesion: f64,
    pub current_cycle: i64,
    pub total_snapshots: i64,
    pub unacknowledged_alerts: i64,
    pub avg_drift_last_cycle: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsTension {
    pub concepts_with_tension: i64,
    pub avg_tension: f64,
    pub max_tension: f64,
    pub total_restructuring_events: i64,
    pub recent_events: i64,
}

// ============================================================================
// Briefing Result
// ============================================================================

/// getBriefingResult result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefingResult {
    pub project_id: String,
    pub core_memories: Vec<MemorySummary>,
    pub recent_memories: Vec<MemorySummary>,
    pub entities: Vec<BriefingEntityInfo>,
    pub stats: StatsResult,
    pub crash_recovery: Option<CrashRecoveryInfo>,
    pub in_progress_task: Option<TaskState>,
    pub briefing_seq: i64,
    pub pending_tasks: Option<Vec<PendingTaskInfo>>,
    pub current_session_id: String,
    // v5.2: Knowledge gaps
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knowledge_gaps: Option<Vec<KnowledgeGap>>,
    // M7 A7.3: Concept drift alerts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drift_alerts: Option<Vec<BriefingDriftAlert>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefingEntityInfo {
    pub name: String,
    #[serde(rename = "entityType")]
    pub entity_type: String,
    pub observation_count: i64,
    pub observations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashRecoveryInfo {
    pub detected: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_heartbeat: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_tool: Option<CrashRecoveryToolInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_session_start: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashRecoveryToolInfo {
    pub tool: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingTaskInfo {
    pub title: String,
    pub description: Option<String>,
    pub next_run: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeGap {
    #[serde(rename = "type")]
    pub gap_type: String,
    pub severity: String,
    pub description: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefingDriftAlert {
    #[serde(rename = "alertType")]
    pub alert_type: String,
    #[serde(rename = "conceptName")]
    pub concept_name: String,
    pub severity: f64,
    pub description: String,
    pub cycle: i64,
}

/// getCurrentTask result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskState {
    pub description: String,
    #[serde(rename = "totalSteps")]
    pub total_steps: Option<i64>,
    #[serde(rename = "currentStep")]
    pub current_step: i64,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(rename = "lastUpdated", skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
    pub steps: Vec<TaskStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStep {
    pub step: i64,
    pub description: String,
    pub timestamp: String,
}

// ============================================================================
// Project Results
// ============================================================================

/// listProjects result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListProjectsResult {
    pub current: String,
    pub projects: Vec<ProjectEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectEntry {
    pub id: String,
    #[serde(rename = "memoryCount")]
    pub memory_count: i64,
    #[serde(rename = "entityCount")]
    pub entity_count: i64,
    #[serde(rename = "lastActivity")]
    pub last_activity: String,
}

/// setCurrentProject result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetProjectResult {
    pub project_id: String,
    pub path: Option<String>,
    pub set: bool,
}

// ============================================================================
// Health Result
// ============================================================================

/// getHealthInfo result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResult {
    pub status: String,
    pub version: String,
    pub session_id: String,
    pub uptime_seconds: f64,
    pub models: HealthModels,
    pub vector_store: HealthVectorStore,
    pub concurrency: HealthConcurrency,
    pub database: HealthDatabase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub circuit_breaker: Option<serde_json::Value>,
    pub project: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthModels {
    pub embedder: bool,
    pub nli: bool,
    pub vectorlite: bool,
    pub embedding_model: String,
    pub embedding_dim: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthVectorStore {
    pub backend: String,
    pub ready: bool,
    pub vectors: i64,
    pub pending_embeddings: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthConcurrency {
    pub max_writers: i64,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthDatabase {
    pub path: String,
    pub integrity: bool,
    pub memories: i64,
    pub migrations: i64,
}

// ============================================================================
// Concept / Clustering Results
// ============================================================================

/// Result from runConceptClustering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusteringResult {
    pub project_id: String,
    pub memories_clustered: i64,
    pub clusters_found: i64,
    pub concepts_created: i64,
    pub concepts_updated: i64,
    pub concepts_removed: i64,
    pub merges: i64,
    pub duration_ms: i64,
    pub snapshots_recorded: i64,
    pub alerts_generated: i64,
    pub cycle_number: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_bridges: Option<i64>,
}

/// Result from getConceptStats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptStatsResult {
    pub total_concepts: i64,
    pub stable_concepts: i64,
    pub total_memberships: i64,
    pub avg_cluster_size: f64,
    pub avg_cohesion: f64,
    pub avg_hebbian_strength: f64,
}

/// A concept node for a specific memory (from getConceptsForMemory).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConceptInfo {
    #[serde(rename = "conceptId")]
    pub concept_id: String,
    pub name: Option<String>,
    pub probability: f64,
}

// ============================================================================
// Tension Results
// ============================================================================

/// Computed tension score for a concept node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensionScore {
    #[serde(rename = "conceptId")]
    pub concept_id: String,
    pub total: f64,
    pub components: TensionComponents,
    pub in_cooldown: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensionComponents {
    pub internal_contradictions: f64,
    pub drift_pressure: f64,
    pub membership_instability: f64,
    pub low_hebbian_cohesion: f64,
}

/// Result from runTensionRestructuring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensionRestructuringResult {
    pub project_id: String,
    pub cycle_number: i64,
    pub concepts_evaluated: i64,
    pub concepts_in_cooldown: i64,
    pub restructuring_events: i64,
    pub events: Vec<TensionRestructuringEvent>,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensionRestructuringEvent {
    pub concept_id: String,
    pub concept_name: Option<String>,
    pub tension: f64,
    pub actions: Vec<String>,
}

/// Tension stats for memory_stats output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensionStatsResult {
    pub concepts_with_tension: i64,
    pub avg_tension: f64,
    pub max_tension: f64,
    pub total_restructuring_events: i64,
    pub recent_events: i64,
}

// ============================================================================
// Answer Generation Results
// ============================================================================

/// A memory re-ranked by cross-encoder relevance score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedMemory {
    pub id: String,
    pub content: String,
    #[serde(rename = "rerankScore")]
    pub rerank_score: f64,
    #[serde(rename = "originalRank")]
    pub original_rank: i64,
    pub confidence: f64,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub tags: Vec<String>,
}

/// Result returned by the answer generation pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerResult {
    pub question: String,
    pub answer: Option<String>,
    pub confidence: f64,
    pub sources: Vec<AnswerSource>,
    pub model_info: AnswerModelInfo,
    pub fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerSource {
    pub id: String,
    pub content_preview: String,
    #[serde(rename = "rerankScore")]
    pub rerank_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerModelInfo {
    pub cross_encoder_available: bool,
    pub qa_model_available: bool,
    pub reranked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampling_used: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slm_used: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_llm_used: Option<bool>,
}

// ============================================================================
// MCP Sampling Types
// ============================================================================

/// Message in an MCP Sampling conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingMessage {
    pub role: SamplingRole,
    pub content: SamplingContent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SamplingRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

/// Model preference hints for MCP Sampling requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingModelPreferences {
    #[serde(rename = "costPriority", skip_serializing_if = "Option::is_none")]
    pub cost_priority: Option<f64>,
    #[serde(rename = "speedPriority", skip_serializing_if = "Option::is_none")]
    pub speed_priority: Option<f64>,
    #[serde(rename = "intelligencePriority", skip_serializing_if = "Option::is_none")]
    pub intelligence_priority: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hints: Option<Vec<SamplingModelHint>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingModelHint {
    pub name: String,
}

/// Result from an MCP Sampling createMessage request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingResult {
    pub role: SamplingRole,
    pub content: SamplingContent,
    pub model: String,
    #[serde(rename = "stopReason", skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
}

/// SamplingProvider trait — Rust async equivalent of the TS interface.
#[async_trait::async_trait]
pub trait SamplingProvider: Send + Sync {
    fn is_available(&self) -> bool;

    async fn create_message(
        &self,
        messages: &[SamplingMessage],
        system_prompt: Option<&str>,
        max_tokens: Option<u32>,
        model_preferences: Option<&SamplingModelPreferences>,
    ) -> Option<SamplingResult>;
}

// ============================================================================
// Code Intelligence Result Types
// ============================================================================

/// codify result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodifyResult {
    pub project_id: String,
    pub files_processed: i64,
    pub entities_found: i64,
    pub relations_found: i64,
    pub duration_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<String>>,
}

/// code search result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSearchResult {
    pub project_id: String,
    pub query: String,
    pub results: Vec<CodeSearchEntry>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSearchEntry {
    pub id: String,
    pub name: String,
    pub qualified_name: String,
    pub entity_type: String,
    pub file_path: String,
    pub start_line: i64,
    pub end_line: i64,
    pub language: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docstring: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub similarity: Option<f64>,
}

/// code graph result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeGraphResult {
    pub entity: String,
    pub relationships: Vec<CodeGraphRelationship>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeGraphRelationship {
    pub direction: String,
    pub relation_type: String,
    pub entity_name: String,
    pub entity_type: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

/// code diff result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeDiffResult {
    pub file_path: String,
    pub changed: bool,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub modified: Vec<String>,
    pub unchanged: i64,
}

/// code summary result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSummaryResult {
    pub project_id: String,
    pub files: i64,
    pub entities: i64,
    pub relations: i64,
    pub languages: Vec<String>,
    pub insights: Vec<ArchitectureInsight>,
}
