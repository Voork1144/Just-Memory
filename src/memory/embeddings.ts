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

import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js
env.cacheDir = './.cache/transformers';
env.allowLocalModels = true;
env.allowRemoteModels = true;

/**
 * Embedding model configuration
 */
export const EMBEDDING_CONFIG = {
  /** Model name on Hugging Face Hub */
  modelName: 'Xenova/all-MiniLM-L6-v2',
  /** Embedding dimensions */
  dimensions: 384,
  /** Maximum input length (tokens) */
  maxLength: 256,
} as const;

/**
 * Singleton pipeline instance
 * Using Awaited<ReturnType> for proper typing of feature-extraction pipeline
 */
let embeddingPipeline: Awaited<ReturnType<typeof pipeline>> | null = null;
let isLoading = false;
let loadError: Error | null = null;

/**
 * Initialize the embedding model
 * Call this early to warm up the model (first load downloads ~90MB)
 */
export async function initEmbeddings(): Promise<void> {
  if (embeddingPipeline || isLoading) return;
  
  isLoading = true;
  loadError = null;
  
  try {
    embeddingPipeline = await pipeline(
      'feature-extraction',
      EMBEDDING_CONFIG.modelName,
      { 
        quantized: true,  // Use quantized model for faster inference
      }
    );
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
    throw loadError;
  } finally {
    isLoading = false;
  }
}

/**
 * Check if embeddings are ready
 */
export function isEmbeddingsReady(): boolean {
  return embeddingPipeline !== null;
}

/**
 * Get embedding model status
 */
export function getEmbeddingsStatus(): {
  ready: boolean;
  loading: boolean;
  error: string | null;
  modelName: string;
  dimensions: number;
} {
  return {
    ready: embeddingPipeline !== null,
    loading: isLoading,
    error: loadError?.message ?? null,
    modelName: EMBEDDING_CONFIG.modelName,
    dimensions: EMBEDDING_CONFIG.dimensions,
  };
}

/**
 * Generate embedding for a single text
 * @param text - Text to embed (will be truncated if too long)
 * @returns Float32Array of embedding vector
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  if (!embeddingPipeline) {
    await initEmbeddings();
  }
  
  if (!embeddingPipeline) {
    throw new Error('Failed to initialize embedding model');
  }

  // Truncate text if too long (simple char-based truncation)
  const truncated = text.slice(0, EMBEDDING_CONFIG.maxLength * 4);
  
  // Generate embedding - cast to any to handle complex union types
  const output = await (embeddingPipeline as (text: string, options: object) => Promise<{ data: Float32Array }>)(
    truncated, 
    { pooling: 'mean', normalize: true }
  );
  
  // Extract the embedding array
  const embedding = output.data;
  
  // Verify dimensions
  if (embedding.length !== EMBEDDING_CONFIG.dimensions) {
    throw new Error(
      `Unexpected embedding dimensions: ${embedding.length}, expected ${EMBEDDING_CONFIG.dimensions}`
    );
  }
  
  return embedding;
}

/**
 * Generate embeddings for multiple texts (batch processing)
 * @param texts - Array of texts to embed
 * @returns Array of Float32Array embeddings
 */
export async function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  
  if (!embeddingPipeline) {
    await initEmbeddings();
  }
  
  if (!embeddingPipeline) {
    throw new Error('Failed to initialize embedding model');
  }

  // Process in batches to avoid memory issues
  const batchSize = 32;
  const results: Float32Array[] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const truncated = batch.map(t => t.slice(0, EMBEDDING_CONFIG.maxLength * 4));
    
    const outputs = await (embeddingPipeline as any)(truncated, {
      pooling: 'mean',
      normalize: true,
    }) as { data: Float32Array };
    
    // Handle single vs batch output
    if (batch.length === 1) {
      results.push(outputs.data);
    } else {
      // Batch output is a 2D array
      for (let j = 0; j < batch.length; j++) {
        const start = j * EMBEDDING_CONFIG.dimensions;
        const end = start + EMBEDDING_CONFIG.dimensions;
        results.push(new Float32Array(outputs.data.slice(start, end)));
      }
    }
  }
  
  return results;
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Embedding dimensions must match');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  
  // Embeddings are already normalized, but check anyway
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

/**
 * Convert Float32Array to Buffer for SQLite storage
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/**
 * Convert Buffer from SQLite back to Float32Array
 */
export function bufferToEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
