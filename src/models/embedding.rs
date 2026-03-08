//! Embedding models — Snowflake Arctic, E5-Small, E5-Large, Nomic.
//! Includes query/document prefix handling, batch embedding, and MRL truncation.
//!
//! The TypeScript version uses @huggingface/transformers pipelines with
//! fp16/quantized ONNX models. We use ort directly for ONNX inference.

use anyhow::Result;
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use super::manager::{LoadedModel, ModelId};

// ============================================================================
// Embedding Spec — matches TypeScript EmbeddingSpec / EMBEDDING_MODELS
// ============================================================================

/// Specification for an embedding model — drives prefixes, pooling, normalization.
#[derive(Debug, Clone)]
pub struct EmbeddingSpec {
    pub model_id: ModelId,
    pub dim: usize,
    /// Prefix applied to queries (e.g. "query: " for E5, "search_query: " for Arctic)
    pub query_prefix: &'static str,
    /// Prefix applied to documents (e.g. "passage: " for E5, "search_document: " for Arctic)
    pub document_prefix: &'static str,
    /// Whether to L2-normalize output embeddings
    pub normalize: bool,
    /// Pooling strategy
    pub pooling: PoolingStrategy,
    /// Maximum token sequence length
    pub max_seq_len: usize,
}

/// Pooling strategy for aggregating token-level embeddings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolingStrategy {
    /// CLS token (index 0)
    Cls,
    /// Mean of all non-padding tokens
    MeanPooling,
}

/// Get the default embedding spec for a model ID.
pub fn embedding_spec(model_id: ModelId) -> EmbeddingSpec {
    match model_id {
        ModelId::ArcticEmbedS => EmbeddingSpec {
            model_id,
            dim: 384,
            query_prefix: "Represent this sentence for searching relevant passages: ",
            document_prefix: "",
            normalize: true,
            pooling: PoolingStrategy::Cls,
            max_seq_len: 512,
        },
        ModelId::E5Small => EmbeddingSpec {
            model_id,
            dim: 384,
            query_prefix: "query: ",
            document_prefix: "passage: ",
            normalize: true,
            pooling: PoolingStrategy::MeanPooling,
            max_seq_len: 512,
        },
        ModelId::E5Large => EmbeddingSpec {
            model_id,
            dim: 1024,
            query_prefix: "query: ",
            document_prefix: "passage: ",
            normalize: true,
            pooling: PoolingStrategy::MeanPooling,
            max_seq_len: 512,
        },
        ModelId::NomicEmbedText => EmbeddingSpec {
            model_id,
            dim: 768,
            query_prefix: "search_query: ",
            document_prefix: "search_document: ",
            normalize: true,
            pooling: PoolingStrategy::MeanPooling,
            max_seq_len: 8192,
        },
        // Non-embedding models — should not be used here
        _ => EmbeddingSpec {
            model_id,
            dim: 0,
            query_prefix: "",
            document_prefix: "",
            normalize: false,
            pooling: PoolingStrategy::Cls,
            max_seq_len: 512,
        },
    }
}

// ============================================================================
// Embedding Generation
// ============================================================================

/// Convenience: embed text using the model's default spec with query prefix.
pub fn embed_text(model: &LoadedModel, text: &str) -> Result<Vec<f32>> {
    let spec = embedding_spec(model.model_id);
    embed_query(model, &spec, text)
}

/// Generate an embedding for a query string (with query prefix).
pub fn embed_query(model: &LoadedModel, spec: &EmbeddingSpec, text: &str) -> Result<Vec<f32>> {
    let prefixed = format!("{}{}", spec.query_prefix, text);
    let mut session = model.session.lock();
    embed_single(&mut session, &model.tokenizer, spec, &prefixed)
}

/// Generate an embedding for a document string (with document prefix).
pub fn embed_document(
    model: &LoadedModel,
    spec: &EmbeddingSpec,
    text: &str,
) -> Result<Vec<f32>> {
    let prefixed = format!("{}{}", spec.document_prefix, text);
    let mut session = model.session.lock();
    embed_single(&mut session, &model.tokenizer, spec, &prefixed)
}

/// Generate embeddings for a batch of texts (with given prefix).
pub fn embed_batch(
    model: &LoadedModel,
    spec: &EmbeddingSpec,
    texts: &[String],
    prefix: &str,
) -> Result<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let prefixed: Vec<String> = texts.iter().map(|t| format!("{prefix}{t}")).collect();
    let mut session = model.session.lock();
    embed_batch_raw(&mut session, &model.tokenizer, spec, &prefixed)
}

/// Truncate an embedding to a target dimension (MRL / Matryoshka).
/// Re-normalizes after truncation if the spec requires it.
pub fn truncate_mrl(embedding: &[f32], target_dim: usize, normalize: bool) -> Vec<f32> {
    let mut truncated: Vec<f32> = embedding.iter().take(target_dim).copied().collect();
    if normalize {
        l2_normalize_inplace(&mut truncated);
    }
    truncated
}

// ============================================================================
// Internal Inference
// ============================================================================

/// Helper to build ort tensors from tokenizer output and run a session.
/// Returns the raw output data and shape from the first (or named) output.
fn run_embedding_session(
    session: &mut Session,
    tokenizer: &Tokenizer,
    text: &str,
) -> Result<(Vec<usize>, Vec<f32>, Vec<u32>)> {
    let encoding = tokenizer
        .encode(text, true)
        .map_err(|e| anyhow::anyhow!("Tokenization failed: {e}"))?;

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

    // Try named outputs first, fall back to index 0
    let output_value = &outputs[0];
    let (shape, data) = output_value
        .try_extract_tensor::<f32>()
        .map_err(|e| anyhow::anyhow!("extract tensor: {e}"))?;

    let shape_vec: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
    let data_vec: Vec<f32> = data.to_vec();
    let mask_vec: Vec<u32> = encoding.get_attention_mask().to_vec();

    Ok((shape_vec, data_vec, mask_vec))
}

fn embed_single(
    session: &mut Session,
    tokenizer: &Tokenizer,
    spec: &EmbeddingSpec,
    text: &str,
) -> Result<Vec<f32>> {
    let (shape, data, mask) = run_embedding_session(session, tokenizer, text)?;

    let embedding = match spec.pooling {
        PoolingStrategy::Cls => {
            if shape.len() == 3 {
                // Shape: [batch, seq_len, hidden_size] -> take [0, 0, :]
                let hidden_size = shape[2];
                data[..hidden_size].to_vec()
            } else if shape.len() == 2 {
                // Shape: [batch, hidden_size] -> take [0, :]
                let hidden_size = shape[1];
                data[..hidden_size].to_vec()
            } else {
                anyhow::bail!("Unexpected output shape: {:?}", shape);
            }
        }
        PoolingStrategy::MeanPooling => {
            if shape.len() == 3 {
                // [batch=1, seq_len, hidden_size]
                let seq = shape[1];
                let hidden = shape[2];
                mean_pool(&data, &mask, seq, hidden)
            } else if shape.len() == 2 {
                // Already pooled: [batch=1, hidden_size]
                let hidden = shape[1];
                data[..hidden].to_vec()
            } else {
                anyhow::bail!("Unexpected output shape for mean pooling: {:?}", shape);
            }
        }
    };

    let mut result = embedding;
    if spec.normalize {
        l2_normalize_inplace(&mut result);
    }

    Ok(result)
}

fn embed_batch_raw(
    session: &mut Session,
    tokenizer: &Tokenizer,
    spec: &EmbeddingSpec,
    texts: &[String],
) -> Result<Vec<Vec<f32>>> {
    // For simplicity, process one at a time (batch=1 per call).
    // Real batching with padding can be added later for throughput.
    let mut results = Vec::with_capacity(texts.len());
    for text in texts {
        let emb = embed_single(session, tokenizer, spec, text)?;
        results.push(emb);
    }
    Ok(results)
}

// ============================================================================
// Math Utilities
// ============================================================================

/// Mean pooling over token embeddings, respecting attention mask.
fn mean_pool(data: &[f32], mask: &[u32], seq_len: usize, hidden_size: usize) -> Vec<f32> {
    let mut sum = vec![0.0f32; hidden_size];
    let mut count = 0.0f32;

    for t in 0..seq_len {
        if mask[t] > 0 {
            let offset = t * hidden_size;
            for h in 0..hidden_size {
                sum[h] += data[offset + h];
            }
            count += 1.0;
        }
    }

    if count > 0.0 {
        for h in 0..hidden_size {
            sum[h] /= count;
        }
    }

    sum
}

/// L2-normalize a vector in-place.
pub fn l2_normalize_inplace(vec: &mut [f32]) {
    let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-12 {
        for x in vec.iter_mut() {
            *x /= norm;
        }
    }
}

/// Cosine similarity between two vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a < 1e-12 || norm_b < 1e-12 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_l2_normalize() {
        let mut v = vec![3.0, 4.0];
        l2_normalize_inplace(&mut v);
        assert!((v[0] - 0.6).abs() < 1e-6);
        assert!((v[1] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn test_l2_normalize_zero() {
        let mut v = vec![0.0, 0.0, 0.0];
        l2_normalize_inplace(&mut v);
        assert_eq!(v, vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &a) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!(cosine_similarity(&a, &b).abs() < 1e-6);
    }

    #[test]
    fn test_mean_pool_basic() {
        // 2 tokens, hidden_size=3, both unmasked
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let mask = vec![1, 1];
        let result = mean_pool(&data, &mask, 2, 3);
        assert_eq!(result, vec![2.5, 3.5, 4.5]);
    }

    #[test]
    fn test_mean_pool_with_padding() {
        // 3 tokens, hidden_size=2, last one masked
        let data = vec![1.0, 2.0, 3.0, 4.0, 0.0, 0.0];
        let mask = vec![1, 1, 0];
        let result = mean_pool(&data, &mask, 3, 2);
        assert_eq!(result, vec![2.0, 3.0]);
    }

    #[test]
    fn test_truncate_mrl() {
        let emb = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let truncated = truncate_mrl(&emb, 3, false);
        assert_eq!(truncated, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_embedding_spec_arctic() {
        let spec = embedding_spec(ModelId::ArcticEmbedS);
        assert_eq!(spec.dim, 384);
        assert!(spec.query_prefix.contains("searching"));
        assert!(spec.document_prefix.is_empty());
    }
}
