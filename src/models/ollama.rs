//! Ollama SLM fallback — HTTP client for summarization and QA via local Ollama.
//!
//! The TypeScript version uses DistilBART-CNN for summarization via ONNX, but
//! encoder-decoder models are complex in ort. Instead, we provide an Ollama
//! client that hits a local SLM (e.g., llama3.2:1b, qwen2.5:1.5b) for:
//! - Memory summarization (compression)
//! - Question answering (fallback when DistilBERT confidence is low)
//! - Content classification

use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::debug;

// ============================================================================
// Configuration
// ============================================================================

/// Ollama client configuration.
#[derive(Debug, Clone)]
pub struct OllamaConfig {
    /// Base URL (default: http://localhost:11434)
    pub base_url: String,
    /// Model name (default: llama3.2:1b)
    pub model: String,
    /// Request timeout in seconds
    pub timeout_secs: u64,
    /// Maximum tokens to generate
    pub max_tokens: u32,
    /// Temperature for generation
    pub temperature: f32,
}

impl Default for OllamaConfig {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434".to_string(),
            model: "llama3.2:1b".to_string(),
            timeout_secs: 30,
            max_tokens: 256,
            temperature: 0.1,
        }
    }
}

// ============================================================================
// API Types
// ============================================================================

#[derive(Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
    options: GenerateOptions,
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f32,
    num_predict: u32,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
    done: bool,
    #[serde(default)]
    total_duration: u64,
    #[serde(default)]
    eval_count: u32,
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<ModelInfo>,
}

#[derive(Deserialize)]
struct ModelInfo {
    name: String,
    #[serde(default)]
    size: u64,
}

// ============================================================================
// Ollama Client
// ============================================================================

/// HTTP client for local Ollama SLM inference.
pub struct OllamaClient {
    client: Client,
    config: OllamaConfig,
}

impl OllamaClient {
    /// Create a new Ollama client.
    pub fn new(config: OllamaConfig) -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .context("Failed to create HTTP client for Ollama")?;

        Ok(Self { client, config })
    }

    /// Create with default configuration.
    pub fn with_defaults() -> Result<Self> {
        Self::new(OllamaConfig::default())
    }

    /// Check if Ollama is running and the configured model is available.
    pub async fn is_available(&self) -> bool {
        match self.list_models().await {
            Ok(models) => models.iter().any(|m| m.starts_with(&self.config.model.split(':').next().unwrap_or(""))),
            Err(_) => false,
        }
    }

    /// List available models.
    pub async fn list_models(&self) -> Result<Vec<String>> {
        let url = format!("{}/api/tags", self.config.base_url);
        let resp: TagsResponse = self
            .client
            .get(&url)
            .send()
            .await
            .context("Failed to connect to Ollama")?
            .json()
            .await
            .context("Failed to parse Ollama tags response")?;

        Ok(resp.models.into_iter().map(|m| m.name).collect())
    }

    /// Generate text from a prompt.
    pub async fn generate(&self, prompt: &str) -> Result<String> {
        let url = format!("{}/api/generate", self.config.base_url);

        let request = GenerateRequest {
            model: self.config.model.clone(),
            prompt: prompt.to_string(),
            stream: false,
            options: GenerateOptions {
                temperature: self.config.temperature,
                num_predict: self.config.max_tokens,
            },
        };

        let resp: GenerateResponse = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .context("Ollama generate request failed")?
            .json()
            .await
            .context("Failed to parse Ollama generate response")?;

        debug!(
            "Ollama generated {} tokens in {}ms",
            resp.eval_count,
            resp.total_duration / 1_000_000
        );

        Ok(resp.response)
    }

    /// Summarize a piece of text.
    pub async fn summarize(&self, text: &str, max_sentences: usize) -> Result<String> {
        let prompt = format!(
            "Summarize the following text in {max_sentences} sentences or fewer. \
            Be concise and preserve key information.\n\n\
            Text: {text}\n\nSummary:"
        );
        self.generate(&prompt).await
    }

    /// Answer a question given context.
    pub async fn answer_question(&self, question: &str, context: &str) -> Result<String> {
        let prompt = format!(
            "Answer the following question based only on the provided context. \
            If the answer cannot be found in the context, say \"I don't know\".\n\n\
            Context: {context}\n\n\
            Question: {question}\n\nAnswer:"
        );
        self.generate(&prompt).await
    }

    /// Classify memory type from content.
    pub async fn classify_memory_type(&self, content: &str) -> Result<String> {
        let prompt = format!(
            "Classify the following text into exactly one category: \
            fact, event, observation, preference, note, decision, procedure.\n\
            Respond with only the category name, nothing else.\n\n\
            Text: {content}\n\nCategory:"
        );
        let result = self.generate(&prompt).await?;
        Ok(result.trim().to_lowercase())
    }

    /// Get the current configuration.
    pub fn config(&self) -> &OllamaConfig {
        &self.config
    }
}

impl std::fmt::Debug for OllamaClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OllamaClient")
            .field("config", &self.config)
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
    fn test_default_config() {
        let config = OllamaConfig::default();
        assert_eq!(config.base_url, "http://localhost:11434");
        assert_eq!(config.model, "llama3.2:1b");
        assert!(config.temperature < 1.0);
    }

    #[test]
    fn test_client_creation() {
        let client = OllamaClient::with_defaults();
        assert!(client.is_ok());
    }
}
