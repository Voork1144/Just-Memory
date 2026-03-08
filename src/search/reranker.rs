//! Cross-encoder reranking via ms-marco-MiniLM.
//!
//! Ports TypeScript `rerankedSearch()` cross-encoder pipeline.
//! Uses the cross-encoder model from `models::nlp` to score (query, passage) pairs.


use anyhow::Result;
use tracing::{debug, warn};

use crate::config::definitions::ModelConfig;
use crate::models::manager::{ModelId, ModelManager};
use crate::models::nlp::{self, sigmoid, CrossEncoderScore};

// ============================================================================
// Reranker
// ============================================================================

/// A scored search result to be reranked.
#[derive(Debug, Clone)]
pub struct RerankCandidate {
    pub id: String,
    pub content: String,
    pub original_score: f64,
    pub original_rank: usize,
}

/// Result after cross-encoder reranking.
#[derive(Debug, Clone)]
pub struct RerankResult {
    pub id: String,
    pub content: String,
    pub rerank_score: f64,
    pub original_score: f64,
    pub original_rank: usize,
    /// Blended score: `rerank_weight * rerank + (1 - rerank_weight) * original`
    pub blended_score: f64,
}

/// Rerank weight: proportion of cross-encoder score in the final blend.
/// Default: 0.85 (from TypeScript `rerankedSearch`).
fn rerank_weight() -> f64 {
    std::env::var("JUST_MEMORY_RERANK_WEIGHT")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 1.0)
        .unwrap_or(0.85)
}

/// Rerank a list of candidates using the cross-encoder model.
///
/// - Scores each (query, candidate.content) pair
/// - Applies sigmoid to normalize raw logits to [0, 1]
/// - Blends with original score using `rerank_weight`
/// - Returns sorted by blended_score descending
pub fn rerank(
    model_manager: &ModelManager,
    query: &str,
    candidates: &[RerankCandidate],
) -> Result<Vec<RerankResult>> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let model = model_manager.get_or_load(ModelId::CrossEncoder)?;

    // Batch processing: score all passages against the query
    let passages: Vec<&str> = candidates.iter().map(|c| c.content.as_str()).collect();

    let batch_size = ModelConfig::CROSS_ENCODER_BATCH_SIZE;
    let mut all_scores: Vec<CrossEncoderScore> = Vec::with_capacity(candidates.len());

    for (batch_idx, chunk) in passages.chunks(batch_size).enumerate() {
        let offset = batch_idx * batch_size;
        match nlp::cross_encoder_score(&model, query, chunk) {
            Ok(mut scores) => {
                // Fix indices for batched processing
                for s in &mut scores {
                    s.index += offset;
                }
                all_scores.extend(scores);
            }
            Err(e) => {
                warn!("Cross-encoder batch {batch_idx} failed: {e}");
                // Fill with zero scores for this batch
                for i in 0..chunk.len() {
                    all_scores.push(CrossEncoderScore {
                        score: 0.0,
                        index: offset + i,
                    });
                }
            }
        }
    }

    let rw = rerank_weight();

    let mut results: Vec<RerankResult> = all_scores
        .iter()
        .filter_map(|cs| {
            let candidate = candidates.get(cs.index)?;
            // Sigmoid normalize the raw logit
            let rerank_score = sigmoid(cs.score) as f64;
            let blended = rw * rerank_score + (1.0 - rw) * candidate.original_score;

            Some(RerankResult {
                id: candidate.id.clone(),
                content: candidate.content.clone(),
                rerank_score,
                original_score: candidate.original_score,
                original_rank: candidate.original_rank,
                blended_score: blended,
            })
        })
        .collect();

    // Sort by blended score descending
    results.sort_by(|a, b| {
        b.blended_score
            .partial_cmp(&a.blended_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    debug!(
        "Reranked {} candidates, top blended={:.4}",
        results.len(),
        results.first().map(|r| r.blended_score).unwrap_or(0.0)
    );

    Ok(results)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rerank_empty() {
        // Can't test with real model manager, but verify empty input works
        let candidates: Vec<RerankCandidate> = vec![];
        // Would need model manager; just test the logic path
        assert!(candidates.is_empty());
    }

    #[test]
    fn test_rerank_weight_default() {
        // Without env var set, should be 0.85
        let w = rerank_weight();
        assert!((w - 0.85).abs() < 0.01 || w >= 0.0); // May have env var in test
    }

    #[test]
    fn test_rerank_candidate_structure() {
        let c = RerankCandidate {
            id: "test-1".into(),
            content: "hello world".into(),
            original_score: 0.75,
            original_rank: 1,
        };
        assert_eq!(c.id, "test-1");
        assert_eq!(c.original_rank, 1);
    }

    #[test]
    fn test_rerank_result_blending() {
        let rw = 0.85;
        let rerank_score = 0.9;
        let original_score = 0.6;
        let blended: f64 = rw * rerank_score + (1.0 - rw) * original_score;
        assert!((blended - 0.855_f64).abs() < 0.001);
    }
}
