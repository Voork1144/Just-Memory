//! Static configuration constants and namespace config structs.
//! Port of config-definitions.ts — all values must match exactly.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

// ============================================================================
// Helper
// ============================================================================

/// Safe JSON parse with fallback. Silent on error (Bug #18).
pub fn safe_parse<T: serde::de::DeserializeOwned>(json: Option<&str>, default: T) -> T {
    match json {
        Some(s) if !s.is_empty() => serde_json::from_str(s).unwrap_or(default),
        _ => default,
    }
}

// ============================================================================
// LimitsConfig
// ============================================================================

pub struct LimitsConfig;

impl LimitsConfig {
    pub const MAX_CONTENT_LENGTH: usize = 100_000;
    pub const MAX_TAG_LENGTH: usize = 100;
    pub const MAX_TAGS_COUNT: usize = 20;
    pub const MAX_ENTITY_NAME_LENGTH: usize = 200;
    pub const MAX_OBSERVATIONS: usize = 100;
    pub const MAX_SENTENCE_LENGTH: usize = 500;
    pub const MAX_WORD_ARRAY_SIZE: usize = 500;
}

// ============================================================================
// PathsConfig
// ============================================================================

pub struct PathsConfig;

impl PathsConfig {
    fn home_dir() -> PathBuf {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
    }

    pub fn backup_dir() -> PathBuf {
        Self::home_dir().join(".just-memory").join("backups")
    }

    pub fn model_cache() -> PathBuf {
        Self::home_dir().join(".just-memory").join("models")
    }

    pub fn db_dir() -> PathBuf {
        Self::home_dir().join(".just-memory")
    }

    pub fn db_path() -> PathBuf {
        Self::home_dir().join(".just-memory").join("memories.db")
    }
}

// ============================================================================
// ModelConfig
// ============================================================================

pub struct ModelConfig;

impl ModelConfig {
    pub const NLI_MODEL: &str = "Xenova/nli-deberta-v3-base";
    pub const QA_MODEL_DEFAULT: &str = "Xenova/distilbert-base-cased-distilled-squad";
    pub const CROSS_ENCODER_MODEL: &str = "Xenova/ms-marco-MiniLM-L-6-v2";
    pub const SUMMARIZATION_MODEL_DEFAULT: &str = "Xenova/distilbart-cnn-12-6";

    pub const EMBEDDING_TIMEOUT_MS: u64 = 15_000;
    pub const NLI_TIMEOUT_MS: u64 = 30_000;
    pub const SUMMARIZATION_TIMEOUT_MS: u64 = 30_000;
    pub const SUMMARIZATION_MAX_INPUT_CHARS: usize = 4_000;
    pub const QA_TIMEOUT_MS: u64 = 30_000;
    pub const QA_MAX_CONTEXT_CHARS: usize = 4_000;
    pub const CROSS_ENCODER_TIMEOUT_MS: u64 = 10_000;
    pub const CROSS_ENCODER_BATCH_SIZE: usize = 20;

    /// Read QA model from env, fallback to default.
    pub fn qa_model() -> String {
        std::env::var("JUST_MEMORY_QA_MODEL")
            .unwrap_or_else(|_| Self::QA_MODEL_DEFAULT.to_string())
    }

    /// Read summarization model from env, fallback to default.
    pub fn summarization_model() -> String {
        std::env::var("JUST_MEMORY_SUMMARIZER")
            .unwrap_or_else(|_| Self::SUMMARIZATION_MODEL_DEFAULT.to_string())
    }
}

// ============================================================================
// SLMConfig — Local SLM Provider Settings
// ============================================================================

pub struct SlmConfig;

impl SlmConfig {
    pub const TIMEOUT_MS: u64 = 30_000;
    pub const HEALTH_CACHE_TTL_MS: u64 = 60_000;

    pub fn ollama_url() -> String {
        std::env::var("JUST_MEMORY_OLLAMA_URL")
            .unwrap_or_else(|_| "http://localhost:11434".to_string())
    }

    pub fn slm_model() -> String {
        std::env::var("JUST_MEMORY_SLM_MODEL")
            .unwrap_or_else(|_| "qwen2.5:1.5b".to_string())
    }

    pub fn active() -> bool {
        std::env::var("JUST_MEMORY_ENABLE_SLM")
            .map(|v| v != "false")
            .unwrap_or(true)
    }
}

// ============================================================================
// ProjectConfig
// ============================================================================

pub struct ProjectConfig;

impl ProjectConfig {
    pub const GLOBAL_PROJECT: &str = "global";
}

// ============================================================================
// ConfidenceConfig
// ============================================================================

pub struct ConfidenceConfig;

impl ConfidenceConfig {
    // Levels
    pub const LEVEL_HIGH: f64 = 0.8;
    pub const LEVEL_MEDIUM: f64 = 0.5;
    pub const LEVEL_LOW: f64 = 0.3;
    pub const LEVEL_UNCERTAIN: f64 = 0.0;

    // Boosts
    pub const BOOST_CONFIRMATION: f64 = 0.15;
    pub const BOOST_RECENT_ACCESS: f64 = 0.05;
    pub const BOOST_HIGH_IMPORTANCE: f64 = 0.1;

    // Penalties
    pub const PENALTY_CONTRADICTION: f64 = 0.05;
    pub const PENALTY_DECAY_PER_DAY: f64 = 0.001;
    pub const PENALTY_MAX_CONTRADICTION_COUNT: i64 = 3;
}

// ============================================================================
// ContradictionDetectionConfig
// ============================================================================

pub struct ContradictionDetectionConfig;

impl ContradictionDetectionConfig {
    pub const SEMANTIC_SIMILARITY_THRESHOLD: f64 = 0.75;
    pub const FACTUAL_SIMILARITY_THRESHOLD: f64 = 0.85;
    pub const NLI_SIMILARITY_THRESHOLD: f64 = 0.85;
    pub const NLI_CONFIDENCE_THRESHOLD: f64 = 0.85;

    // Penalty by type
    pub const PENALTY_SEMANTIC: f64 = 0.05;
    pub const PENALTY_FACTUAL: f64 = 0.10;
    pub const PENALTY_TEMPORAL: f64 = 0.05;
    pub const PENALTY_NEGATION: f64 = 0.08;
    pub const PENALTY_NLI: f64 = 0.08;
    pub const PENALTY_ANTONYM: f64 = 0.05;

    pub const MAX_RESULTS: usize = 10;

    pub const NEGATION_EXPLICIT: &[&str] = &[
        "not", "n't", "don't", "doesn't", "isn't", "aren't",
        "won't", "can't", "never", "no", "none", "neither", "nor",
    ];

    pub const NEGATION_IMPLICIT: &[&str] = &[
        "impossible", "false", "incorrect", "untrue",
    ];

    /// Antonym pairs for contradiction detection.
    pub const ANTONYMS: &[(&str, &str)] = &[
        ("true", "false"), ("yes", "no"), ("good", "bad"), ("right", "wrong"),
        ("love", "hate"), ("like", "dislike"),
        ("hot", "cold"), ("fast", "slow"), ("big", "small"), ("large", "small"),
        ("high", "low"), ("young", "old"), ("alive", "dead"),
        ("success", "failure"), ("win", "lose"), ("increase", "decrease"),
        ("accept", "reject"), ("agree", "disagree"), ("allow", "forbid"),
        ("always", "never"), ("buy", "sell"),
        ("create", "destroy"), ("early", "late"), ("easy", "hard"),
        ("empty", "full"), ("enter", "exit"),
        ("happy", "sad"), ("include", "exclude"),
        ("possible", "impossible"),
        ("present", "absent"),
        ("remember", "forget"),
        ("safe", "dangerous"), ("same", "different"), ("strong", "weak"),
    ];

    // Factual patterns are compiled at runtime via regex crate (not const).
    // See ContradictionDetector::build_factual_patterns().

    pub const TRANSITIVE_MAX_DEPTH: usize = 2;
    pub const TRANSITIVE_MIN_CONFIDENCE: f64 = 0.5;
    pub const SUPERSESSION_MAX_CHAIN_LENGTH: usize = 10;
}

// ============================================================================
// DecayConfig — ACT-R power-law forgetting
// ============================================================================

/// ACT-R parameters per tier.
#[derive(Debug, Clone, Copy)]
pub struct ActRParams {
    pub a: f64,
    pub b: f64,
    pub c: f64,
}

pub struct DecayConfig;

impl DecayConfig {
    pub const DECAY_CONSTANT: f64 = 0.05;

    pub const ACT_R_EPHEMERAL: ActRParams = ActRParams { a: 1.0, b: 0.05, c: 0.5 };
    pub const ACT_R_RELEVANT: ActRParams = ActRParams { a: 1.0, b: 0.03, c: 0.4 };
    pub const ACT_R_ESTABLISHED: ActRParams = ActRParams { a: 1.0, b: 0.02, c: 0.3 };
    pub const ACT_R_CORE: ActRParams = ActRParams { a: 1.0, b: 0.01, c: 0.2 };

    pub fn act_r_params(tier: &str) -> ActRParams {
        match tier {
            "ephemeral" => Self::ACT_R_EPHEMERAL,
            "relevant" => Self::ACT_R_RELEVANT,
            "established" => Self::ACT_R_ESTABLISHED,
            "core" => Self::ACT_R_CORE,
            _ => Self::ACT_R_EPHEMERAL,
        }
    }

    // Reconsolidation
    pub const RECONSOLIDATION_DRIFT_RATE: f64 = 0.03;
    pub const RECONSOLIDATION_MAX_DRIFT: f64 = 0.15;

    // Retrieval-induced forgetting
    pub const RIF_PENALTY: f64 = 0.02;
    pub const RIF_MAX_COMPETITORS: usize = 10;
    pub const RIF_MIN_SIMILARITY: f64 = 0.5;
}

// ============================================================================
// IntelligenceConfig — M5 Phase C signals
// ============================================================================

pub struct IntelligenceConfig;

impl IntelligenceConfig {
    pub const EMOTIONAL_SENTIMENT_WEIGHT: f64 = 0.3;
    pub const EMOTIONAL_INTENSITY_WEIGHT: f64 = 0.4;
    pub const EMOTIONAL_CONTENT_WEIGHT: f64 = 0.3;
    pub const EMOTIONAL_IMPORTANCE_BOOST: f64 = 0.2;
    pub const EMOTIONAL_SEARCH_BOOST: f64 = 0.1;

    pub const EMOTIONAL_CONTENT_MARKERS: &[&str] = &[
        "error", "crash", "bug", "fix", "breakthrough", "eureka", "finally",
        "critical", "urgent", "important", "warning", "danger", "success",
        "failure", "broken", "fixed", "resolved", "discovered", "realized",
        "problem", "solution", "workaround", "hack",
    ];

    // Processing depth levels (stored → 0.1, retrieved → 0.2, etc.)
    pub fn processing_depth_level(level: &str) -> f64 {
        match level {
            "stored" => 0.1,
            "retrieved" => 0.2,
            "used_in_answer" => 0.4,
            "confirmed" => 0.6,
            "enriched" => 0.8,
            "consolidated" => 1.0,
            _ => 0.0,
        }
    }

    pub const PROCESSING_DEPTH_DECAY_RESISTANCE: f64 = 0.3;
}

// ============================================================================
// TierConfig — M6 tier lifecycle, maturity, compression
// ============================================================================

/// Promotion criteria thresholds.
#[derive(Debug, Clone, Copy)]
pub struct PromotionThresholds {
    pub required_factors: usize,
    pub access: i64,
    pub depth: f64,
    pub maturity: f64,
    pub confidence: f64,
    pub age_days: i64,
    pub edges: i64,
}

/// Demotion criteria.
#[derive(Debug, Clone, Copy)]
pub struct DemotionCriteria {
    pub stale_days: i64,
    pub max_strength: f64,
    pub depth_protection: f64,
}

pub struct TierConfig;

impl TierConfig {
    // Maturity score weights
    pub const MATURITY_WEIGHT_TIER: f64 = 0.25;
    pub const MATURITY_WEIGHT_DEPTH: f64 = 0.20;
    pub const MATURITY_WEIGHT_AGE: f64 = 0.15;
    pub const MATURITY_WEIGHT_FREQUENCY: f64 = 0.15;
    pub const MATURITY_WEIGHT_CONFIDENCE_STABILITY: f64 = 0.15;
    pub const MATURITY_WEIGHT_CONTRADICTION_PENALTY: f64 = 0.10;

    pub fn maturity_tier_score(tier: &str) -> f64 {
        match tier {
            "ephemeral" => 0.1,
            "relevant" => 0.4,
            "established" => 0.7,
            "core" => 1.0,
            _ => 0.1,
        }
    }

    pub const MATURITY_AGE_SIGMOID_K: f64 = 0.1;
    pub const MATURITY_AGE_SIGMOID_MIDPOINT: f64 = 14.0;
    pub const MATURITY_FREQUENCY_LOG_BASE: f64 = 50.0;

    // Importance accumulation
    pub const IMPORTANCE_ACCUMULATOR_THRESHOLD: f64 = 5.0;
    pub const IMPORTANCE_ACCUMULATOR_COOLDOWN_MS: u64 = 60_000;

    // Promotion criteria
    pub const PROMOTE_EPHEMERAL_TO_RELEVANT: PromotionThresholds = PromotionThresholds {
        required_factors: 2, access: 2, depth: 0.2, maturity: 0.15, confidence: 0.3, age_days: 0, edges: 0,
    };
    pub const PROMOTE_RELEVANT_TO_ESTABLISHED: PromotionThresholds = PromotionThresholds {
        required_factors: 3, access: 5, depth: 0.4, maturity: 0.4, confidence: 0.5, age_days: 3, edges: 2,
    };
    pub const PROMOTE_ESTABLISHED_TO_CORE: PromotionThresholds = PromotionThresholds {
        required_factors: 4, access: 10, depth: 0.6, maturity: 0.7, confidence: 0.7, age_days: 7, edges: 5,
    };

    // Demotion criteria
    pub const DEMOTE_CORE_TO_ESTABLISHED: DemotionCriteria = DemotionCriteria {
        stale_days: 90, max_strength: 0.2, depth_protection: 0.8,
    };
    pub const DEMOTE_ESTABLISHED_TO_RELEVANT: DemotionCriteria = DemotionCriteria {
        stale_days: 60, max_strength: 0.15, depth_protection: 0.6,
    };
    pub const DEMOTE_RELEVANT_TO_EPHEMERAL: DemotionCriteria = DemotionCriteria {
        stale_days: 30, max_strength: 0.1, depth_protection: 0.4,
    };

    // Tier change cooldown (24 hours)
    pub const CHANGE_COOLDOWN_MS: u64 = 24 * 60 * 60 * 1000;

    // Memory compression
    pub const COMPRESSION_MIN_CONTENT_LENGTH: usize = 200;
    pub const COMPRESSION_MIN_AGE_DAYS: i64 = 14;
    pub const COMPRESSION_MIN_TIER: &str = "established";
    pub const COMPRESSION_MAX_PER_CYCLE: usize = 5;
}

// ============================================================================
// ConsolidationConfig
// ============================================================================

pub struct ConsolidationConfig;

impl ConsolidationConfig {
    pub const INTERVAL_MS: u64 = 10 * 60 * 1000;
    pub const MAX_INTERVAL_MS: u64 = 15 * 60 * 1000;
    pub const IDLE_THRESHOLD_MS: u64 = 5 * 60 * 1000;
    pub const HARD_TIMEOUT_MS: u64 = 300_000;

    // Adaptive intensity
    pub const ADAPTIVE_HEALTH_DEEP_THRESHOLD: i64 = 60;
    pub const ADAPTIVE_HEALTH_LIGHT_THRESHOLD: i64 = 85;
    pub const ADAPTIVE_CONTRADICTION_DEEP_RATIO: f64 = 0.05;
    pub const ADAPTIVE_TENSION_DEEP_THRESHOLD: f64 = 0.6;
    pub const ADAPTIVE_TIME_SINCE_DEEP_HOURS: i64 = 24;

    // Consolidation replay (SWS-inspired)
    pub const REPLAY_BATCH_SIZE: usize = 20;
    pub const REPLAY_MIN_IMPORTANCE: f64 = 0.4;
    pub const REPLAY_RECENCY_DAYS: i64 = 14;
    pub const REPLAY_SIMILARITY_THRESHOLD: f64 = 0.6;
    pub const REPLAY_MAX_NEW_EDGES: usize = 50;

    // Profiler
    pub const PROFILER_RETENTION_RUNS: usize = 50;
}

// ============================================================================
// HebbianConfig — Memory Cortex Layer 1
// ============================================================================

pub struct HebbianConfig;

impl HebbianConfig {
    pub const LEARNING_RATE: f64 = 0.1;
    pub const DECAY_RATE: f64 = 0.02;
    pub const MIN_WEIGHT: f64 = 0.01;
    pub const MAX_NEIGHBORS: usize = 20;
    pub const TOP_K_RECORD: usize = 5;
    pub const RRF_K: i64 = 60;

    // Synaptic homeostasis
    pub const HOMEOSTASIS_MAX_TOTAL_WEIGHT: f64 = 100.0;
    pub const HOMEOSTASIS_MAX_MEMORY_STRENGTH_SUM: f64 = 500.0;
    pub const HOMEOSTASIS_SCALE_FACTOR: f64 = 0.9;
    pub const HOMEOSTASIS_MIN_WEIGHT_AFTER_SCALE: f64 = 0.02;

    // Adaptive learning rate
    pub const ADAPTIVE_LR_BASE: f64 = 0.1;
    pub const ADAPTIVE_LR_DECAY_FACTOR: f64 = 0.05;
    pub const ADAPTIVE_LR_MIN: f64 = 0.01;

    // Auto-edge discovery
    pub const AUTO_EDGE_MIN_SIMILARITY: f64 = 0.65;
    pub const AUTO_EDGE_INITIAL_WEIGHT: f64 = 0.05;
    pub const AUTO_EDGE_BATCH_SIZE: usize = 50;
    pub const AUTO_EDGE_MAX_DISCOVERIES: usize = 100;
}

// ============================================================================
// ConceptConfig — Memory Cortex Layer 2
// ============================================================================

pub struct ConceptConfig;

impl ConceptConfig {
    pub const MIN_CLUSTER_SIZE: usize = 5;
    pub const MIN_SAMPLES: usize = 3;
    pub const MAX_MEMORIES: usize = 2_000;
    pub const MERGE_THRESHOLD: f64 = 0.90;
    pub const SPLIT_VARIANCE: f64 = 0.40;
    pub const OVERLAP_MATCH: f64 = 0.70;
    pub const MIN_STABILITY: i64 = 3;

    // Concept drift — Layer 3
    pub const DRIFT_RAPID_THRESHOLD: f64 = 0.3;
    pub const DRIFT_COHESION_COLLAPSE: f64 = 0.2;
    pub const DRIFT_MEMBERSHIP_EXODUS: f64 = 0.5;
    pub const DRIFT_IDENTITY_SHIFT_WINDOW: usize = 5;
    pub const DRIFT_IDENTITY_SHIFT_THRESHOLD: f64 = 0.5;
    pub const DRIFT_SNAPSHOTS_PER_CONCEPT: usize = 50;

    // Dynamic merge/split thresholds
    pub const DYNAMIC_YOUNG_MEMORIES: usize = 100;
    pub const DYNAMIC_MATURE_MEMORIES: usize = 1_000;
    pub const DYNAMIC_MIN_CLUSTER_SIZE_RANGE: (usize, usize) = (5, 3);
    pub const DYNAMIC_MERGE_RANGE: (f64, f64) = (0.95, 0.88);
    pub const DYNAMIC_SPLIT_RANGE: (f64, f64) = (0.45, 0.35);
    pub const DYNAMIC_TENSION_RANGE: (f64, f64) = (0.70, 0.55);

    // Crystallization gates — M7 A7.5
    pub const CRYSTALLIZATION_STABILITY: i64 = 5;
    pub const CRYSTALLIZATION_MAX_CONTRADICTION_RATIO: f64 = 0.1;
    pub const CRYSTALLIZATION_MIN_DISTINCTIVENESS: f64 = 0.3;

    // M14: HDBSCAN instability thresholds
    pub const SUPPRESS_CLUSTERING_THRESHOLD: usize = 100;
    pub const SMALL_CLUSTER_THRESHOLD: usize = 500;
    pub const MIN_CLUSTER_SIZE_SMALL: usize = 10;
}

// ============================================================================
// TensionConfig — Memory Cortex Layer 4
// ============================================================================

pub struct TensionConfig;

impl TensionConfig {
    pub const WEIGHT_CONTRADICTIONS: f64 = 0.40;
    pub const WEIGHT_DRIFT: f64 = 0.25;
    pub const WEIGHT_INSTABILITY: f64 = 0.20;
    pub const WEIGHT_COHESION: f64 = 0.15;
    pub const RESTRUCTURE_THRESHOLD: f64 = 0.60;
    pub const HIGH_THRESHOLD: f64 = 0.75;
    pub const SEVERE_THRESHOLD: f64 = 0.85;
    pub const DECAY_PER_CYCLE: f64 = 0.05;
    pub const COOLDOWN_CYCLES: i64 = 3;
    pub const MIN_STABILITY: i64 = 2;
    pub const EJECTION_FRACTION: f64 = 0.10;
    pub const INSTABILITY_WINDOW: usize = 3;
}

// ============================================================================
// SearchConfig
// ============================================================================

/// RRF weight vectors per query intent.
/// Order: [keyword, semantic, temporal, graph, concept, spreading]
pub type RrfWeightVector = [f64; 6];

pub struct SearchConfig;

impl SearchConfig {
    pub const IMPORTANCE_MULTIPLIER: f64 = 0.3;

    pub const RERANK_ENABLED: bool = true;

    pub fn rerank_top_k_multiplier() -> usize {
        std::env::var("JUST_MEMORY_RERANK_MULTIPLIER")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(2)
    }

    pub const MMR_LAMBDA: f64 = 0.7;

    pub fn mmr_enabled() -> bool {
        std::env::var("JUST_MEMORY_MMR")
            .map(|v| v != "false")
            .unwrap_or(true)
    }

    pub fn path_timeout_ms() -> u64 {
        std::env::var("JUST_MEMORY_SEARCH_TIMEOUT")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(2000)
    }

    pub const TEMPORAL_DECAY_HALF_LIFE_DAYS: f64 = 30.0;

    // RRF weights by intent
    pub const RRF_WEIGHTS_FACTUAL: RrfWeightVector = [0.27, 0.27, 0.09, 0.14, 0.13, 0.10];
    pub const RRF_WEIGHTS_TEMPORAL: RrfWeightVector = [0.13, 0.13, 0.42, 0.13, 0.09, 0.10];
    pub const RRF_WEIGHTS_NAVIGATIONAL: RrfWeightVector = [0.32, 0.22, 0.05, 0.18, 0.13, 0.10];
    pub const RRF_WEIGHTS_EXPLORATORY: RrfWeightVector = [0.13, 0.30, 0.09, 0.18, 0.18, 0.12];
    pub const RRF_WEIGHTS_ERROR_DEBUG: RrfWeightVector = [0.23, 0.23, 0.23, 0.09, 0.13, 0.09];
    pub const RRF_WEIGHTS_SOCIAL_REASONING: RrfWeightVector = [0.10, 0.20, 0.10, 0.30, 0.20, 0.10];

    pub fn rrf_weights(intent: &str) -> RrfWeightVector {
        match intent {
            "factual" => Self::RRF_WEIGHTS_FACTUAL,
            "temporal" => Self::RRF_WEIGHTS_TEMPORAL,
            "navigational" => Self::RRF_WEIGHTS_NAVIGATIONAL,
            "exploratory" => Self::RRF_WEIGHTS_EXPLORATORY,
            "error_debug" => Self::RRF_WEIGHTS_ERROR_DEBUG,
            "social_reasoning" => Self::RRF_WEIGHTS_SOCIAL_REASONING,
            _ => Self::RRF_WEIGHTS_FACTUAL,
        }
    }

    // Graph search
    pub const GRAPH_SEED_COUNT: usize = 3;
    pub const GRAPH_MAX_NEIGHBORS: usize = 10;

    // Spreading activation
    pub const SPREADING_ACTIVATION_DECAY: f64 = 0.6;
    pub const SPREADING_ACTIVATION_MAX_HOPS: usize = 2;
    pub const SPREADING_ACTIVATION_MIN_WEIGHT: f64 = 0.05;
    pub const SPREADING_ACTIVATION_MAX_RESULTS: usize = 20;

    // Temporal clustering
    pub const TEMPORAL_CLUSTER_WINDOW_MS: u64 = 30 * 60 * 1000;
    pub const TEMPORAL_CLUSTER_MIN_SIZE: usize = 3;
    pub const TEMPORAL_CLUSTER_WEIGHT: f64 = 0.2;

    // Temporal patterns
    pub const TEMPORAL_PATTERN_MIN_OCCURRENCES: usize = 3;
    pub const TEMPORAL_PATTERN_MAX_RESULTS: usize = 20;

    // RRF normalization
    pub const RRF_NORMALIZATION_FACTOR: f64 = 0.05;

    // HNSW
    pub const HNSW_CANDIDATE_MULTIPLIER: usize = 3;

    pub fn semantic_min_similarity() -> f64 {
        std::env::var("JUST_MEMORY_SEMANTIC_MIN_SIMILARITY")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .unwrap_or(0.3)
    }
}

// ============================================================================
// AnswerConfig — Answer generation (Memory Cortex Phase 5)
// ============================================================================

pub struct AnswerConfig;

impl AnswerConfig {
    pub const SEARCH_LIMIT: usize = 20;
    pub const RERANK_TOP_K: usize = 5;
    pub const MIN_RERANK_SCORE: f64 = 0.01;
    pub const MAX_CONTEXT_CHARS: usize = 3_000;

    // MCP Sampling
    pub const SAMPLING_MAX_TOKENS: u32 = 512;
    pub const SAMPLING_TIMEOUT_MS: u64 = 30_000;
    pub const SAMPLING_COST_PRIORITY: f64 = 0.5;
    pub const SAMPLING_SPEED_PRIORITY: f64 = 0.7;
    pub const SAMPLING_INTELLIGENCE_PRIORITY: f64 = 0.6;
}

// ============================================================================
// AutomationConfig — M3 pipeline
// ============================================================================

pub struct AutomationConfig;

impl AutomationConfig {
    /// Semantic dedup threshold by memory type.
    pub fn dedup_threshold(memory_type: &str) -> f64 {
        match memory_type {
            "fact" => 0.92,
            "procedure" => 0.88,
            "error" => 0.85,
            "preference" => 0.95,
            "decision" => 0.95,
            "note" => 0.90,
            "observation" => 0.90,
            "event" => 0.88,
            _ => 0.90,
        }
    }

    pub const DEDUP_DEFAULT_THRESHOLD: f64 = 0.90;

    // Heartbeat
    pub const HEARTBEAT_TOOL_CALL_INTERVAL: usize = 10;
    pub const HEARTBEAT_TIME_INTERVAL_MS: u64 = 300_000;

    // Auto-tags (TF-IDF)
    pub const TFIDF_CORPUS_REFRESH_INTERVAL: usize = 100;
    pub const AUTO_TAG_MAX_TAGS: usize = 8;
    pub const AUTO_TAG_MIN_WORD_LENGTH: usize = 3;

    // Circuit breaker
    pub const CIRCUIT_BREAKER_MAX_FAILURES: usize = 3;
    pub const CIRCUIT_BREAKER_COOLDOWN_MS: u64 = 300_000;

    // Proactive surfacing
    pub const PROACTIVE_MAX_RESULTS: usize = 3;
    pub const PROACTIVE_MIN_SIMILARITY: f64 = 0.6;

    pub fn auto_capture_enabled() -> bool {
        std::env::var("JUST_MEMORY_AUTO_CAPTURE")
            .map(|v| v != "false")
            .unwrap_or(true)
    }

    pub fn file_watch_enabled() -> bool {
        std::env::var("JUST_MEMORY_FILE_WATCH")
            .map(|v| v == "true")
            .unwrap_or(false)
    }

    // Tool capture
    pub const TOOL_CAPTURE_MIN_RESULT_LENGTH: usize = 50;
    pub const TOOL_CAPTURE_MAX_CONTENT_LENGTH: usize = 500;
    pub const TOOL_CAPTURE_SEQUENCE_WINDOW_MS: u64 = 60_000;

    // Error capture
    pub const ERROR_CAPTURE_MAX_STACK_LENGTH: usize = 1_000;

    // Entity observation summarization
    pub const ENTITY_OBSERVATION_SUMMARY_THRESHOLD: usize = 20;
    pub const ENTITY_OBSERVATION_SUMMARY_KEEP_RECENT: usize = 5;

    // Tool logging
    pub const TOOL_LOG_MAX_OUTPUT: usize = 2_048;
    pub const TOOL_LOG_EXCLUDED: &[&str] = &["memory_stats", "memory_tool_history"];
}

// ============================================================================
// StorageConfig — Qdrant, concurrency
// ============================================================================

pub struct StorageConfig;

impl StorageConfig {
    pub const QDRANT_VERSION: &str = "1.16.3";
    pub const QDRANT_COLLECTION: &str = "memories";

    pub fn qdrant_enabled() -> bool {
        std::env::var("JUST_MEMORY_QDRANT")
            .map(|v| v != "false")
            .unwrap_or(true)
    }

    pub fn qdrant_port() -> u16 {
        std::env::var("JUST_MEMORY_QDRANT_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .filter(|&p| p >= 1)
            .unwrap_or(6333)
    }

    pub fn qdrant_data_dir() -> PathBuf {
        PathBuf::from(dirs::home_dir().unwrap_or_default())
            .join(".just-memory")
            .join("qdrant")
    }

    pub fn qdrant_binary() -> PathBuf {
        std::env::var("JUST_MEMORY_QDRANT_BINARY")
            .map(PathBuf::from)
            .unwrap_or_else(|_| Self::qdrant_data_dir().join("bin").join("qdrant"))
    }

    pub fn write_lock_max_concurrent() -> usize {
        std::env::var("JUST_MEMORY_MAX_WRITERS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|&w| w >= 1 && w <= 10)
            .unwrap_or(1)
    }

    // Embedding worker
    pub const EMBEDDING_WORKER_BATCH_SIZE: usize = 20;
    pub const EMBEDDING_WORKER_INTERVAL_MS: u64 = 5_000;
}

// ============================================================================
// SchemaKnowledgeConfig — M5 Phase D
// ============================================================================

pub struct SchemaKnowledgeConfig;

impl SchemaKnowledgeConfig {
    pub const MIN_EXAMPLES: usize = 3;
    pub const MAX_PER_PROJECT: usize = 50;
    pub const MIN_FREQUENCY: usize = 2;
    pub const SIMILARITY_THRESHOLD: f64 = 0.7;
    pub const DEVIATION_IMPORTANCE_BOOST: f64 = 0.15;
    pub const CONFORMITY_DECAY_FACTOR: f64 = 0.05;
}

// ============================================================================
// ResolutionConfig
// ============================================================================

pub struct ResolutionConfig;

impl ResolutionConfig {
    pub const CONFIDENCE_WEIGHT: f64 = 0.4;
    pub const RECENCY_WEIGHT: f64 = 0.3;
    pub const CREDIBILITY_WEIGHT: f64 = 0.3;

    pub const CREDIBILITY_INITIAL_SCORE: f64 = 0.5;
    pub const CREDIBILITY_CORRECT_BOOST: f64 = 0.05;
    pub const CREDIBILITY_INCORRECT_PENALTY: f64 = 0.1;
    pub const CREDIBILITY_MIN_SCORE: f64 = 0.1;
    pub const CREDIBILITY_MAX_SCORE: f64 = 1.0;
}

// ============================================================================
// HealthConfig — Memory health score
// ============================================================================

pub struct HealthConfig;

impl HealthConfig {
    pub const RETENTION_SNAPSHOTS: usize = 100;

    // Weights (sum to 1.0)
    pub const WEIGHT_GAP_COVERAGE: f64 = 0.15;
    pub const WEIGHT_CONFIDENCE: f64 = 0.15;
    pub const WEIGHT_CONTRADICTIONS: f64 = 0.15;
    pub const WEIGHT_STALENESS: f64 = 0.10;
    pub const WEIGHT_CONCEPTS: f64 = 0.15;
    pub const WEIGHT_HEBBIAN: f64 = 0.10;
    pub const WEIGHT_TEMPORAL: f64 = 0.10;
    pub const WEIGHT_PROCESSING: f64 = 0.10;
}

// ============================================================================
// BidirectionalAmemConfig
// ============================================================================

pub struct BidirectionalAmemConfig;

impl BidirectionalAmemConfig {
    pub const MAX_UPDATES: usize = 3;
    pub const MIN_SIMILARITY: f64 = 0.6;
    pub const TAG_LIMIT: usize = 20;
}

// ============================================================================
// AutoExtractConfig — M10 A10.7
// ============================================================================

pub struct AutoExtractConfig;

impl AutoExtractConfig {
    pub fn enabled() -> bool {
        std::env::var("JUST_MEMORY_AUTO_EXTRACT")
            .map(|v| v != "false")
            .unwrap_or(true)
    }

    pub const MIN_CONTENT_LENGTH: usize = 200;
    pub const MAX_EXTRACTIONS: usize = 5;
    pub const DUPLICATE_THRESHOLD: f64 = 0.90;
    pub const SKIP_TYPES: &[&str] = &["preference"];
}

// ============================================================================
// QualityScoreConfig — M10 A10.2
// ============================================================================

pub struct QualityScoreConfig;

impl QualityScoreConfig {
    pub const ACCESS_WEIGHT: f64 = 0.25;
    pub const SEARCH_HIT_WEIGHT: f64 = 0.20;
    pub const AGE_PENALTY_WEIGHT: f64 = 0.15;
    pub const AGE_PENALTY_DAYS: i64 = 30;
    pub const CONFIDENCE_WEIGHT: f64 = 0.15;
    pub const CONTRADICTION_PENALTY: f64 = 0.05;
    pub const MAX_CONTRADICTION_CAP: i64 = 10;
    pub const SEARCH_BLEND: f64 = 0.15;

    pub fn tier_bonus(tier: &str) -> f64 {
        match tier {
            "core" => 0.15,
            "established" => 0.10,
            "relevant" => 0.05,
            _ => 0.0,
        }
    }
}

// ============================================================================
// StalenessConfig — M10 A10.10
// ============================================================================

pub struct StalenessConfig;

impl StalenessConfig {
    pub const VERSION_TTL_DAYS: i64 = 180;
    pub const TEMPORAL_NOW_TTL_DAYS: i64 = 90;
    pub const URL_TTL_DAYS: i64 = 365;
    pub const IMPORTANCE_REDUCTION: f64 = 0.2;
}

// ============================================================================
// CompactionConfig — M10 A10.8
// ============================================================================

pub struct CompactionConfig;

impl CompactionConfig {
    pub const SIMILARITY_THRESHOLD: f64 = 0.88;
    pub const MIN_CLUSTER_SIZE: usize = 3;
    pub const MIN_AGE_DAYS: i64 = 7;
    pub const MAX_PER_CYCLE: usize = 10;
    pub const BATCH_SIZE: usize = 50;
}

// ============================================================================
// CodeIntelConfig — M12 A12.4
// ============================================================================

pub struct CodeIntelConfig;

impl CodeIntelConfig {
    pub const MAX_FILE_SIZE: usize = 1_000_000;
    pub const MAX_BATCH_SIZE: usize = 500;

    pub const DEFAULT_EXCLUDE: &[&str] = &[
        "node_modules", ".git", "dist", "build", ".next", "__pycache__",
        "target", "coverage", ".turbo", ".cache", ".output", "vendor",
    ];

    pub const SUPPORTED_EXTENSIONS: &[&str] = &[
        ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ];

    pub const AUTO_EMBED: bool = true;
    pub const AUTO_BRIDGE: bool = true;
    pub const MAX_GRAPH_DEPTH: usize = 5;

    // Complexity thresholds
    pub const COMPLEXITY_LOW: i64 = 5;
    pub const COMPLEXITY_MODERATE: i64 = 10;
    pub const COMPLEXITY_HIGH: i64 = 20;
    pub const COMPLEXITY_VERY_HIGH: i64 = 50;

    // Architecture pattern detection
    pub const GOD_CLASS_METHOD_THRESHOLD: usize = 20;
    pub const GOD_CLASS_DEPENDENCY_THRESHOLD: usize = 15;
    pub const COUPLING_HOTSPOT_THRESHOLD: usize = 10;
    pub const DEAD_CODE_IGNORE_ENTRY_POINTS: bool = true;
}

// ============================================================================
// DashboardConfig
// ============================================================================

pub struct DashboardConfig;

impl DashboardConfig {
    pub fn enabled() -> bool {
        std::env::var("JUST_MEMORY_DASHBOARD")
            .map(|v| v == "true")
            .unwrap_or(false)
    }

    pub fn port() -> u16 {
        std::env::var("JUST_MEMORY_DASHBOARD_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .filter(|&p| p >= 1)
            .unwrap_or(3080)
    }
}

// ============================================================================
// Config Validation
// ============================================================================

/// A configuration warning (non-fatal).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigWarning {
    pub namespace: String,
    pub field: String,
    pub message: String,
}

/// Validate configuration values at startup. Returns warnings for invalid
/// env-var overrides or out-of-range values. Does not panic.
pub fn validate_config() -> Vec<ConfigWarning> {
    let mut warnings = Vec::new();

    // Qdrant port validation
    if let Ok(raw) = std::env::var("JUST_MEMORY_QDRANT_PORT") {
        if raw.parse::<u16>().is_err() {
            warnings.push(ConfigWarning {
                namespace: "StorageConfig".into(),
                field: "QDRANT_PORT".into(),
                message: format!(
                    "Invalid JUST_MEMORY_QDRANT_PORT=\"{raw}\" (must be 1-65535). Using default 6333."
                ),
            });
        }
    }

    // Max writers validation
    if let Ok(raw) = std::env::var("JUST_MEMORY_MAX_WRITERS") {
        match raw.parse::<usize>() {
            Ok(v) if v >= 1 && v <= 10 => {}
            _ => warnings.push(ConfigWarning {
                namespace: "StorageConfig".into(),
                field: "WRITE_LOCK_MAX_CONCURRENT".into(),
                message: format!(
                    "Invalid JUST_MEMORY_MAX_WRITERS=\"{raw}\" (must be 1-10). Using default 1."
                ),
            }),
        }
    }

    // Tension weights should sum to ~1.0
    let tension_sum = TensionConfig::WEIGHT_CONTRADICTIONS
        + TensionConfig::WEIGHT_DRIFT
        + TensionConfig::WEIGHT_INSTABILITY
        + TensionConfig::WEIGHT_COHESION;
    if (tension_sum - 1.0).abs() > 0.01 {
        warnings.push(ConfigWarning {
            namespace: "TensionConfig".into(),
            field: "WEIGHT_*".into(),
            message: format!("Tension weights sum to {tension_sum:.3}, expected ~1.0."),
        });
    }

    // Health weights should sum to ~1.0
    let health_sum = HealthConfig::WEIGHT_GAP_COVERAGE
        + HealthConfig::WEIGHT_CONFIDENCE
        + HealthConfig::WEIGHT_CONTRADICTIONS
        + HealthConfig::WEIGHT_STALENESS
        + HealthConfig::WEIGHT_CONCEPTS
        + HealthConfig::WEIGHT_HEBBIAN
        + HealthConfig::WEIGHT_TEMPORAL
        + HealthConfig::WEIGHT_PROCESSING;
    if (health_sum - 1.0).abs() > 0.01 {
        warnings.push(ConfigWarning {
            namespace: "HealthConfig".into(),
            field: "WEIGHTS".into(),
            message: format!("Health weights sum to {health_sum:.3}, expected ~1.0."),
        });
    }

    // RRF weights per intent should sum to ~1.0
    let rrf_intents: &[(&str, RrfWeightVector)] = &[
        ("factual", SearchConfig::RRF_WEIGHTS_FACTUAL),
        ("temporal", SearchConfig::RRF_WEIGHTS_TEMPORAL),
        ("navigational", SearchConfig::RRF_WEIGHTS_NAVIGATIONAL),
        ("exploratory", SearchConfig::RRF_WEIGHTS_EXPLORATORY),
        ("error_debug", SearchConfig::RRF_WEIGHTS_ERROR_DEBUG),
        ("social_reasoning", SearchConfig::RRF_WEIGHTS_SOCIAL_REASONING),
    ];
    for (intent, weights) in rrf_intents {
        let sum: f64 = weights.iter().sum();
        if (sum - 1.0).abs() > 0.01 {
            warnings.push(ConfigWarning {
                namespace: "SearchConfig".into(),
                field: format!("RRF_WEIGHTS.{intent}"),
                message: format!("RRF weights for \"{intent}\" sum to {sum:.3}, expected ~1.0."),
            });
        }
    }

    // Dashboard port validation
    if let Ok(raw) = std::env::var("JUST_MEMORY_DASHBOARD_PORT") {
        if raw.parse::<u16>().is_err() {
            warnings.push(ConfigWarning {
                namespace: "DashboardConfig".into(),
                field: "PORT".into(),
                message: format!(
                    "Invalid JUST_MEMORY_DASHBOARD_PORT=\"{raw}\" (must be 1-65535). Using default 3080."
                ),
            });
        }
    }

    // AutoExtract validation
    if AutoExtractConfig::MIN_CONTENT_LENGTH < 50 {
        warnings.push(ConfigWarning {
            namespace: "AutoExtractConfig".into(),
            field: "MIN_CONTENT_LENGTH".into(),
            message: format!(
                "MIN_CONTENT_LENGTH={} is too low (min 50).",
                AutoExtractConfig::MIN_CONTENT_LENGTH
            ),
        });
    }
    if AutoExtractConfig::MAX_EXTRACTIONS < 1 || AutoExtractConfig::MAX_EXTRACTIONS > 20 {
        warnings.push(ConfigWarning {
            namespace: "AutoExtractConfig".into(),
            field: "MAX_EXTRACTIONS".into(),
            message: format!(
                "MAX_EXTRACTIONS={} is out of range (1-20).",
                AutoExtractConfig::MAX_EXTRACTIONS
            ),
        });
    }

    // Quality score blend
    if QualityScoreConfig::SEARCH_BLEND < 0.0 || QualityScoreConfig::SEARCH_BLEND > 0.5 {
        warnings.push(ConfigWarning {
            namespace: "QualityScoreConfig".into(),
            field: "SEARCH_BLEND".into(),
            message: format!(
                "SEARCH_BLEND={} is out of range (0-0.5).",
                QualityScoreConfig::SEARCH_BLEND
            ),
        });
    }

    warnings
}
