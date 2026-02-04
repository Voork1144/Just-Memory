"use strict";
/**
 * Just-Command Embeddings Service
 *
 * Generates embeddings for memory content using local transformer models.
 * Uses @xenova/transformers for CPU-based inference (no GPU required).
 *
 * Model: all-MiniLM-L6-v2 (384 dimensions)
 * - Fast inference (~50ms per sentence)
 * - Good semantic understanding
 * - Small model size (~90MB)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMBEDDING_CONFIG = void 0;
exports.initEmbeddings = initEmbeddings;
exports.isEmbeddingsReady = isEmbeddingsReady;
exports.getEmbeddingsStatus = getEmbeddingsStatus;
exports.generateEmbedding = generateEmbedding;
exports.generateEmbeddings = generateEmbeddings;
exports.cosineSimilarity = cosineSimilarity;
exports.embeddingToBuffer = embeddingToBuffer;
exports.bufferToEmbedding = bufferToEmbedding;
const transformers_1 = require("@xenova/transformers");
// Configure transformers.js
transformers_1.env.cacheDir = './.cache/transformers';
transformers_1.env.allowLocalModels = true;
transformers_1.env.allowRemoteModels = true;
/**
 * Embedding model configuration
 */
exports.EMBEDDING_CONFIG = {
    /** Model name on Hugging Face Hub */
    modelName: 'Xenova/all-MiniLM-L6-v2',
    /** Embedding dimensions */
    dimensions: 384,
    /** Maximum input length (tokens) */
    maxLength: 256,
};
/**
 * Singleton pipeline instance
 * Using Awaited<ReturnType> for proper typing of feature-extraction pipeline
 */
let embeddingPipeline = null;
let isLoading = false;
let loadError = null;
/**
 * Initialize the embedding model
 * Call this early to warm up the model (first load downloads ~90MB)
 */
async function initEmbeddings() {
    if (embeddingPipeline || isLoading)
        return;
    isLoading = true;
    loadError = null;
    try {
        embeddingPipeline = await (0, transformers_1.pipeline)('feature-extraction', exports.EMBEDDING_CONFIG.modelName, {
            quantized: true, // Use quantized model for faster inference
        });
    }
    catch (error) {
        loadError = error instanceof Error ? error : new Error(String(error));
        throw loadError;
    }
    finally {
        isLoading = false;
    }
}
/**
 * Check if embeddings are ready
 */
function isEmbeddingsReady() {
    return embeddingPipeline !== null;
}
/**
 * Get embedding model status
 */
function getEmbeddingsStatus() {
    return {
        ready: embeddingPipeline !== null,
        loading: isLoading,
        error: loadError?.message ?? null,
        modelName: exports.EMBEDDING_CONFIG.modelName,
        dimensions: exports.EMBEDDING_CONFIG.dimensions,
    };
}
/**
 * Generate embedding for a single text
 * @param text - Text to embed (will be truncated if too long)
 * @returns Float32Array of embedding vector
 */
async function generateEmbedding(text) {
    if (!embeddingPipeline) {
        await initEmbeddings();
    }
    if (!embeddingPipeline) {
        throw new Error('Failed to initialize embedding model');
    }
    // Truncate text if too long (simple char-based truncation)
    const truncated = text.slice(0, exports.EMBEDDING_CONFIG.maxLength * 4);
    // Generate embedding - cast to any to handle complex union types
    const output = await embeddingPipeline(truncated, { pooling: 'mean', normalize: true });
    // Extract the embedding array
    const embedding = output.data;
    // Verify dimensions
    if (embedding.length !== exports.EMBEDDING_CONFIG.dimensions) {
        throw new Error(`Unexpected embedding dimensions: ${embedding.length}, expected ${exports.EMBEDDING_CONFIG.dimensions}`);
    }
    return embedding;
}
/**
 * Generate embeddings for multiple texts (batch processing)
 * @param texts - Array of texts to embed
 * @returns Array of Float32Array embeddings
 */
async function generateEmbeddings(texts) {
    if (texts.length === 0)
        return [];
    if (!embeddingPipeline) {
        await initEmbeddings();
    }
    if (!embeddingPipeline) {
        throw new Error('Failed to initialize embedding model');
    }
    // Process in batches to avoid memory issues
    const batchSize = 32;
    const results = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const truncated = batch.map(t => t.slice(0, exports.EMBEDDING_CONFIG.maxLength * 4));
        const outputs = await embeddingPipeline(truncated, {
            pooling: 'mean',
            normalize: true,
        });
        // Handle single vs batch output
        if (batch.length === 1) {
            results.push(outputs.data);
        }
        else {
            // Batch output is a 2D array
            for (let j = 0; j < batch.length; j++) {
                const start = j * exports.EMBEDDING_CONFIG.dimensions;
                const end = start + exports.EMBEDDING_CONFIG.dimensions;
                results.push(new Float32Array(outputs.data.slice(start, end)));
            }
        }
    }
    return results;
}
/**
 * Calculate cosine similarity between two embeddings
 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error('Embedding dimensions must match');
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    // Embeddings are already normalized, but check anyway
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0)
        return 0;
    return dotProduct / magnitude;
}
/**
 * Convert Float32Array to Buffer for SQLite storage
 */
function embeddingToBuffer(embedding) {
    return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}
/**
 * Convert Buffer from SQLite back to Float32Array
 */
function bufferToEmbedding(buffer) {
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
//# sourceMappingURL=embeddings.js.map