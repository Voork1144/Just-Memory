/**
 * Just-Command Memory CRUD Operations
 *
 * Core operations for storing, retrieving, and managing memories.
 * Implements decisions D1-D4, D10, D15 from the spec.
 */
/**
 * Memory types
 */
export type MemoryType = 'fact' | 'event' | 'observation' | 'preference' | 'note' | 'decision';
/**
 * Memory input for storing
 */
export interface MemoryInput {
    content: string;
    type?: MemoryType;
    source?: string;
    projectId?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    importance?: number;
    decayEnabled?: boolean;
}
/**
 * Stored memory record
 */
export interface Memory {
    id: string;
    content: string;
    type: MemoryType;
    source: string | null;
    projectId: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
    importance: number;
    decayEnabled: boolean;
    lastAccessedAt: string | null;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}
/**
 * Store a new memory
 */
export declare function storeMemory(input: MemoryInput): Promise<Memory>;
/**
 * Recall a memory by ID
 */
export declare function recallMemory(id: string, updateAccess?: boolean): Memory | null;
/**
 * Update an existing memory
 */
export declare function updateMemory(id: string, updates: Partial<MemoryInput>): Promise<Memory | null>;
/**
 * Soft delete a memory (D4: recoverable)
 * If permanent is true, performs hard delete instead
 */
export declare function deleteMemory(id: string, permanent?: boolean): boolean;
/**
 * Recover a soft-deleted memory (D4)
 */
export declare function recoverMemory(id: string): Memory | null;
/**
 * Permanently delete a memory (no recovery)
 */
export declare function purgeMemory(id: string): boolean;
/**
 * List deleted memories (for recovery UI)
 * Can call with (limit) or (projectId, limit)
 */
export declare function listDeletedMemories(limitOrProjectId?: number | string, limit?: number): Memory[];
/**
 * List recent memories
 * Can call with (options) object or (limit, offset, type, projectId) args
 */
export declare function listRecentMemories(limitOrOptions?: number | {
    projectId?: string;
    type?: MemoryType;
    limit?: number;
    offset?: number;
}, offsetArg?: number, typeArg?: MemoryType, projectIdArg?: string): Memory[];
/**
 * Link input
 */
export interface MemoryLinkInput {
    memoryId: string;
    filePath?: string;
    commitHash?: string;
    url?: string;
}
/**
 * Link result
 */
export interface MemoryLink {
    id: string;
    memoryId: string;
    filePath: string | null;
    commitHash: string | null;
    url: string | null;
    createdAt: string;
}
/**
 * Link a memory to a file, commit, or URL
 */
export declare function linkMemory(input: MemoryLinkInput): MemoryLink;
/**
 * Get links for a memory
 */
export declare function getMemoryLinks(memoryId: string): MemoryLink[];
/**
 * Entity input
 */
export interface EntityInput {
    name: string;
    type: string;
    description?: string;
    properties?: Record<string, unknown>;
    projectId?: string;
}
/**
 * Entity record
 */
export interface Entity {
    id: string;
    name: string;
    type: string;
    description: string | null;
    properties: Record<string, unknown>;
    projectId: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}
/**
 * Create a knowledge graph entity
 */
export declare function createEntity(input: EntityInput): Entity;
/**
 * Get entity by ID
 */
export declare function getEntity(id: string): Entity | null;
/**
 * List entities
 */
export declare function listEntities(limit?: number, type?: string, projectId?: string): Entity[];
/**
 * Refresh context result
 */
export interface RefreshContextResult {
    totalMemories: number;
    recentMemories: number;
    highPriorityCount: number;
    suggestedContext: string;
}
/**
 * Refresh and regenerate session context
 */
export declare function refreshContext(projectId?: string, maxTokens?: number): RefreshContextResult;
//# sourceMappingURL=crud.d.ts.map