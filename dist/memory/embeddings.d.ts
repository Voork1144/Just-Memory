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
/**
 * Embedding model configuration
 */
export declare const EMBEDDING_CONFIG: {
    /** Model name on Hugging Face Hub */
    readonly modelName: "Xenova/all-MiniLM-L6-v2";
    /** Embedding dimensions */
    readonly dimensions: 384;
    /** Maximum input length (tokens) */
    readonly maxLength: 256;
};
/**
 * Initialize the embedding model
 * Call this early to warm up the model (first load downloads ~90MB)
 */
export declare function initEmbeddings(): Promise<void>;
/**
 * Check if embeddings are ready
 */
export declare function isEmbeddingsReady(): boolean;
/**
 * Get embedding model status
 */
export declare function getEmbeddingsStatus(): {
    ready: boolean;
    loading: boolean;
    error: string | null;
    modelName: string;
    dimensions: number;
};
/**
 * Generate embedding for a single text
 * @param text - Text to embed (will be truncated if too long)
 * @returns Float32Array of embedding vector
 */
export declare function generateEmbedding(text: string): Promise<Float32Array>;
/**
 * Generate embeddings for multiple texts (batch processing)
 * @param texts - Array of texts to embed
 * @returns Array of Float32Array embeddings
 */
export declare function generateEmbeddings(texts: string[]): Promise<Float32Array[]>;
/**
 * Calculate cosine similarity between two embeddings
 */
export declare function cosineSimilarity(a: Float32Array, b: Float32Array): number;
/**
 * Convert Float32Array to Buffer for SQLite storage
 */
export declare function embeddingToBuffer(embedding: Float32Array): Buffer;
/**
 * Convert Buffer from SQLite back to Float32Array
 */
export declare function bufferToEmbedding(buffer: Buffer): Float32Array;
//# sourceMappingURL=embeddings.d.ts.map