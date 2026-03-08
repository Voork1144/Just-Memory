//! Model manager — lazy loading, idle eviction, model registry.
//!
//! The TypeScript version loads transformer.js pipelines on first use and
//! evicts them after idle timeout. We replicate this with ort ONNX sessions.
//!
//! Models managed:
//! - **Embedding**: Snowflake Arctic-Embed-S (default), E5-Small, E5-Large, Nomic
//! - **Cross-Encoder**: ms-marco-MiniLM-L-6-v2 (reranking)
//! - **NLI**: DeBERTa-v3-xsmall (contradiction detection)
//! - **QA**: DistilBERT (extractive QA)
//! - **Summarization**: DistilBART-CNN-6-6 (via Ollama SLM fallback)

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use dashmap::DashMap;
use ort::session::Session;
use parking_lot::{Mutex, RwLock};
use tokenizers::Tokenizer;
use tracing::info;

// ============================================================================
// Model IDs — matches TypeScript MODEL_PATHS
// ============================================================================

/// All model identifiers the system can load.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModelId {
    /// Snowflake Arctic-Embed-S (384-dim, default embedding)
    ArcticEmbedS,
    /// BAAI/bge-small-en-v1.5 (384-dim, alternative)
    E5Small,
    /// intfloat/e5-large-v2 (1024-dim)
    E5Large,
    /// nomic-ai/nomic-embed-text-v1.5 (768-dim, MRL capable)
    NomicEmbedText,
    /// cross-encoder/ms-marco-MiniLM-L-6-v2 (reranking)
    CrossEncoder,
    /// cross-encoder/nli-deberta-v3-xsmall (NLI / contradiction)
    NliDeberta,
    /// distilbert-base-cased-distilled-squad (extractive QA)
    DistilBertQA,
}

impl ModelId {
    /// Default ONNX model filename relative to the models directory.
    pub fn default_filename(self) -> &'static str {
        match self {
            Self::ArcticEmbedS => "snowflake-arctic-embed-s/onnx/model_quantized.onnx",
            Self::E5Small => "bge-small-en-v1.5/onnx/model_quantized.onnx",
            Self::E5Large => "e5-large-v2/onnx/model_quantized.onnx",
            Self::NomicEmbedText => "nomic-embed-text-v1.5/onnx/model_quantized.onnx",
            Self::CrossEncoder => "ms-marco-MiniLM-L-6-v2/onnx/model_quantized.onnx",
            Self::NliDeberta => "nli-deberta-v3-xsmall/onnx/model_quantized.onnx",
            Self::DistilBertQA => "distilbert-base-cased-distilled-squad/onnx/model_quantized.onnx",
        }
    }

    /// Default tokenizer.json path relative to the models directory.
    pub fn tokenizer_filename(self) -> &'static str {
        match self {
            Self::ArcticEmbedS => "snowflake-arctic-embed-s/tokenizer.json",
            Self::E5Small => "bge-small-en-v1.5/tokenizer.json",
            Self::E5Large => "e5-large-v2/tokenizer.json",
            Self::NomicEmbedText => "nomic-embed-text-v1.5/tokenizer.json",
            Self::CrossEncoder => "ms-marco-MiniLM-L-6-v2/tokenizer.json",
            Self::NliDeberta => "nli-deberta-v3-xsmall/tokenizer.json",
            Self::DistilBertQA => "distilbert-base-cased-distilled-squad/tokenizer.json",
        }
    }

    /// Output embedding dimension (only meaningful for embedding models).
    pub fn embedding_dim(self) -> usize {
        match self {
            Self::ArcticEmbedS => 384,
            Self::E5Small => 384,
            Self::E5Large => 1024,
            Self::NomicEmbedText => 768,
            Self::CrossEncoder | Self::NliDeberta | Self::DistilBertQA => 0,
        }
    }

    /// Whether this model supports Matryoshka Representation Learning (MRL)
    /// for variable-dimension truncation.
    pub fn supports_mrl(self) -> bool {
        matches!(self, Self::NomicEmbedText)
    }

    /// Human-readable display name.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::ArcticEmbedS => "Snowflake Arctic-Embed-S",
            Self::E5Small => "BGE-Small-EN-v1.5",
            Self::E5Large => "E5-Large-v2",
            Self::NomicEmbedText => "Nomic-Embed-Text-v1.5",
            Self::CrossEncoder => "MS-MARCO-MiniLM-L6-v2",
            Self::NliDeberta => "NLI-DeBERTa-v3-xsmall",
            Self::DistilBertQA => "DistilBERT-QA",
        }
    }
}

// ============================================================================
// Loaded Model Handle
// ============================================================================

/// A loaded ONNX model session + its tokenizer.
///
/// The session is wrapped in a `Mutex` because ort v2 `Session::run()` requires
/// `&mut self`. This is fine for throughput since ONNX inference is inherently
/// sequential per-session (GPU/CPU exclusive).
pub struct LoadedModel {
    pub session: Mutex<Session>,
    pub tokenizer: Tokenizer,
    pub model_id: ModelId,
    last_used: RwLock<Instant>,
}

impl LoadedModel {
    /// Touch the last-used timestamp (for idle eviction tracking).
    pub fn touch(&self) {
        *self.last_used.write() = Instant::now();
    }

    /// How long since this model was last used.
    pub fn idle_duration(&self) -> Duration {
        self.last_used.read().elapsed()
    }
}

impl std::fmt::Debug for LoadedModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoadedModel")
            .field("model_id", &self.model_id)
            .field("idle_duration", &self.idle_duration())
            .finish()
    }
}

// ============================================================================
// Model Manager
// ============================================================================

/// Central model manager that lazily loads ONNX models and evicts idle ones.
///
/// Thread-safe: uses `DashMap` for concurrent access to loaded models.
pub struct ModelManager {
    /// Base directory for model files (default: ~/.just-memory/models/)
    models_dir: PathBuf,
    /// Currently loaded models, keyed by ModelId
    loaded: DashMap<ModelId, Arc<LoadedModel>>,
    /// Idle timeout before eviction (from config, default 5 minutes)
    idle_timeout: Duration,
}

impl ModelManager {
    /// Create a new model manager.
    pub fn new(models_dir: PathBuf, idle_timeout: Duration) -> Self {
        Self {
            models_dir,
            loaded: DashMap::new(),
            idle_timeout,
        }
    }

    /// Create with default paths.
    pub fn with_defaults() -> Self {
        let models_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".just-memory")
            .join("models");

        Self::new(models_dir, Duration::from_secs(300))
    }

    /// Get or load a model. Returns a shared reference.
    pub fn get_or_load(&self, model_id: ModelId) -> Result<Arc<LoadedModel>> {
        // Fast path: already loaded
        if let Some(entry) = self.loaded.get(&model_id) {
            entry.touch();
            return Ok(Arc::clone(entry.value()));
        }

        // Slow path: load from disk
        info!("Loading model: {}", model_id.display_name());
        let loaded = self.load_model(model_id)?;
        let arc = Arc::new(loaded);
        self.loaded.insert(model_id, Arc::clone(&arc));
        info!("Model loaded: {}", model_id.display_name());
        Ok(arc)
    }

    /// Evict models that have been idle longer than the timeout.
    pub fn evict_idle(&self) -> Vec<ModelId> {
        let mut evicted = Vec::new();
        self.loaded.retain(|id, model| {
            if model.idle_duration() > self.idle_timeout {
                info!(
                    "Evicting idle model: {} (idle {:?})",
                    id.display_name(),
                    model.idle_duration()
                );
                evicted.push(*id);
                false
            } else {
                true
            }
        });
        evicted
    }

    /// Explicitly unload a specific model.
    pub fn unload(&self, model_id: ModelId) -> bool {
        let removed = self.loaded.remove(&model_id).is_some();
        if removed {
            info!("Unloaded model: {}", model_id.display_name());
        }
        removed
    }

    /// Unload all models.
    pub fn unload_all(&self) {
        let count = self.loaded.len();
        self.loaded.clear();
        if count > 0 {
            info!("Unloaded all {} models", count);
        }
    }

    /// Check if a model is currently loaded.
    pub fn is_loaded(&self, model_id: ModelId) -> bool {
        self.loaded.contains_key(&model_id)
    }

    /// List currently loaded models.
    pub fn loaded_models(&self) -> Vec<ModelId> {
        self.loaded.iter().map(|e| *e.key()).collect()
    }

    /// Get the models directory path.
    pub fn models_dir(&self) -> &PathBuf {
        &self.models_dir
    }

    // ── Internal ──────────────────────────────────────────────────────────

    fn load_model(&self, model_id: ModelId) -> Result<LoadedModel> {
        let model_path = self.models_dir.join(model_id.default_filename());
        let tokenizer_path = self.models_dir.join(model_id.tokenizer_filename());

        // Verify files exist
        if !model_path.exists() {
            anyhow::bail!(
                "ONNX model file not found: {} (expected at {})",
                model_id.display_name(),
                model_path.display()
            );
        }
        if !tokenizer_path.exists() {
            anyhow::bail!(
                "Tokenizer file not found: {} (expected at {})",
                model_id.display_name(),
                tokenizer_path.display()
            );
        }

        // Load ONNX session
        let session = Session::builder()
            .map_err(|e| anyhow::anyhow!("Session builder init: {e}"))?
            .with_intra_threads(2)
            .map_err(|e| anyhow::anyhow!("Session intra_threads: {e}"))?
            .commit_from_file(&model_path)
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to load ONNX session for {}: {e}",
                    model_id.display_name()
                )
            })?;

        // Load tokenizer
        let tokenizer = Tokenizer::from_file(&tokenizer_path).map_err(|e| {
            anyhow::anyhow!(
                "Failed to load tokenizer for {}: {}",
                model_id.display_name(),
                e
            )
        })?;

        Ok(LoadedModel {
            session: Mutex::new(session),
            tokenizer,
            model_id,
            last_used: RwLock::new(Instant::now()),
        })
    }
}

impl std::fmt::Debug for ModelManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModelManager")
            .field("models_dir", &self.models_dir)
            .field("loaded_count", &self.loaded.len())
            .field("idle_timeout", &self.idle_timeout)
            .finish()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_id_properties() {
        assert_eq!(ModelId::ArcticEmbedS.embedding_dim(), 384);
        assert_eq!(ModelId::NomicEmbedText.embedding_dim(), 768);
        assert_eq!(ModelId::E5Large.embedding_dim(), 1024);
        assert!(!ModelId::ArcticEmbedS.supports_mrl());
        assert!(ModelId::NomicEmbedText.supports_mrl());
    }

    #[test]
    fn test_manager_no_models_loaded_initially() {
        let mgr = ModelManager::new(PathBuf::from("/tmp/fake-models"), Duration::from_secs(60));
        assert!(mgr.loaded_models().is_empty());
        assert!(!mgr.is_loaded(ModelId::ArcticEmbedS));
    }

    #[test]
    fn test_evict_idle_empty() {
        let mgr = ModelManager::new(PathBuf::from("/tmp/fake-models"), Duration::from_secs(0));
        let evicted = mgr.evict_idle();
        assert!(evicted.is_empty());
    }
}
