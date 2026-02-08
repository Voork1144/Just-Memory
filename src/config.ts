/**
 * Just-Memory Configuration & Constants (v4.2)
 * Extracted from monolith — all thresholds, patterns, and type definitions.
 */
import { join } from 'path';
import { homedir } from 'os';

// ============================================================================
// Limits
// ============================================================================
export const MAX_CONTENT_LENGTH = 100000;
export const MAX_TAG_LENGTH = 100;
export const MAX_TAGS_COUNT = 20;
export const MAX_ENTITY_NAME_LENGTH = 200;
export const MAX_OBSERVATIONS = 100;

// ============================================================================
// Paths
// ============================================================================
export const BACKUP_DIR = join(homedir(), '.just-memory', 'backups');
export const MODEL_CACHE = join(homedir(), '.just-memory', 'models');
export const DB_DIR = join(homedir(), '.just-memory');
export const DB_PATH = join(DB_DIR, 'memories.db');

// ============================================================================
// Embedding Config
// ============================================================================
export const EMBEDDING_MODEL_LARGE = 'Xenova/e5-large-v2';
export const EMBEDDING_DIM_LARGE = 1024;
export const EMBEDDING_MODEL_SMALL = 'Xenova/e5-small-v2';
export const EMBEDDING_DIM_SMALL = 384;

// Active model: set via JUST_MEMORY_EMBEDDING env var ('small' or 'large')
const embeddingChoice = (process.env.JUST_MEMORY_EMBEDDING || 'large').toLowerCase();
export const EMBEDDING_MODEL = embeddingChoice === 'small' ? EMBEDDING_MODEL_SMALL : EMBEDDING_MODEL_LARGE;
export const EMBEDDING_DIM = embeddingChoice === 'small' ? EMBEDDING_DIM_SMALL : EMBEDDING_DIM_LARGE;

export const NLI_MODEL = 'Xenova/nli-deberta-v3-base';
export const SUMMARIZATION_MODEL = process.env.JUST_MEMORY_SUMMARIZER || 'Xenova/distilbart-cnn-12-6';
export const _EMBEDDING_DIM_OLD = 384; // all-MiniLM-L6-v2 (reserved for migration)

// ============================================================================
// Projects
// ============================================================================
export const GLOBAL_PROJECT = 'global';

// ============================================================================
// Confidence Thresholds
// ============================================================================
export const CONFIDENCE_LEVELS = {
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.3,
  UNCERTAIN: 0.0
};
export const CONFIDENCE_BOOST = {
  CONFIRMATION: 0.15,
  RECENT_ACCESS: 0.05,
  HIGH_IMPORTANCE: 0.1,
};
export const CONFIDENCE_PENALTY = {
  CONTRADICTION: 0.05,
  DECAY_PER_DAY: 0.001,  // v4.2: reduced from 0.002 (60-day loss: 0.06 instead of 0.12)
  MAX_CONTRADICTION_COUNT: 3,  // v4.2: cap penalty impact
};

// ============================================================================
// Contradiction Detection
// ============================================================================
export const CONTRADICTION_CONFIG = {
  SEMANTIC_SIMILARITY_THRESHOLD: 0.75,
  FACTUAL_SIMILARITY_THRESHOLD: 0.85,
  NLI_SIMILARITY_THRESHOLD: 0.85, // v3.13: raised from 0.7
  NLI_CONFIDENCE_THRESHOLD: 0.85,
  PENALTY: {
    SEMANTIC: 0.05,
    FACTUAL: 0.10,
    TEMPORAL: 0.05,
    NEGATION: 0.08,
    NLI: 0.08,
    ANTONYM: 0.05,
  },
  MAX_RESULTS: 10,
};

// ============================================================================
// Negation Patterns
// ============================================================================
export const NEGATION_PATTERNS = {
  EXPLICIT: ['not', "n't", "don't", "doesn't", "isn't", "aren't", "won't", "can't", "never", 'no', 'none', 'neither', 'nor'],
  IMPLICIT: ['impossible', 'false', 'incorrect', 'untrue'],
  ANTONYMS: [
    ['true', 'false'], ['yes', 'no'], ['good', 'bad'], ['right', 'wrong'],
    ['love', 'hate'], ['like', 'dislike'],
    ['hot', 'cold'], ['fast', 'slow'], ['big', 'small'], ['large', 'small'],
    ['high', 'low'], ['young', 'old'], ['alive', 'dead'],
    ['success', 'failure'], ['win', 'lose'], ['increase', 'decrease'],
    ['accept', 'reject'], ['agree', 'disagree'], ['allow', 'forbid'],
    ['always', 'never'], ['buy', 'sell'],
    ['create', 'destroy'], ['early', 'late'], ['easy', 'hard'],
    ['empty', 'full'], ['enter', 'exit'],
    ['happy', 'sad'], ['include', 'exclude'],
    ['possible', 'impossible'],
    ['present', 'absent'],
    ['remember', 'forget'],
    ['safe', 'dangerous'], ['same', 'different'], ['strong', 'weak'],
  ],
};

// ============================================================================
// Factual Claim Patterns
// ============================================================================
export const FACTUAL_PATTERNS = [
  /^(.+?)\s+(?:is|are|was|were)\s+(?:a|an|the)?\s*(.+)$/i,
  /^(.+?)\s+(?:has|have|had)\s+(?:a|an|the)?\s*(.+)$/i,
  /^(.+?)\s*(?:=|equals?)\s*(.+)$/i,
  /^(?:the\s+)?(\w+)\s+(?:of|for)\s+(.+?)\s+(?:is|was|are|were)\s+(.+)$/i,
  /^(.+?)\s+(?:lives?|resides?|works?|stays?)\s+(?:in|at)\s+(.+)$/i,
  /^(.+?)\s+(?:was\s+born|born|died|started|ended)\s+(?:in|on|at)\s+(.+)$/i,
  /^(.+?)\s+(?:costs?|weighs?|measures?|contains?)\s+(.+)$/i,
];

// ============================================================================
// Types
// ============================================================================
export interface ContradictionResult {
  id: string;
  content: string;
  contradictionType: 'semantic' | 'factual' | 'negation' | 'temporal' | 'antonym' | 'nli';
  confidence: number;
  similarity: number;
  explanation: string;
  suggestedAction: 'review' | 'resolve' | 'ignore';
}

export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  raw: string;
}

// ============================================================================
// Decay
// ============================================================================
export const DECAY_CONSTANT = 0.5;

// ============================================================================
// Qdrant Config
// ============================================================================
export const QDRANT_ENABLED = process.env.JUST_MEMORY_QDRANT !== 'false';
export const QDRANT_PORT = parseInt(process.env.JUST_MEMORY_QDRANT_PORT || '6333', 10);
export const QDRANT_DATA_DIR = join(homedir(), '.just-memory', 'qdrant');
export const QDRANT_BINARY = process.env.JUST_MEMORY_QDRANT_BINARY || join(QDRANT_DATA_DIR, 'bin', 'qdrant');
export const QDRANT_COLLECTION = 'memories';

// ============================================================================
// Concurrency Config
// ============================================================================
export const WRITE_LOCK_MAX_CONCURRENT = parseInt(process.env.JUST_MEMORY_MAX_WRITERS || '1', 10);

// ============================================================================
// Embedding Worker Config
// ============================================================================
export const EMBEDDING_WORKER_BATCH_SIZE = 20;
export const EMBEDDING_WORKER_INTERVAL_MS = 5000; // 5 seconds between batches

// ============================================================================
// Consolidation
// ============================================================================
export const CONSOLIDATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
export const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of inactivity

// ============================================================================
// Tool Logging
// ============================================================================
export const TOOL_LOG_MAX_OUTPUT = 2048;
export const TOOL_LOG_EXCLUDED = ['memory_stats', 'memory_tool_history'];

// ============================================================================
// Helper
// ============================================================================
export function safeParse<T>(json: string | null | undefined, defaultValue: T): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    console.error('[Just-Memory] JSON parse error:', err);
    return defaultValue;
  }
}
