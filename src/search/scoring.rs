//! Scoring algorithms — RRF fusion, composite scoring, recency decay,
//! quality score, MMR diversity, session context vector.
//!
//! Ports TypeScript `composite-score.ts`, `chronometer.ts` (recencyScore),
//! `quality-score.ts`, `mmr.ts`, `session-context.ts`.

use std::collections::HashMap;

use parking_lot::RwLock;

use crate::config::definitions::{
    ConfidenceConfig, DecayConfig, QualityScoreConfig, SearchConfig,
};

use super::query::QueryIntent;

// ============================================================================
// Recency Score — Exponential Decay
// ============================================================================

/// Compute recency score using exponential half-life decay.
///
/// Returns 1.0 for "just now", 0.5 at `half_life_days`, 0.25 at 2× half-life.
pub fn recency_score(date_iso: &str, half_life_days: f64) -> f64 {
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date_iso)
        .or_else(|_| {
            // Try parsing date-only as midnight UTC
            chrono::NaiveDate::parse_from_str(date_iso, "%Y-%m-%d")
                .map(|d| {
                    d.and_hms_opt(0, 0, 0)
                        .expect("midnight is always valid")
                        .and_utc()
                        .fixed_offset()
                })
        })
    else {
        return 0.0;
    };

    let now = chrono::Utc::now();
    let ms_elapsed = (now - dt.to_utc()).num_milliseconds();
    if ms_elapsed < 0 {
        return 1.0; // Future date → full score
    }
    let days_elapsed = ms_elapsed as f64 / 86_400_000.0;
    let lambda = std::f64::consts::LN_2 / half_life_days;
    (-lambda * days_elapsed).exp()
}

/// Default recency score with 30-day half-life.
pub fn recency_score_default(date_iso: &str) -> f64 {
    recency_score(date_iso, SearchConfig::TEMPORAL_DECAY_HALF_LIFE_DAYS)
}

// ============================================================================
// Retention Score — Spaced Repetition
// ============================================================================

/// Calculate retention based on last access time and memory strength.
///
/// Higher strength → slower decay. Strength range: 0-10.
pub fn calculate_retention(last_accessed: &str, strength: f64) -> f64 {
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(last_accessed)
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(last_accessed, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).expect("midnight is always valid").and_utc().fixed_offset())
        })
    else {
        return 0.5; // Default if unparseable
    };

    let hours_since = (chrono::Utc::now() - dt.to_utc()).num_seconds() as f64 / 3600.0;
    let effective_strength = strength.max(0.1); // Avoid division by zero
    (-hours_since * DecayConfig::DECAY_CONSTANT / (effective_strength * 24.0)).exp()
}

// ============================================================================
// RRF Scoring — Reciprocal Rank Fusion
// ============================================================================

/// Per-path scores for a single memory across 6 retrieval paths.
#[derive(Debug, Clone, Default)]
pub struct PathScores {
    pub keyword: f64,
    pub semantic: f64,
    pub temporal: f64,
    pub graph: f64,
    pub concept: f64,
    pub spreading: f64,
}

impl PathScores {
    /// Score for path at given index (0-5).
    pub fn get(&self, idx: usize) -> f64 {
        match idx {
            0 => self.keyword,
            1 => self.semantic,
            2 => self.temporal,
            3 => self.graph,
            4 => self.concept,
            5 => self.spreading,
            _ => 0.0,
        }
    }
}

/// Compute RRF score for a single memory given its ranks in each path.
///
/// Formula: sum(weight_i / (K + rank_i)) for i in 0..6
pub fn rrf_score(ranks: &[usize; 6], weights: &[f64; 6], k: i64) -> f64 {
    let mut score = 0.0;
    for i in 0..6 {
        score += weights[i] / (k as f64 + ranks[i] as f64);
    }
    score
}

/// Assign 1-based ranks within a path. Items with score=0 get `missing_rank`.
///
/// Returns: HashMap<memory_id, rank>
pub fn assign_ranks(
    entries: &[(String, f64)], // (id, path_score)
    missing_rank: usize,
) -> HashMap<String, usize> {
    let mut sorted: Vec<(String, f64)> = entries.to_vec();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut ranks = HashMap::with_capacity(sorted.len());
    for (i, (id, score)) in sorted.iter().enumerate() {
        let rank = if *score > 0.0 { i + 1 } else { missing_rank };
        ranks.insert(id.clone(), rank);
    }
    ranks
}

/// Normalize RRF score to 0-1 range.
pub fn normalize_rrf(rrf: f64) -> f64 {
    (rrf / SearchConfig::RRF_NORMALIZATION_FACTOR).min(1.0)
}

// ============================================================================
// Composite Scoring — Multi-Signal Weighted Fusion
// ============================================================================

/// All scoring signals for a single memory.
#[derive(Debug, Clone)]
pub struct ScoringSignals {
    pub rrf_score: f64,
    pub rerank_score: Option<f64>,
    pub recency_score: f64,
    pub importance_score: f64,
    pub confidence_score: f64,
    pub hebbian_boost: f64,
    pub retention_score: f64,
    pub processing_depth_score: Option<f64>,
    pub credibility_score: Option<f64>,
}

/// Weight profile for composite scoring.
#[derive(Debug, Clone, Copy)]
pub struct SignalWeights {
    pub rrf: f64,
    pub rerank: f64,
    pub recency: f64,
    pub importance: f64,
    pub confidence: f64,
    pub hebbian: f64,
    pub retention: f64,
    pub processing_depth: f64,
    pub credibility: f64,
}

/// Default weight profiles by intent.
pub fn default_signal_weights(intent: QueryIntent) -> SignalWeights {
    match intent {
        QueryIntent::Factual | QueryIntent::Navigational => SignalWeights {
            rrf: 0.37, rerank: 0.23, recency: 0.05, importance: 0.08,
            confidence: 0.05, hebbian: 0.05, retention: 0.05,
            processing_depth: 0.07, credibility: 0.05,
        },
        QueryIntent::Temporal => SignalWeights {
            rrf: 0.23, rerank: 0.13, recency: 0.25, importance: 0.08,
            confidence: 0.05, hebbian: 0.05, retention: 0.10,
            processing_depth: 0.06, credibility: 0.05,
        },
        QueryIntent::Exploratory => SignalWeights {
            rrf: 0.32, rerank: 0.18, recency: 0.05, importance: 0.08,
            confidence: 0.05, hebbian: 0.10, retention: 0.10,
            processing_depth: 0.07, credibility: 0.05,
        },
        QueryIntent::ErrorDebug => SignalWeights {
            rrf: 0.32, rerank: 0.18, recency: 0.15, importance: 0.08,
            confidence: 0.05, hebbian: 0.05, retention: 0.05,
            processing_depth: 0.07, credibility: 0.05,
        },
        QueryIntent::SocialReasoning => SignalWeights {
            rrf: 0.30, rerank: 0.18, recency: 0.05, importance: 0.10,
            confidence: 0.10, hebbian: 0.10, retention: 0.05,
            processing_depth: 0.07, credibility: 0.05,
        },
    }
}

/// Compute composite score from all scoring signals.
pub fn compute_composite_score(
    signals: &ScoringSignals,
    intent: QueryIntent,
    session_empty_searches: usize,
) -> f64 {
    let mut w = default_signal_weights(intent);

    // Dynamic tuning: spike recency/graph on repeated empty searches
    if session_empty_searches >= 3 {
        w.recency *= 2.0;
        w.hebbian *= 2.0;
        w.retention *= 1.5;
    }

    // Redistribute missing signals
    let has_rerank = signals.rerank_score.is_some();
    if !has_rerank {
        let rerank_w = w.rerank;
        w.rrf += rerank_w * 0.70;
        w.confidence += rerank_w * 0.15;
        w.importance += rerank_w * 0.15;
        w.rerank = 0.0;
    }

    let has_depth = signals.processing_depth_score.is_some();
    if !has_depth {
        w.importance += w.processing_depth;
        w.processing_depth = 0.0;
    }

    let has_credibility = signals.credibility_score.is_some();
    if !has_credibility {
        w.confidence += w.credibility;
        w.credibility = 0.0;
    }

    // Weighted sum with normalization
    let score = w.rrf * normalize_rrf(signals.rrf_score)
        + w.rerank * signals.rerank_score.unwrap_or(0.0)
        + w.recency * signals.recency_score
        + w.importance * signals.importance_score
        + w.confidence * signals.confidence_score
        + w.hebbian * (signals.hebbian_boost * 2.0).min(1.0) // 0-0.5 → 0-1
        + w.retention * signals.retention_score
        + w.processing_depth * signals.processing_depth_score.unwrap_or(0.0)
        + w.credibility * signals.credibility_score.unwrap_or(0.0);

    score.clamp(0.0, 1.0)
}

// ============================================================================
// Quality Score
// ============================================================================

/// Memory attributes needed for quality scoring.
pub struct QualityInput {
    pub access_count: i64,
    pub search_hit_count: i64,
    pub last_accessed: String,
    pub created_at: String,
    pub tier: String,
    pub confidence: f64,
    pub contradiction_count: i64,
}

/// Compute quality score (M10 A10.3).
pub fn calculate_quality_score(m: &QualityInput) -> f64 {
    let mut score = 0.0;

    // Access count (log-normalized)
    if m.access_count > 0 {
        let access_score = (((m.access_count + 1) as f64).log10() / 2.0).min(1.0);
        score += access_score * QualityScoreConfig::ACCESS_WEIGHT;
    }

    // Search hit count (log-normalized)
    if m.search_hit_count > 0 {
        let hit_score = (((m.search_hit_count + 1) as f64).log10() / 2.0).min(1.0);
        score += hit_score * QualityScoreConfig::SEARCH_HIT_WEIGHT;
    }

    // Age penalty for unaccessed memories
    let last = if m.last_accessed.is_empty() {
        &m.created_at
    } else {
        &m.last_accessed
    };
    let days_since = recency_days_since(last);
    if days_since > QualityScoreConfig::AGE_PENALTY_DAYS as f64 && m.access_count <= 1 {
        let age_penalty = ((days_since / 30.0 + 1.0).log10()).min(1.0);
        score -= age_penalty * QualityScoreConfig::AGE_PENALTY_WEIGHT;
    }

    // Tier bonus
    score += QualityScoreConfig::tier_bonus(&m.tier);

    // Confidence factor
    score += m.confidence * QualityScoreConfig::CONFIDENCE_WEIGHT;

    // Contradiction penalty (capped)
    let capped = m.contradiction_count.min(QualityScoreConfig::MAX_CONTRADICTION_CAP);
    let contra_penalty = (capped as f64 * 0.05).min(1.0);
    score -= contra_penalty * QualityScoreConfig::CONTRADICTION_PENALTY;

    score.clamp(0.0, 1.0)
}

/// Days since a given ISO date string.
fn recency_days_since(date_iso: &str) -> f64 {
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date_iso)
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(date_iso, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).expect("midnight is always valid").and_utc().fixed_offset())
        })
    else {
        return 365.0; // Unknown → treat as old
    };
    let ms = (chrono::Utc::now() - dt.to_utc()).num_milliseconds();
    (ms as f64 / 86_400_000.0).max(0.0)
}

// ============================================================================
// Effective Confidence
// ============================================================================

/// Memory fields needed for confidence calculation.
pub struct ConfidenceInput {
    pub confidence: f64,
    pub last_accessed: String,
    pub source_count: i64,
    pub contradiction_count: i64,
    pub importance: f64,
    pub superseded_by: Option<String>,
    pub valid_to: Option<String>,
}

/// Calculate effective confidence with time decay, source boosts, and penalties.
pub fn calculate_effective_confidence(m: &ConfidenceInput) -> f64 {
    let mut conf = m.confidence;

    // Time decay
    let days_since = recency_days_since(&m.last_accessed);
    conf -= days_since * ConfidenceConfig::PENALTY_DECAY_PER_DAY;

    // Source confirmation boost
    if m.source_count > 1 {
        conf += (m.source_count - 1) as f64 * ConfidenceConfig::BOOST_CONFIRMATION;
    }

    // Contradiction penalty (capped)
    let capped = m.contradiction_count.min(ConfidenceConfig::PENALTY_MAX_CONTRADICTION_COUNT);
    conf -= capped as f64 * ConfidenceConfig::PENALTY_CONTRADICTION;

    // High importance boost
    if m.importance > 0.7 {
        conf += ConfidenceConfig::BOOST_HIGH_IMPORTANCE;
    }

    // Superseded penalty
    if m.superseded_by.is_some() {
        conf -= 0.15;
    }

    // Expired validity penalty
    if let Some(ref valid_to) = m.valid_to {
        let now = chrono::Utc::now().to_rfc3339();
        if *valid_to < now {
            conf -= 0.25;
        }
    }

    // Floor by importance
    let floor = if m.importance >= 0.8 {
        0.4
    } else if m.importance >= 0.5 {
        0.2
    } else {
        0.1
    };

    conf.clamp(floor, 1.0)
}

// ============================================================================
// MMR — Maximal Marginal Relevance
// ============================================================================

/// Candidate for MMR selection.
pub struct MmrCandidate {
    pub id: String,
    pub score: f64,
    pub embedding: Option<Vec<f32>>,
    pub content: String,
}

/// Cosine similarity between two f32 vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;
    for i in 0..a.len() {
        let ai = a[i] as f64;
        let bi = b[i] as f64;
        dot += ai * bi;
        norm_a += ai * ai;
        norm_b += bi * bi;
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom > 0.0 { dot / denom } else { 0.0 }
}

/// Jaccard similarity between two content strings (fallback when no embeddings).
pub fn jaccard_similarity(a: &str, b: &str) -> f64 {
    let words_a: std::collections::HashSet<&str> = a
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
        .collect();
    let words_b: std::collections::HashSet<&str> = b
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
        .collect();

    let intersection = words_a.intersection(&words_b).count();
    let union = words_a.len() + words_b.len() - intersection;
    if union == 0 { 0.0 } else { intersection as f64 / union as f64 }
}

/// Apply MMR greedy selection for diversity.
///
/// `lambda`: 0.0 = pure diversity, 1.0 = pure relevance. Typical: 0.5-0.8.
pub fn apply_mmr(candidates: &[MmrCandidate], lambda: f64, target_count: usize) -> Vec<usize> {
    if candidates.is_empty() {
        return Vec::new();
    }
    if candidates.len() <= target_count {
        return (0..candidates.len()).collect();
    }

    // Normalize scores to [0, 1]
    let scores: Vec<f64> = candidates.iter().map(|c| c.score).collect();
    let min_score = scores.iter().copied().fold(f64::INFINITY, f64::min);
    let max_score = scores.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let range = max_score - min_score;

    let normalized: Vec<f64> = scores
        .iter()
        .map(|&s| if range > 0.0 { (s - min_score) / range } else { 1.0 })
        .collect();

    let mut selected: Vec<usize> = vec![0]; // Start with highest relevance
    let mut remaining: std::collections::HashSet<usize> =
        (1..candidates.len()).collect();

    while selected.len() < target_count && !remaining.is_empty() {
        let mut best_idx = None;
        let mut best_mmr = f64::NEG_INFINITY;

        for &idx in &remaining {
            let relevance = normalized[idx];

            // Max similarity to any already-selected item
            let max_sim = selected
                .iter()
                .map(|&sel_idx| {
                    match (&candidates[idx].embedding, &candidates[sel_idx].embedding) {
                        (Some(a), Some(b)) => cosine_similarity(a, b),
                        _ => jaccard_similarity(&candidates[idx].content, &candidates[sel_idx].content),
                    }
                })
                .fold(0.0f64, f64::max);

            let mmr_score = lambda * relevance - (1.0 - lambda) * max_sim;
            if mmr_score > best_mmr {
                best_mmr = mmr_score;
                best_idx = Some(idx);
            }
        }

        if let Some(idx) = best_idx {
            selected.push(idx);
            remaining.remove(&idx);
        } else {
            break;
        }
    }

    selected
}

// ============================================================================
// Session Context Vector — EMA Tracking
// ============================================================================

/// Session context vector: tracks topic drift using Exponential Moving Average.
pub struct SessionContextVector {
    current: RwLock<Option<Vec<f32>>>,
    decay_factor: f64,
    count: RwLock<usize>,
    empty_search_count: RwLock<usize>,
}

impl SessionContextVector {
    /// Create with decay factor (0.3 = conservative, 0.7 = aggressive).
    pub fn new(decay_factor: f64) -> Self {
        Self {
            current: RwLock::new(None),
            decay_factor: decay_factor.clamp(0.01, 0.99),
            count: RwLock::new(0),
            empty_search_count: RwLock::new(0),
        }
    }

    /// Create with default decay factor (0.3).
    pub fn with_defaults() -> Self {
        Self::new(0.3)
    }

    /// Update the context vector with a new embedding (EMA blend).
    pub fn update(&self, embedding: &[f32], weight: f64) {
        let alpha = self.decay_factor * weight.clamp(0.0, 1.0);
        let one_minus_alpha = 1.0 - alpha;

        let mut current = self.current.write();
        match current.as_mut() {
            None => {
                *current = Some(embedding.to_vec());
            }
            Some(vec) if vec.len() != embedding.len() => {
                *current = Some(embedding.to_vec());
            }
            Some(vec) => {
                for (v, &e) in vec.iter_mut().zip(embedding.iter()) {
                    *v = alpha as f32 * e + one_minus_alpha as f32 * *v;
                }
                // L2 normalize
                let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
                if norm > 0.0 {
                    for v in vec.iter_mut() {
                        *v /= norm;
                    }
                }
            }
        }

        *self.count.write() += 1;
    }

    /// Get cosine similarity between current context and another embedding.
    pub fn similarity(&self, other: &[f32]) -> f64 {
        let current = self.current.read();
        match current.as_ref() {
            Some(vec) => cosine_similarity(vec, other),
            None => 0.0,
        }
    }

    /// Get a copy of the current context vector.
    pub fn get_current(&self) -> Option<Vec<f32>> {
        self.current.read().clone()
    }

    /// Number of updates received.
    pub fn get_count(&self) -> usize {
        *self.count.read()
    }

    /// Record a search result count. Tracks consecutive empty searches.
    pub fn record_search(&self, result_count: usize) {
        let mut empty = self.empty_search_count.write();
        if result_count == 0 {
            *empty += 1;
        } else {
            *empty = 0;
        }
    }

    /// Number of consecutive empty searches.
    pub fn get_empty_search_count(&self) -> usize {
        *self.empty_search_count.read()
    }

    /// Reset all state.
    pub fn reset(&self) {
        *self.current.write() = None;
        *self.count.write() = 0;
        *self.empty_search_count.write() = 0;
    }
}

impl Default for SessionContextVector {
    fn default() -> Self {
        Self::with_defaults()
    }
}

impl std::fmt::Debug for SessionContextVector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionContextVector")
            .field("decay_factor", &self.decay_factor)
            .field("count", &self.get_count())
            .field("has_vector", &self.current.read().is_some())
            .finish()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::definitions::HebbianConfig;

    #[test]
    fn test_recency_score_recent() {
        let now = chrono::Utc::now().to_rfc3339();
        let score = recency_score(&now, 30.0);
        assert!((score - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_recency_score_half_life() {
        let thirty_days_ago = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
        let score = recency_score(&thirty_days_ago, 30.0);
        assert!((score - 0.5).abs() < 0.05);
    }

    #[test]
    fn test_recency_score_invalid() {
        assert_eq!(recency_score("not-a-date", 30.0), 0.0);
    }

    #[test]
    fn test_normalize_rrf() {
        assert!((normalize_rrf(0.05) - 1.0).abs() < 1e-10);
        assert!((normalize_rrf(0.025) - 0.5).abs() < 1e-10);
        assert!((normalize_rrf(0.1) - 1.0).abs() < 1e-10); // Clamped
    }

    #[test]
    fn test_rrf_score() {
        let ranks = [1, 1, 1, 1, 1, 1]; // Rank 1 in all paths
        let weights = SearchConfig::RRF_WEIGHTS_FACTUAL;
        let k = HebbianConfig::RRF_K;
        let score = rrf_score(&ranks, &weights, k);
        // Each path: w / (60 + 1) = w / 61, sum ≈ 1.0 / 61 ≈ 0.0164
        assert!(score > 0.01);
    }

    #[test]
    fn test_assign_ranks() {
        let entries = vec![
            ("a".to_string(), 0.9),
            ("b".to_string(), 0.5),
            ("c".to_string(), 0.0),
        ];
        let ranks = assign_ranks(&entries, 100);
        assert_eq!(ranks["a"], 1);
        assert_eq!(ranks["b"], 2);
        assert_eq!(ranks["c"], 100); // Missing rank
    }

    #[test]
    fn test_composite_score_basic() {
        let signals = ScoringSignals {
            rrf_score: 0.04,
            rerank_score: None,
            recency_score: 0.8,
            importance_score: 0.7,
            confidence_score: 0.9,
            hebbian_boost: 0.1,
            retention_score: 0.6,
            processing_depth_score: None,
            credibility_score: None,
        };
        let score = compute_composite_score(&signals, QueryIntent::Factual, 0);
        assert!(score > 0.0 && score <= 1.0);
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![1.0f32, 0.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0f32, 0.0];
        let b = vec![0.0f32, 1.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6);
    }

    #[test]
    fn test_jaccard_similarity() {
        let sim = jaccard_similarity(
            "the quick brown fox",
            "the lazy brown dog",
        );
        // "the" and "brown" are shared (words > 2 chars: quick, brown, fox vs lazy, brown, dog)
        // "brown" is common → 1/5 = 0.2
        assert!(sim > 0.0);
    }

    #[test]
    fn test_mmr_basic() {
        let candidates = vec![
            MmrCandidate { id: "a".into(), score: 0.9, embedding: None, content: "alpha bravo".into() },
            MmrCandidate { id: "b".into(), score: 0.8, embedding: None, content: "alpha bravo".into() },
            MmrCandidate { id: "c".into(), score: 0.7, embedding: None, content: "charlie delta".into() },
        ];
        let selected = apply_mmr(&candidates, 0.7, 2);
        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0], 0); // Highest score first
    }

    #[test]
    fn test_session_context_basic() {
        let ctx = SessionContextVector::with_defaults();
        assert!(ctx.get_current().is_none());

        let emb = vec![1.0f32, 0.0, 0.0];
        ctx.update(&emb, 1.0);
        assert!(ctx.get_current().is_some());
        assert_eq!(ctx.get_count(), 1);

        // Similarity with self should be ~1
        let sim = ctx.similarity(&emb);
        assert!((sim - 1.0).abs() < 0.1);
    }

    #[test]
    fn test_session_context_empty_search_tracking() {
        let ctx = SessionContextVector::with_defaults();
        assert_eq!(ctx.get_empty_search_count(), 0);

        ctx.record_search(0);
        ctx.record_search(0);
        assert_eq!(ctx.get_empty_search_count(), 2);

        ctx.record_search(5); // Non-empty resets counter
        assert_eq!(ctx.get_empty_search_count(), 0);
    }

    #[test]
    fn test_quality_score_basic() {
        let m = QualityInput {
            access_count: 10,
            search_hit_count: 5,
            last_accessed: chrono::Utc::now().to_rfc3339(),
            created_at: chrono::Utc::now().to_rfc3339(),
            tier: "relevant".to_string(),
            confidence: 0.8,
            contradiction_count: 0,
        };
        let score = calculate_quality_score(&m);
        assert!(score > 0.0 && score <= 1.0);
    }

    #[test]
    fn test_effective_confidence_decay() {
        let old = (chrono::Utc::now() - chrono::Duration::days(100)).to_rfc3339();
        let m = ConfidenceInput {
            confidence: 0.8,
            last_accessed: old,
            source_count: 1,
            contradiction_count: 0,
            importance: 0.5,
            superseded_by: None,
            valid_to: None,
        };
        let conf = calculate_effective_confidence(&m);
        assert!(conf < 0.8); // Should have decayed
    }
}
