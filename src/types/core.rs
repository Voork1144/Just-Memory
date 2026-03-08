//! Just-Memory — Core Type Definitions
//!
//! Database row types, aggregate query shapes, session types.
//! Convention: *Row = raw SQLite row (matches CREATE TABLE columns).

use serde::{Deserialize, Serialize};

// ============================================================================
// Database Row Types (match CREATE TABLE schemas)
// ============================================================================

/// Primary memory record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRow {
    pub id: String,
    pub project_id: String,
    pub content: String,
    #[serde(rename = "type")]
    pub memory_type: String,
    /// JSON-encoded `Vec<String>` (optional — missing columns yield None)
    pub tags: Option<String>,
    pub importance: Option<f64>,
    pub strength: Option<f64>,
    pub access_count: i64,
    pub created_at: String,
    pub last_accessed: Option<String>,
    pub deleted_at: Option<String>,
    pub confidence: Option<f64>,
    pub source_count: i64,
    pub contradiction_count: i64,
    pub confirmation_count: i64,
    pub embedding: Option<Vec<u8>>,
    // Temporal reasoning (migration 6)
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub superseded_by: Option<String>,
    // Self-editing memory tier (migration 7)
    pub tier: Option<String>,
    pub updated_at: Option<String>,
    // M15: Cognitive Architectures Agent ID
    pub agent_id: Option<String>,
    // M5 Phase C: Intelligence Signals
    pub processing_depth: Option<f64>,
    // Additional metadata columns
    pub source_uri: Option<String>,
    pub content_hash: Option<String>,
    // M10: Usage Tracking
    pub search_hit_count: i64,
    // Quality score (computed/cached)
    pub quality_score: Option<f64>,
}

/// MemoryRow with an extra `similarity` field from semantic/cosine search.
#[derive(Debug, Clone)]
pub struct MemoryRowWithSimilarity {
    pub memory: MemoryRow,
    pub similarity: f64,
}

/// MemoryRow with an extra `keyword_score` field from keyword search.
#[derive(Debug, Clone)]
pub struct MemoryRowWithKeywordScore {
    pub memory: MemoryRow,
    pub keyword_score: f64,
}

/// MemoryRow with an optional `fts_rank` from FTS5.
#[derive(Debug, Clone)]
pub struct MemoryRowWithFtsRank {
    pub memory: MemoryRow,
    pub fts_rank: Option<f64>,
}

/// Edge (relationship between memories) row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeRow {
    pub id: String,
    pub project_id: String,
    pub from_id: String,
    pub to_id: String,
    pub relation_type: String,
    pub valid_from: String,
    pub valid_to: Option<String>,
    pub confidence: f64,
    /// JSON-encoded object
    pub metadata: String,
    pub created_at: String,
}

/// EdgeRow joined with extra content from a related memory.
#[derive(Debug, Clone)]
pub struct EdgeRowWithContent {
    pub edge: EdgeRow,
    pub other_content: Option<String>,
}

/// Scratchpad key-value row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchpadRow {
    pub key: String,
    pub project_id: String,
    pub value: String,
    pub expires_at: Option<String>,
    pub created_at: String,
}

/// Entity row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub entity_type: String,
    /// JSON-encoded `Vec<String>`
    pub observations: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Entity relation row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityRelationRow {
    pub id: String,
    pub project_id: String,
    pub from_entity: String,
    pub to_entity: String,
    pub relation_type: String,
    pub created_at: String,
}

/// Entity type hierarchy row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityTypeRow {
    pub name: String,
    pub parent_type: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
}

/// Contradiction resolution row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContradictionResolutionRow {
    pub id: String,
    pub project_id: String,
    pub memory_id_1: String,
    pub memory_id_2: String,
    pub resolution_type: String,
    pub chosen_memory: Option<String>,
    pub resolution_note: Option<String>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<String>,
    pub created_at: String,
}

/// Scheduled task row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTaskRow {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    pub cron_expression: Option<String>,
    pub next_run: Option<String>,
    pub last_run: Option<String>,
    pub status: String,
    /// SQLite INTEGER boolean (0 or 1)
    pub recurring: i64,
    pub memory_id: Option<String>,
    pub action_type: String,
    /// JSON-encoded object
    pub action_data: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Tool call history row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRow {
    pub id: String,
    pub tool_name: String,
    /// JSON-encoded object
    pub arguments: String,
    pub output: Option<String>,
    /// SQLite INTEGER boolean (0 or 1)
    pub success: i64,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub project_id: String,
    pub timestamp: String,
}

// ============================================================================
// Concept Node Types (Memory Cortex Layer 2)
// ============================================================================

/// Concept node database row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptNodeRow {
    pub id: String,
    pub project_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub centroid: Option<Vec<u8>>,
    /// JSON-encoded `Vec<String>`
    pub member_ids: String,
    pub cluster_size: i64,
    pub cohesion: f64,
    pub hebbian_strength: f64,
    pub stability: f64,
    pub created_at: String,
    pub last_consolidated: String,
    // Layer 4: Tension-Driven Restructuring
    pub tension: f64,
    pub tension_last_restructured: i64,
}

/// Concept snapshot database row (time-series of concept state).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptSnapshotRow {
    pub id: String,
    pub concept_id: String,
    pub project_id: String,
    pub cycle_number: i64,
    pub centroid: Option<Vec<u8>>,
    /// JSON-encoded `Vec<String>`
    pub member_ids: String,
    pub cluster_size: i64,
    pub cohesion: f64,
    pub hebbian_strength: f64,
    pub stability: f64,
    pub name: Option<String>,
    pub centroid_drift: f64,
    pub member_churn: f64,
    pub cohesion_delta: f64,
    pub event_type: String,
    /// JSON-encoded object
    pub event_metadata: String,
    pub created_at: String,
}

/// Concept drift alert database row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriftAlertRow {
    pub id: String,
    pub concept_id: String,
    pub project_id: String,
    pub alert_type: String,
    pub severity: f64,
    pub cycle_number: i64,
    pub metric_value: f64,
    pub threshold: f64,
    pub description: Option<String>,
    pub acknowledged: i64,
    pub created_at: String,
}

// ============================================================================
// Code Intelligence Types (M12)
// ============================================================================

/// Supported programming languages for code parsing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CodeLanguage {
    Typescript,
    Tsx,
    Javascript,
    Jsx,
    Rust,
    Python,
    Go,
}

/// Types of code entities extracted from AST.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodeEntityKind {
    Function,
    Class,
    Method,
    Interface,
    TypeAlias,
    Variable,
    Module,
    Enum,
    Export,
    Struct,
    Trait,
    Impl,
}

/// Types of relationships between code entities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodeRelationKind {
    Calls,
    Imports,
    Extends,
    Implements,
    Returns,
    UsesType,
    DependsOn,
    Exports,
    Contains,
}

/// Code entity row as stored in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeEntityRow {
    pub id: String,
    pub project_id: String,
    pub file_path: String,
    pub entity_type: String,
    pub name: String,
    pub qualified_name: String,
    pub signature: Option<String>,
    pub start_line: i64,
    pub end_line: i64,
    pub docstring: Option<String>,
    pub complexity: Option<i64>,
    pub language: String,
    pub hash: String,
    pub embedding_id: Option<String>,
    pub bridge_entity_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Code relation row as stored in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeRelationRow {
    pub id: String,
    pub project_id: String,
    pub from_entity_id: String,
    pub to_entity_id: String,
    pub relation_type: String,
    pub confidence: f64,
    /// JSON-encoded metadata
    pub metadata: String,
    pub created_at: String,
}

/// Code snapshot row for change tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSnapshotRow {
    pub id: String,
    pub project_id: String,
    pub file_path: String,
    pub file_hash: String,
    pub entity_count: i64,
    pub relation_count: i64,
    pub snapshot_at: String,
}

// ============================================================================
// Aggregate / Partial Query Row Types
// ============================================================================

/// Generic COUNT(*) as count result.
#[derive(Debug, Clone)]
pub struct CountRow {
    pub count: i64,
}

/// Memories total/active aggregate.
#[derive(Debug, Clone)]
pub struct MemoryCountsRow {
    pub total: i64,
    pub active: i64,
}

/// AVG(confidence) aggregate.
#[derive(Debug, Clone)]
pub struct AvgConfidenceRow {
    pub avg: Option<f64>,
}

/// Type breakdown: SELECT type, COUNT(*) as count.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeCountRow {
    #[serde(rename = "type")]
    pub type_name: String,
    pub count: i64,
}

/// Project memory listing.
#[derive(Debug, Clone)]
pub struct ProjectMemoryRow {
    pub project_id: String,
    pub memory_count: i64,
    pub last_activity: String,
}

/// Project entity count.
#[derive(Debug, Clone)]
pub struct ProjectEntityRow {
    pub project_id: String,
    pub entity_count: i64,
}

/// Tool stats aggregate row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolStatsAggregate {
    pub tool_name: String,
    pub total_calls: i64,
    pub successful: i64,
    pub failed: i64,
    pub avg_duration_ms: Option<f64>,
    pub max_duration_ms: Option<i64>,
    pub first_call: String,
    pub last_call: String,
}

/// Tool summary aggregate row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSummaryAggregate {
    pub total_calls: i64,
    pub successful: i64,
    pub failed: i64,
    pub avg_duration_ms: Option<f64>,
}

/// Minimal memory for re-embedding / enrichment.
#[derive(Debug, Clone)]
pub struct IdContentRow {
    pub id: String,
    pub content: String,
}

/// Vector search result.
#[derive(Debug, Clone)]
pub struct VecScoreRow {
    pub id: String,
    pub score: f64,
}

/// Contradiction scan edge join.
#[derive(Debug, Clone)]
pub struct ContradictionScanEdge {
    pub edge: EdgeRow,
    pub from_content: String,
    pub to_content: String,
    pub from_created_at: String,
    pub to_created_at: String,
}

/// Pending resolution join with memory content.
#[derive(Debug, Clone)]
pub struct PendingResolutionRow {
    pub resolution: ContradictionResolutionRow,
    pub memory1_content: String,
    pub memory2_content: String,
}

/// Consolidation memory row (includes embedding).
#[derive(Debug, Clone)]
pub struct ConsolidationMemoryRow {
    pub id: String,
    pub content: String,
    pub memory_type: String,
    pub tags: Option<String>,
    pub importance: Option<f64>,
    pub confidence: Option<f64>,
    pub access_count: i64,
    pub created_at: String,
    pub embedding: Option<Vec<u8>>,
}

// ============================================================================
// Qdrant REST Client Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QdrantPoint {
    pub id: String,
    pub vector: Vec<f32>,
    pub payload: QdrantPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QdrantPayload {
    pub project_id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QdrantSearchResult {
    pub id: serde_json::Value,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QdrantCollectionInfo {
    pub points_count: i64,
}

// ============================================================================
// Chat Ingestion Table Rows
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatConversationListRow {
    pub id: String,
    pub source: String,
    pub source_session_id: Option<String>,
    pub project_context: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub message_count: i64,
    pub tool_use_count: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub model: Option<String>,
}

// ============================================================================
// Session Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastToolState {
    pub tool: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashState {
    pub crashed: bool,
    pub last_heartbeat: Option<String>,
    pub last_tool: Option<LastToolState>,
    pub working_files: Option<Vec<String>>,
    pub session_start: Option<String>,
    pub previous_session_id: Option<String>,
}

// ============================================================================
// Contradiction Detection Types
// ============================================================================

/// Contradiction types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContradictionType {
    Semantic,
    Factual,
    Negation,
    Temporal,
    Antonym,
    Nli,
}

/// Suggested action for a contradiction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContradictionAction {
    Review,
    Resolve,
    Ignore,
}

/// Result from contradiction detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContradictionResult {
    pub id: String,
    pub content: String,
    #[serde(rename = "contradictionType")]
    pub contradiction_type: ContradictionType,
    pub confidence: f64,
    pub similarity: f64,
    pub explanation: String,
    #[serde(rename = "suggestedAction")]
    pub suggested_action: ContradictionAction,
}

/// Extracted fact (subject-predicate-object).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedFact {
    pub subject: String,
    pub predicate: String,
    pub object: String,
    pub raw: String,
}

// ============================================================================
// Embedding Registry Types
// ============================================================================

/// Embedding model specification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingModelSpec {
    pub id: String,
    pub hf_model: String,
    pub dimension: usize,
    pub max_tokens: usize,
    pub query_prefix: String,
    pub passage_prefix: String,
    pub dtype: EmbeddingDtype,
    pub pooling: String,
    pub normalize: bool,
    pub status: EmbeddingStatus,
    pub mrl_dimensions: Option<Vec<usize>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmbeddingDtype {
    Q8,
    Fp32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmbeddingStatus {
    Verified,
    Experimental,
}

/// Memory type classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    Fact,
    Event,
    Observation,
    Preference,
    Note,
    Decision,
    Procedure,
}

impl MemoryType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fact => "fact",
            Self::Event => "event",
            Self::Observation => "observation",
            Self::Preference => "preference",
            Self::Note => "note",
            Self::Decision => "decision",
            Self::Procedure => "procedure",
        }
    }
}

/// Memory tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryTier {
    Ephemeral,
    Relevant,
    Established,
    Core,
}

impl MemoryTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ephemeral => "ephemeral",
            Self::Relevant => "relevant",
            Self::Established => "established",
            Self::Core => "core",
        }
    }
}

/// Architecture insight from pattern detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureInsight {
    pub pattern: String,
    pub severity: String,
    pub entities: Vec<String>,
    pub description: String,
    pub suggestion: Option<String>,
}
