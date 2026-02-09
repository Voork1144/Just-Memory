/**
 * Just-Memory Input Validation (v4.0)
 * v4.3.5: Added type enum, range, relation_type length, scratchpad key length,
 *          task title length, backup mode whitelist validators.
 */
import { MAX_CONTENT_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_COUNT, MAX_ENTITY_NAME_LENGTH, MAX_OBSERVATIONS } from './config.js';

// ============================================================================
// Constants
// ============================================================================

/** Allowed memory types — validated at runtime, not just in JSON schema */
export const ALLOWED_MEMORY_TYPES = new Set([
  'fact', 'decision', 'preference', 'procedure', 'note', 'observation', 'event',
]);

/** Allowed backup restore modes */
export const ALLOWED_RESTORE_MODES = new Set(['merge', 'replace']);

/** Max lengths for string fields without existing limits */
export const MAX_RELATION_TYPE_LENGTH = 100;
export const MAX_SCRATCHPAD_KEY_LENGTH = 200;
export const MAX_TASK_TITLE_LENGTH = 500;

export function sanitizeLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
}

export function validateContent(content: string): void {
  if (!content || typeof content !== 'string') {
    throw new Error('Content is required and must be a string');
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }
}

export function validateTags(tags: unknown[]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.slice(0, MAX_TAGS_COUNT).map(t => String(t).slice(0, MAX_TAG_LENGTH)).filter(t => t.length > 0);
}

export function validateEntityName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Entity name is required');
  }
  if (name.length > MAX_ENTITY_NAME_LENGTH) {
    throw new Error(`Entity name exceeds maximum length of ${MAX_ENTITY_NAME_LENGTH} characters`);
  }
}

export function validateObservations(observations: unknown[]): string[] {
  if (!Array.isArray(observations)) return [];
  return observations
    .slice(0, MAX_OBSERVATIONS)
    .map(o => String(o).slice(0, MAX_CONTENT_LENGTH))
    .filter(o => o.length > 0);
}

// ============================================================================
// Memory Type Validation
// ============================================================================

/** Validate memory type against allowed enum. Returns the type or 'note' as default. */
export function validateMemoryType(type: string | undefined): string {
  if (!type) return 'note';
  if (ALLOWED_MEMORY_TYPES.has(type)) return type;
  throw new Error(`Invalid memory type: "${type}". Allowed: ${[...ALLOWED_MEMORY_TYPES].join(', ')}`);
}

// ============================================================================
// Numeric Range Validation
// ============================================================================

/** Clamp a numeric value to [0.0, 1.0]. Returns defaultValue if input is not a finite number. */
export function validateUnitRange(value: number | undefined, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'number' || !isFinite(value)) return defaultValue;
  return Math.max(0, Math.min(1, value));
}

// ============================================================================
// String Length Validators
// ============================================================================

/** Validate edge relation_type: required string, max MAX_RELATION_TYPE_LENGTH chars */
export function validateRelationType(relationType: string): string {
  if (!relationType || typeof relationType !== 'string') {
    throw new Error('Relation type is required and must be a string');
  }
  if (relationType.length > MAX_RELATION_TYPE_LENGTH) {
    throw new Error(`Relation type exceeds maximum length of ${MAX_RELATION_TYPE_LENGTH} characters`);
  }
  return relationType;
}

/** Validate scratchpad key: required string, max MAX_SCRATCHPAD_KEY_LENGTH chars */
export function validateScratchpadKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Scratchpad key is required and must be a string');
  }
  if (key.length > MAX_SCRATCHPAD_KEY_LENGTH) {
    throw new Error(`Scratchpad key exceeds maximum length of ${MAX_SCRATCHPAD_KEY_LENGTH} characters`);
  }
  return key;
}

/** Validate scheduled task title: required string, max MAX_TASK_TITLE_LENGTH chars */
export function validateTaskTitle(title: string): string {
  if (!title || typeof title !== 'string') {
    throw new Error('Task title is required and must be a string');
  }
  if (title.length > MAX_TASK_TITLE_LENGTH) {
    throw new Error(`Task title exceeds maximum length of ${MAX_TASK_TITLE_LENGTH} characters`);
  }
  return title;
}

// ============================================================================
// Backup Mode Validation
// ============================================================================

/** Validate backup restore mode against whitelist. Returns 'merge' as default. */
export function validateRestoreMode(mode: string | undefined): string {
  if (!mode) return 'merge';
  if (ALLOWED_RESTORE_MODES.has(mode)) return mode;
  throw new Error(`Invalid restore mode: "${mode}". Allowed: ${[...ALLOWED_RESTORE_MODES].join(', ')}`);
}

// ============================================================================
// Project ID Validation
// ============================================================================

/** Whitelist pattern for project IDs: lowercase alphanumeric, hyphens, underscores, max 64 chars */
const PROJECT_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

/**
 * Sanitize and validate a project ID string.
 * Returns the cleaned ID or throws if invalid after cleaning.
 */
const RESERVED_PROJECT_IDS = new Set(['global', 'system', 'admin', 'default']);

export function sanitizeProjectId(raw: string): string {
  const cleaned = raw.trim().toLowerCase();
  if (!PROJECT_ID_PATTERN.test(cleaned)) {
    throw new Error(`Invalid project ID: must match ${PROJECT_ID_PATTERN} (got "${cleaned.slice(0, 20)}")`);
  }
  if (RESERVED_PROJECT_IDS.has(cleaned)) {
    throw new Error(`Project ID "${cleaned}" is reserved`);
  }
  return cleaned;
}

/**
 * Get effective project ID, falling back to the provided default.
 * @param projectId - optional explicit project ID
 * @param fallback - the current project context to fall back to
 */
export function getEffectiveProject(projectId: string | undefined, fallback: string): string {
  if (projectId && projectId.trim()) return sanitizeProjectId(projectId);
  return fallback;
}
