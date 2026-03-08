//! NLP models — NLI (DeBERTa), QA (DistilBERT), Cross-Encoder (MS-MARCO).
//!
//! Each model is lazily loaded via ModelManager and provides a typed
//! inference function. The TypeScript version uses transformer.js pipelines;
//! we use ort ONNX sessions directly.

use anyhow::Result;
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use super::manager::LoadedModel;

// ============================================================================
// Cross-Encoder — Reranking (ms-marco-MiniLM-L-6-v2)
// ============================================================================

/// Result of cross-encoder scoring: relevance score for a (query, passage) pair.
#[derive(Debug, Clone)]
pub struct CrossEncoderScore {
    pub score: f32,
    pub index: usize,
}

/// Score a query against multiple passages using the cross-encoder.
/// Returns scores in the same order as the input passages.
pub fn cross_encoder_score(
    model: &LoadedModel,
    query: &str,
    passages: &[&str],
) -> Result<Vec<CrossEncoderScore>> {
    let mut results = Vec::with_capacity(passages.len());
    let mut session = model.session.lock();

    for (idx, passage) in passages.iter().enumerate() {
        let score = cross_encoder_pair(&mut session, &model.tokenizer, query, passage)?;
        results.push(CrossEncoderScore { score, index: idx });
    }

    Ok(results)
}

/// Score a single (query, passage) pair.
fn cross_encoder_pair(
    session: &mut Session,
    tokenizer: &Tokenizer,
    query: &str,
    passage: &str,
) -> Result<f32> {
    let encoding = tokenizer
        .encode((query, passage), true)
        .map_err(|e| anyhow::anyhow!("Cross-encoder tokenization failed: {e}"))?;

    let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
    let attention_mask: Vec<i64> = encoding
        .get_attention_mask()
        .iter()
        .map(|&m| m as i64)
        .collect();
    let seq_len = input_ids.len();
    let token_type_ids = vec![0i64; seq_len];

    let input_ids_tensor = Tensor::from_array(([1usize, seq_len], input_ids.into_boxed_slice()))
        .map_err(|e| anyhow::anyhow!("input_ids tensor: {e}"))?;
    let attention_mask_tensor =
        Tensor::from_array(([1usize, seq_len], attention_mask.into_boxed_slice()))
            .map_err(|e| anyhow::anyhow!("attention_mask tensor: {e}"))?;
    let token_type_ids_tensor =
        Tensor::from_array(([1usize, seq_len], token_type_ids.into_boxed_slice()))
            .map_err(|e| anyhow::anyhow!("token_type_ids tensor: {e}"))?;

    let outputs = session
        .run(ort::inputs! {
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
            "token_type_ids" => token_type_ids_tensor,
        })
        .map_err(|e| anyhow::anyhow!("session.run failed: {e}"))?;

    let logits_value = &outputs[0];
    let (_shape, logits_data) = logits_value
        .try_extract_tensor::<f32>()
        .map_err(|e| anyhow::anyhow!("extract tensor: {e}"))?;

    // Cross-encoder outputs a single logit for relevance
    Ok(logits_data[0])
}

// ============================================================================
// NLI — Natural Language Inference (DeBERTa-v3-xsmall)
// ============================================================================

/// NLI prediction labels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NliLabel {
    Entailment,
    Neutral,
    Contradiction,
}

/// Result of NLI inference.
#[derive(Debug, Clone)]
pub struct NliResult {
    pub label: NliLabel,
    pub entailment: f32,
    pub neutral: f32,
    pub contradiction: f32,
}

/// Run NLI inference on a (premise, hypothesis) pair.
/// Returns probabilities for entailment, neutral, contradiction.
pub fn nli_predict(
    model: &LoadedModel,
    premise: &str,
    hypothesis: &str,
) -> Result<NliResult> {
    let encoding = model
        .tokenizer
        .encode((premise, hypothesis), true)
        .map_err(|e| anyhow::anyhow!("NLI tokenization failed: {e}"))?;

    let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
    let attention_mask: Vec<i64> = encoding
        .get_attention_mask()
        .iter()
        .map(|&m| m as i64)
        .collect();
    let seq_len = input_ids.len();
    let token_type_ids = vec![0i64; seq_len];

    let input_ids_tensor = Tensor::from_array(([1usize, seq_len], input_ids.into_boxed_slice()))
        .map_err(|e| anyhow::anyhow!("input_ids tensor: {e}"))?;
    let attention_mask_tensor =
        Tensor::from_array(([1usize, seq_len], attention_mask.into_boxed_slice()))
            .map_err(|e| anyhow::anyhow!("attention_mask tensor: {e}"))?;
    let token_type_ids_tensor =
        Tensor::from_array(([1usize, seq_len], token_type_ids.into_boxed_slice()))
            .map_err(|e| anyhow::anyhow!("token_type_ids tensor: {e}"))?;

    let mut session = model.session.lock();
    let outputs = session
        .run(ort::inputs! {
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
            "token_type_ids" => token_type_ids_tensor,
        })
        .map_err(|e| anyhow::anyhow!("session.run failed: {e}"))?;

    let logits_value = &outputs[0];
    let (_shape, logits_data) = logits_value
        .try_extract_tensor::<f32>()
        .map_err(|e| anyhow::anyhow!("extract tensor: {e}"))?;

    // NLI models output 3 logits: [entailment, neutral, contradiction]
    // Apply softmax
    let probs = softmax3(logits_data);

    let label = if probs[0] >= probs[1] && probs[0] >= probs[2] {
        NliLabel::Entailment
    } else if probs[2] >= probs[0] && probs[2] >= probs[1] {
        NliLabel::Contradiction
    } else {
        NliLabel::Neutral
    };

    Ok(NliResult {
        label,
        entailment: probs[0],
        neutral: probs[1],
        contradiction: probs[2],
    })
}

// ============================================================================
// QA — Extractive Question Answering (DistilBERT)
// ============================================================================

/// Result of extractive QA.
#[derive(Debug, Clone)]
pub struct QaResult {
    pub answer: String,
    pub score: f32,
    pub start: usize,
    pub end: usize,
}

/// Run extractive QA: given a question and context, extract the answer span.
pub fn qa_predict(
    model: &LoadedModel,
    question: &str,
    context_text: &str,
) -> Result<QaResult> {
    let encoding = model
        .tokenizer
        .encode((question, context_text), true)
        .map_err(|e| anyhow::anyhow!("QA tokenization failed: {e}"))?;

    let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
    let attention_mask: Vec<i64> = encoding
        .get_attention_mask()
        .iter()
        .map(|&m| m as i64)
        .collect();
    let seq_len = input_ids.len();

    let input_ids_tensor = Tensor::from_array(([1usize, seq_len], input_ids.into_boxed_slice()))
        .map_err(|e| anyhow::anyhow!("input_ids tensor: {e}"))?;
    let attention_mask_tensor =
        Tensor::from_array(([1usize, seq_len], attention_mask.into_boxed_slice()))
            .map_err(|e| anyhow::anyhow!("attention_mask tensor: {e}"))?;

    let mut session = model.session.lock();
    let outputs = session
        .run(ort::inputs! {
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
        })
        .map_err(|e| anyhow::anyhow!("session.run failed: {e}"))?;

    // QA models output start_logits and end_logits
    // Try named access, fall back to positional
    let start_value = &outputs[0];
    let end_value = &outputs[1];

    let (_start_shape, start_scores) = start_value
        .try_extract_tensor::<f32>()
        .map_err(|e| anyhow::anyhow!("extract start_logits: {e}"))?;
    let (_end_shape, end_scores) = end_value
        .try_extract_tensor::<f32>()
        .map_err(|e| anyhow::anyhow!("extract end_logits: {e}"))?;

    // Find best start/end positions
    let (best_start, best_end, best_score) =
        find_best_span(start_scores, end_scores, seq_len, 128);

    // Decode the answer tokens
    let token_ids = encoding.get_ids();
    let answer_ids: Vec<u32> = token_ids[best_start..=best_end].to_vec();
    let answer = model
        .tokenizer
        .decode(&answer_ids, true)
        .map_err(|e| anyhow::anyhow!("QA answer decoding failed: {e}"))?;

    Ok(QaResult {
        answer: answer.trim().to_string(),
        score: best_score,
        start: best_start,
        end: best_end,
    })
}

/// Find the best (start, end) span given start/end logits.
fn find_best_span(
    start_scores: &[f32],
    end_scores: &[f32],
    seq_len: usize,
    max_answer_len: usize,
) -> (usize, usize, f32) {
    let mut best_score = f32::NEG_INFINITY;
    let mut best_start = 0;
    let mut best_end = 0;

    for s in 0..seq_len {
        for e in s..seq_len.min(s + max_answer_len) {
            let score = start_scores[s] + end_scores[e];
            if score > best_score {
                best_score = score;
                best_start = s;
                best_end = e;
            }
        }
    }

    (best_start, best_end, best_score)
}

// ============================================================================
// Math Utilities
// ============================================================================

/// Softmax over 3 logits.
fn softmax3(logits: &[f32]) -> [f32; 3] {
    let max = logits[0].max(logits[1]).max(logits[2]);
    let exp0 = (logits[0] - max).exp();
    let exp1 = (logits[1] - max).exp();
    let exp2 = (logits[2] - max).exp();
    let sum = exp0 + exp1 + exp2;
    [exp0 / sum, exp1 / sum, exp2 / sum]
}

/// General softmax over a slice.
pub fn softmax(logits: &[f32]) -> Vec<f32> {
    if logits.is_empty() {
        return Vec::new();
    }
    let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = logits.iter().map(|&x| (x - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    exps.into_iter().map(|e| e / sum).collect()
}

/// Sigmoid activation.
pub fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_softmax3_uniform() {
        let result = softmax3(&[0.0, 0.0, 0.0]);
        for p in &result {
            assert!((p - 1.0 / 3.0).abs() < 1e-6);
        }
    }

    #[test]
    fn test_softmax3_dominant() {
        let result = softmax3(&[10.0, 0.0, 0.0]);
        assert!(result[0] > 0.99);
        assert!(result[1] < 0.01);
    }

    #[test]
    fn test_softmax_empty() {
        assert!(softmax(&[]).is_empty());
    }

    #[test]
    fn test_softmax_sums_to_one() {
        let result = softmax(&[1.0, 2.0, 3.0, 4.0]);
        let sum: f32 = result.iter().sum();
        assert!((sum - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_sigmoid() {
        assert!((sigmoid(0.0) - 0.5).abs() < 1e-6);
        assert!(sigmoid(10.0) > 0.999);
        assert!(sigmoid(-10.0) < 0.001);
    }

    #[test]
    fn test_find_best_span() {
        let start = vec![0.0, 5.0, 1.0, 0.0];
        let end = vec![0.0, 1.0, 6.0, 0.0];
        let (s, e, _) = find_best_span(&start, &end, 4, 10);
        assert_eq!(s, 1);
        assert_eq!(e, 2);
    }

    #[test]
    fn test_nli_label_ordering() {
        assert_ne!(NliLabel::Entailment, NliLabel::Contradiction);
        assert_ne!(NliLabel::Neutral, NliLabel::Contradiction);
    }
}
