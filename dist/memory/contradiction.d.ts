/**
 * Just-Memory Contradiction Detection
 *
 * Detects contradicting facts when storing new memories using:
 * - Semantic similarity to find related memories
 * - Negation patterns (antonyms, explicit negation)
 * - Temporal contradiction (newer facts supersede older)
 * - Entity-attribute conflicts
 *
 * Based on research from TACL 2024: "When Can LLMs Actually Correct Their Own Mistakes?"
 * Key differentiator feature for Just-Memory MCP server.
 *
 * @module contradiction
 */
import type { Memory } from './crud.js';
/** Contradiction detection result */
export interface ContradictionResult {
    /** Whether a contradiction was detected */
    hasContradiction: boolean;
    /** Confidence level of contradiction detection (0-1) */
    confidence: number;
    /** Type of contradiction found */
    contradictionType?: ContradictionType;
    /** The conflicting memory if found */
    conflictingMemory?: Memory;
    /** Explanation of the contradiction */
    explanation?: string;
    /** Suggested action */
    suggestedAction?: 'replace' | 'merge' | 'flag' | 'keep_both';
}
/** Types of contradictions */
export type ContradictionType = 'negation' | 'antonym' | 'temporal' | 'numeric' | 'entity_conflict' | 'semantic';
/** Contradiction detection options */
export interface ContradictionOptions {
    /** Minimum similarity threshold to consider (default: 0.65) */
    similarityThreshold?: number;
    /** Minimum confidence to report contradiction (default: 0.5) */
    confidenceThreshold?: number;
    /** Maximum memories to check against (default: 20) */
    maxCandidates?: number;
    /** Project context for scoping search */
    projectId?: string;
    /** Include global memories in search */
    includeGlobal?: boolean;
}
/**
 * Check if a new memory contradicts existing memories
 *
 * @param content - New memory content to check
 * @param options - Detection options
 * @returns Contradiction result with details
 */
export declare function detectContradiction(content: string, options?: ContradictionOptions): Promise<ContradictionResult>;
/** Memory candidate with similarity score */
interface MemoryCandidate {
    memory: Memory;
    similarity: number;
}
/**
 * Check for contradictions and update confidence score if found
 *
 * @param memoryId - ID of memory to check against
 * @param newContent - New content being stored
 * @returns Updated confidence score (lowered if contradiction found)
 */
export declare function checkAndAdjustConfidence(_memoryId: string, newContent: string, currentConfidence?: number): Promise<{
    confidence: number;
    contradiction?: ContradictionResult;
}>;
/**
 * Flag a memory as contradicted
 * Stores contradiction metadata in the database
 */
export declare function flagContradiction(memoryId: string, conflictingId: string, contradictionType: ContradictionType, explanation: string): Promise<void>;
/**
 * Resolve a flagged contradiction
 */
export declare function resolveContradiction(contradictionId: string, resolution: 'keep_new' | 'keep_old' | 'keep_both' | 'merge'): Promise<void>;
/**
 * Get all unresolved contradictions
 */
export declare function getUnresolvedContradictions(): Promise<Array<{
    id: string;
    memoryId: string;
    conflictingId: string;
    contradictionType: ContradictionType;
    explanation: string;
    createdAt: string;
}>>;
/**
 * Get contradiction statistics
 */
export declare function getContradictionStats(): Promise<{
    total: number;
    unresolved: number;
    byType: Record<ContradictionType, number>;
}>;
export type { MemoryCandidate };
//# sourceMappingURL=contradiction.d.ts.map