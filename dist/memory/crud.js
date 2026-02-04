"use strict";
/**
 * Just-Command Memory CRUD Operations
 *
 * Core operations for storing, retrieving, and managing memories.
 * Implements decisions D1-D4, D10, D15 from the spec.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeMemory = storeMemory;
exports.recallMemory = recallMemory;
exports.updateMemory = updateMemory;
exports.deleteMemory = deleteMemory;
exports.recoverMemory = recoverMemory;
exports.purgeMemory = purgeMemory;
exports.listDeletedMemories = listDeletedMemories;
exports.listRecentMemories = listRecentMemories;
exports.linkMemory = linkMemory;
exports.getMemoryLinks = getMemoryLinks;
exports.createEntity = createEntity;
exports.getEntity = getEntity;
exports.listEntities = listEntities;
exports.refreshContext = refreshContext;
const database_js_1 = require("./database.js");
const embeddings_js_1 = require("./embeddings.js");
const crypto = __importStar(require("crypto"));
/**
 * Generate a unique ID (hex string)
 */
function generateId() {
    return crypto.randomBytes(16).toString('hex');
}
/**
 * Store a new memory
 */
async function storeMemory(input) {
    const db = (0, database_js_1.getDatabase)();
    // Generate embedding for the content
    const embedding = await (0, embeddings_js_1.generateEmbedding)(input.content);
    const embeddingBuffer = (0, embeddings_js_1.embeddingToBuffer)(embedding);
    // Prepare tags and metadata
    const tags = JSON.stringify(input.tags ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});
    // Insert memory
    const stmt = db.prepare(`
    INSERT INTO memories (content, embedding, type, source, project_id, tags, metadata, importance, decay_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
    const row = stmt.get(input.content, embeddingBuffer, input.type ?? 'fact', input.source ?? null, input.projectId ?? null, tags, metadata, input.importance ?? 0.5, input.decayEnabled ? 1 : 0);
    return rowToMemory(row);
}
/**
 * Recall a memory by ID
 */
function recallMemory(id, updateAccess = true) {
    const db = (0, database_js_1.getDatabase)();
    const row = db.prepare(`
    SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL
  `).get(id);
    if (!row)
        return null;
    // Update access tracking if requested
    if (updateAccess) {
        db.prepare(`
      UPDATE memories 
      SET last_accessed_at = datetime('now'), 
          access_count = access_count + 1 
      WHERE id = ?
    `).run(id);
    }
    return rowToMemory(row);
}
/**
 * Update an existing memory
 */
async function updateMemory(id, updates) {
    const db = (0, database_js_1.getDatabase)();
    // Check if memory exists
    const existing = recallMemory(id, false);
    if (!existing)
        return null;
    // Build update query dynamically
    const sets = ['updated_at = datetime(\'now\')'];
    const values = [];
    if (updates.content !== undefined) {
        sets.push('content = ?');
        values.push(updates.content);
        // Re-generate embedding for new content
        const embedding = await (0, embeddings_js_1.generateEmbedding)(updates.content);
        sets.push('embedding = ?');
        values.push((0, embeddings_js_1.embeddingToBuffer)(embedding));
    }
    if (updates.type !== undefined) {
        sets.push('type = ?');
        values.push(updates.type);
    }
    if (updates.source !== undefined) {
        sets.push('source = ?');
        values.push(updates.source);
    }
    if (updates.projectId !== undefined) {
        sets.push('project_id = ?');
        values.push(updates.projectId);
    }
    if (updates.tags !== undefined) {
        sets.push('tags = ?');
        values.push(JSON.stringify(updates.tags));
    }
    if (updates.metadata !== undefined) {
        sets.push('metadata = ?');
        values.push(JSON.stringify(updates.metadata));
    }
    if (updates.importance !== undefined) {
        sets.push('importance = ?');
        values.push(updates.importance);
    }
    if (updates.decayEnabled !== undefined) {
        sets.push('decay_enabled = ?');
        values.push(updates.decayEnabled ? 1 : 0);
    }
    values.push(id);
    const stmt = db.prepare(`
    UPDATE memories SET ${sets.join(', ')} WHERE id = ? RETURNING *
  `);
    const row = stmt.get(...values);
    return rowToMemory(row);
}
/**
 * Soft delete a memory (D4: recoverable)
 * If permanent is true, performs hard delete instead
 */
function deleteMemory(id, permanent = false) {
    const db = (0, database_js_1.getDatabase)();
    if (permanent) {
        const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
        return result.changes > 0;
    }
    const result = db.prepare(`
    UPDATE memories SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL
  `).run(id);
    return result.changes > 0;
}
/**
 * Recover a soft-deleted memory (D4)
 */
function recoverMemory(id) {
    const db = (0, database_js_1.getDatabase)();
    const row = db.prepare(`
    UPDATE memories SET deleted_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NOT NULL
    RETURNING *
  `).get(id);
    return row ? rowToMemory(row) : null;
}
/**
 * Permanently delete a memory (no recovery)
 */
function purgeMemory(id) {
    const db = (0, database_js_1.getDatabase)();
    const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
}
/**
 * List deleted memories (for recovery UI)
 * Can call with (limit) or (projectId, limit)
 */
function listDeletedMemories(limitOrProjectId, limit = 50) {
    const db = (0, database_js_1.getDatabase)();
    // Handle overloaded signature
    let projectId;
    let actualLimit;
    if (typeof limitOrProjectId === 'number') {
        actualLimit = limitOrProjectId;
        projectId = undefined;
    }
    else {
        projectId = limitOrProjectId;
        actualLimit = limit;
    }
    let query = 'SELECT * FROM memories WHERE deleted_at IS NOT NULL';
    const params = [];
    if (projectId) {
        query += ' AND project_id = ?';
        params.push(projectId);
    }
    query += ' ORDER BY deleted_at DESC LIMIT ?';
    params.push(actualLimit);
    const rows = db.prepare(query).all(...params);
    return rows.map(rowToMemory);
}
/**
 * List recent memories
 * Can call with (options) object or (limit, offset, type, projectId) args
 */
function listRecentMemories(limitOrOptions, offsetArg, typeArg, projectIdArg) {
    const db = (0, database_js_1.getDatabase)();
    // Handle overloaded signature
    let projectId;
    let type;
    let limit;
    let offset;
    if (typeof limitOrOptions === 'number') {
        limit = limitOrOptions;
        offset = offsetArg ?? 0;
        type = typeArg;
        projectId = projectIdArg;
    }
    else {
        const options = limitOrOptions ?? {};
        projectId = options.projectId;
        type = options.type;
        limit = options.limit ?? 20;
        offset = options.offset ?? 0;
    }
    let query = 'SELECT * FROM memories WHERE deleted_at IS NULL';
    const params = [];
    if (projectId) {
        query += ' AND project_id = ?';
        params.push(projectId);
    }
    if (type) {
        query += ' AND type = ?';
        params.push(type);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = db.prepare(query).all(...params);
    return rows.map(rowToMemory);
}
function rowToMemory(row) {
    return {
        id: row.id,
        content: row.content,
        type: row.type,
        source: row.source,
        projectId: row.project_id,
        tags: JSON.parse(row.tags),
        metadata: JSON.parse(row.metadata),
        importance: row.importance,
        decayEnabled: row.decay_enabled === 1,
        lastAccessedAt: row.last_accessed_at,
        accessCount: row.access_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
    };
}
/**
 * Link a memory to a file, commit, or URL
 */
function linkMemory(input) {
    const db = (0, database_js_1.getDatabase)();
    // Verify memory exists
    const memory = db.prepare('SELECT id FROM memories WHERE id = ?').get(input.memoryId);
    if (!memory) {
        throw new Error(`Memory not found: ${input.memoryId}`);
    }
    if (!input.filePath && !input.commitHash && !input.url) {
        throw new Error('At least one of filePath, commitHash, or url must be provided');
    }
    const id = generateId();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(`
    INSERT INTO file_associations (id, memory_id, file_path, commit_hash, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.memoryId, input.filePath || null, input.commitHash || null, input.url || null, now);
    return {
        id,
        memoryId: input.memoryId,
        filePath: input.filePath || null,
        commitHash: input.commitHash || null,
        url: input.url || null,
        createdAt: now,
    };
}
/**
 * Get links for a memory
 */
function getMemoryLinks(memoryId) {
    const db = (0, database_js_1.getDatabase)();
    const rows = db.prepare(`
    SELECT id, memory_id, file_path, commit_hash, url, created_at
    FROM file_associations
    WHERE memory_id = ?
    ORDER BY created_at DESC
  `).all(memoryId);
    return rows.map(row => ({
        id: row.id,
        memoryId: row.memory_id,
        filePath: row.file_path,
        commitHash: row.commit_hash,
        url: row.url,
        createdAt: row.created_at,
    }));
}
/**
 * Create a knowledge graph entity
 */
function createEntity(input) {
    const db = (0, database_js_1.getDatabase)();
    const id = generateId();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(`
    INSERT INTO entities (id, name, type, description, properties, project_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.type, input.description || null, JSON.stringify(input.properties || {}), input.projectId || null, now, now);
    return {
        id,
        name: input.name,
        type: input.type,
        description: input.description || null,
        properties: input.properties || {},
        projectId: input.projectId || null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
    };
}
/**
 * Get entity by ID
 */
function getEntity(id) {
    const db = (0, database_js_1.getDatabase)();
    const row = db.prepare(`
    SELECT id, name, type, description, properties, project_id, created_at, updated_at, deleted_at
    FROM entities
    WHERE id = ? AND deleted_at IS NULL
  `).get(id);
    if (!row)
        return null;
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        description: row.description,
        properties: JSON.parse(row.properties),
        projectId: row.project_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
    };
}
/**
 * List entities
 */
function listEntities(limit = 20, type, projectId) {
    const db = (0, database_js_1.getDatabase)();
    let query = 'SELECT * FROM entities WHERE deleted_at IS NULL';
    const params = [];
    if (type) {
        query += ' AND type = ?';
        params.push(type);
    }
    if (projectId) {
        query += ' AND project_id = ?';
        params.push(projectId);
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(query).all(...params);
    return rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        description: row.description,
        properties: JSON.parse(row.properties),
        projectId: row.project_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
    }));
}
/**
 * Refresh and regenerate session context
 */
function refreshContext(projectId, maxTokens = 300) {
    const db = (0, database_js_1.getDatabase)();
    // Get counts
    let countQuery = 'SELECT COUNT(*) as total FROM memories WHERE deleted_at IS NULL';
    const params = [];
    if (projectId) {
        countQuery += ' AND project_id = ?';
        params.push(projectId);
    }
    const countRow = db.prepare(countQuery).get(...params);
    const totalMemories = countRow.total;
    // Get high priority memories (importance >= 0.7)
    let highPriorityQuery = `
    SELECT COUNT(*) as count FROM memories 
    WHERE deleted_at IS NULL AND importance >= 0.7
  `;
    if (projectId) {
        highPriorityQuery += ' AND project_id = ?';
    }
    const highPriorityRow = db.prepare(highPriorityQuery).get(...(projectId ? [projectId] : []));
    // Get recent memories for context
    const recentMemories = listRecentMemories(15, 0, undefined, projectId);
    // Build context string
    const charLimit = maxTokens * 4;
    let context = '';
    // Add high-importance memories first
    const sorted = recentMemories.sort((a, b) => b.importance - a.importance);
    for (const mem of sorted) {
        const line = `[${mem.type}] ${mem.content.slice(0, 150)}${mem.content.length > 150 ? '...' : ''}\n`;
        if (context.length + line.length > charLimit)
            break;
        context += line;
    }
    return {
        totalMemories,
        recentMemories: recentMemories.length,
        highPriorityCount: highPriorityRow.count,
        suggestedContext: context.trim(),
    };
}
//# sourceMappingURL=crud.js.map