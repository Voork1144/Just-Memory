/**
 * Just-Memory Models (v4.2)
 * Embedding (e5-large-v2 or e5-small-v2) and NLI (DeBERTa-v3-base) model management.
 * Model choice controlled by JUST_MEMORY_EMBEDDING env var ('small' or 'large').
 */
import { MODEL_CACHE, EMBEDDING_MODEL, EMBEDDING_DIM, NLI_MODEL, SUMMARIZATION_MODEL } from './config.js';

let embedder: any = null;
let embedderReady = false;
let nliClassifier: any = null;
let nliReady = false;
let summarizerInstance: any = null;
let summarizerReady = false;

export async function initEmbedder(): Promise<void> {
  if (embedder) return;
  const modelName = EMBEDDING_MODEL.split('/').pop() || EMBEDDING_MODEL;
  console.error(`[Just-Memory] Pre-warming embedding model (${modelName}, ${EMBEDDING_DIM}-dim)...`);
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = MODEL_CACHE;
    env.localModelPath = MODEL_CACHE;
    embedder = await pipeline('feature-extraction', EMBEDDING_MODEL, { quantized: true });
    embedderReady = true;
    console.error(`[Just-Memory] Embedding model ready (${modelName}, ${EMBEDDING_DIM}-dim)`);
  } catch (err) {
    console.error('[Just-Memory] Failed to load embedding model:', err);
    embedderReady = false;
  }
}

export async function initNLI(): Promise<void> {
  if (nliClassifier) return;
  console.error('[Just-Memory] Loading NLI model (DeBERTa-v3-base)...');
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = MODEL_CACHE;
    env.localModelPath = MODEL_CACHE;
    nliClassifier = await pipeline('zero-shot-classification', NLI_MODEL);
    nliReady = true;
    console.error('[Just-Memory] NLI model ready (DeBERTa-v3-base)');
  } catch (err) {
    console.error('[Just-Memory] Failed to load NLI model:', err);
    nliReady = false;
  }
}

export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  if (!embedderReady || !embedder) return null;
  try {
    const prefixedText = `query: ${text}`;
    const timeoutMs = 15000;
    const result = await Promise.race([
      embedder(prefixedText, { pooling: 'mean', normalize: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Embedding timeout after 15s')), timeoutMs))
    ]);
    return new Float32Array(result.data);
  } catch (err) {
    console.error('[Just-Memory] Embedding generation failed:', err);
    return null;
  }
}

export async function checkContradictionNLI(premise: string, hypothesis: string): Promise<{
  isContradiction: boolean;
  confidence: number;
  label: 'contradiction' | 'entailment' | 'neutral';
}> {
  // Lazy-load DeBERTa on first use (saves ~400MB RAM until needed)
  if (!nliReady && !nliClassifier) {
    await initNLI();
  }
  if (!nliReady || !nliClassifier) {
    return { isContradiction: false, confidence: 0, label: 'neutral' };
  }
  try {
    const timeoutMs = 10000;
    const result = await Promise.race([
      nliClassifier(premise, [hypothesis], { multi_label: false }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('NLI timeout')), timeoutMs))
    ]) as any;

    const labels = result.labels as string[];
    const scores = result.scores as number[];

    const contradictionIdx = labels.findIndex((l: string) =>
      l.toLowerCase().includes('contradict') || l.toLowerCase() === 'contradiction'
    );
    if (contradictionIdx >= 0 && scores[contradictionIdx] > 0.5) {
      return { isContradiction: true, confidence: scores[contradictionIdx], label: 'contradiction' };
    }

    const entailmentIdx = labels.findIndex((l: string) =>
      l.toLowerCase().includes('entail') || l.toLowerCase() === 'entailment'
    );
    if (entailmentIdx >= 0 && scores[entailmentIdx] > 0.7) {
      return { isContradiction: false, confidence: scores[entailmentIdx], label: 'entailment' };
    }

    return { isContradiction: false, confidence: Math.max(...scores), label: 'neutral' };
  } catch (err) {
    console.error('[Just-Memory] NLI check failed:', err);
    return { isContradiction: false, confidence: 0, label: 'neutral' };
  }
}

// ============================================================================
// Summarization (v4.2 — Lazy-loaded, distilbart-cnn-12-6)
// ============================================================================

export async function initSummarizer(): Promise<void> {
  if (summarizerInstance) return;
  const modelName = SUMMARIZATION_MODEL.split('/').pop() || SUMMARIZATION_MODEL;
  console.error(`[Just-Memory] Loading summarization model (${modelName})...`);
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = MODEL_CACHE;
    env.localModelPath = MODEL_CACHE;
    summarizerInstance = await pipeline('summarization', SUMMARIZATION_MODEL, { quantized: true });
    summarizerReady = true;
    console.error(`[Just-Memory] Summarization model ready (${modelName})`);
  } catch (err) {
    console.error('[Just-Memory] Failed to load summarization model:', err);
    summarizerReady = false;
  }
}

export async function generateSummary(text: string, options?: {
  max_length?: number; min_length?: number;
}): Promise<string | null> {
  // Lazy-load on first call
  if (!summarizerReady && !summarizerInstance) {
    await initSummarizer();
  }
  if (!summarizerReady || !summarizerInstance) return null;
  try {
    // Truncate to ~4000 chars to fit model context window
    const truncated = text.slice(0, 4000);
    const result = await Promise.race([
      summarizerInstance(truncated, {
        max_length: options?.max_length || 150,
        min_length: options?.min_length || 30,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Summarization timeout after 30s')), 30000))
    ]);
    return result[0].summary_text;
  } catch (err) {
    console.error('[Just-Memory] Summarization failed:', err);
    return null;
  }
}

export function getModelState() {
  return { embedderReady, nliReady, summarizerReady };
}

export function warmupModels(): void {
  // Only warm up the embedder at startup.
  // NLI (DeBERTa) is lazy-loaded on first contradiction check (~400MB RAM saved).
  initEmbedder();
}
