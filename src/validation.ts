/**
 * Just-Memory Input Validation (v4.0)
 */
import { MAX_CONTENT_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_COUNT, MAX_ENTITY_NAME_LENGTH, MAX_OBSERVATIONS } from './config.js';

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

export function validateTags(tags: any[]): string[] {
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

export function validateObservations(observations: any[]): string[] {
  if (!Array.isArray(observations)) return [];
  return observations
    .slice(0, MAX_OBSERVATIONS)
    .map(o => String(o).slice(0, MAX_CONTENT_LENGTH))
    .filter(o => o.length > 0);
}

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
