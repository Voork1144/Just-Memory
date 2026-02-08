/**
 * Just-Memory Entities, Edges, Scratchpad, Entity Types (v4.0)
 * Knowledge graph entities, temporal edges, working-memory scratchpad.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { safeParse } from './config.js';
import { validateEntityName, validateObservations, sanitizeLikePattern } from './validation.js';

// ============================================================================
// Edge Functions
// ============================================================================

export function createEdge(
  db: Database.Database,
  fromId: string,
  toId: string,
  relationType: string,
  confidence = 1.0,
  metadata = {},
  projectId: string
) {
  const id = randomUUID().replace(/-/g, '');
  db.prepare(`INSERT INTO edges (id, project_id, from_id, to_id, relation_type, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, fromId, toId, relationType, confidence, JSON.stringify(metadata));
  return { id, project_id: projectId, from_id: fromId, to_id: toId, relation_type: relationType, confidence };
}

export function queryEdges(db: Database.Database, memoryId: string, direction = 'both', projectId: string, includeInvalidated = false) {
  let sql = 'SELECT * FROM edges WHERE (project_id = ? OR project_id = \'global\')';
  const params: any[] = [projectId];

  if (!includeInvalidated) {
    sql += ' AND valid_to IS NULL';
  }

  if (direction === 'outgoing') {
    sql += ' AND from_id = ?';
    params.push(memoryId);
  } else if (direction === 'incoming') {
    sql += ' AND to_id = ?';
    params.push(memoryId);
  } else {
    sql += ' AND (from_id = ? OR to_id = ?)';
    params.push(memoryId, memoryId);
  }

  const edges = db.prepare(sql).all(...params) as any[];
  return edges.map(e => ({
    ...e,
    metadata: safeParse(e.metadata, {}),
  }));
}

export function invalidateEdge(db: Database.Database, edgeId: string) {
  db.prepare("UPDATE edges SET valid_to = datetime('now') WHERE id = ?").run(edgeId);
  return { id: edgeId, invalidated: true };
}

// ============================================================================
// Scratchpad Functions
// ============================================================================

export function scratchSet(db: Database.Database, key: string, value: string, ttlSeconds?: number, projectId?: string) {
  const project = projectId || 'global';
  const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;

  db.prepare(`
    INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at) VALUES (?, ?, ?, ?)
  `).run(key, project, value, expiresAt);

  return { key, project_id: project, stored: true, expiresAt };
}

export function scratchGet(db: Database.Database, key: string, projectId: string) {
  const row = db.prepare(`
    SELECT * FROM scratchpad
    WHERE key = ? AND (project_id = ? OR project_id = 'global')
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(key, projectId, projectId) as any;

  if (!row) return { key, value: null };
  return { key, value: row.value, expiresAt: row.expires_at, createdAt: row.created_at };
}

export function scratchDelete(db: Database.Database, key: string, projectId: string) {
  db.prepare('DELETE FROM scratchpad WHERE key = ? AND project_id = ?').run(key, projectId);
  return { key, deleted: true };
}

export function scratchList(db: Database.Database, projectId: string) {
  const rows = db.prepare(`
    SELECT key, expires_at, created_at FROM scratchpad
    WHERE (project_id = ? OR project_id = 'global')
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    AND key NOT LIKE '__system_%'
    AND key NOT LIKE '_jm_%'
    ORDER BY created_at DESC
  `).all(projectId) as any[];

  return { project_id: projectId, keys: rows };
}

export function scratchClear(db: Database.Database, projectId: string) {
  const result = db.prepare("DELETE FROM scratchpad WHERE project_id = ? AND key NOT LIKE '_jm_%'").run(projectId);
  return { project_id: projectId, cleared: result.changes };
}

// ============================================================================
// Entity Functions
// ============================================================================

export function createEntity(
  db: Database.Database,
  name: string,
  entityType = 'concept',
  observations: string[] = [],
  projectId: string
) {
  validateEntityName(name);
  const validObs = validateObservations(observations);
  const id = randomUUID().replace(/-/g, '');

  try {
    db.prepare(`INSERT INTO entities (id, project_id, name, entity_type, observations) VALUES (?, ?, ?, ?, ?)`)
      .run(id, projectId, name, entityType, JSON.stringify(validObs));
    return { id, project_id: projectId, name, entityType, observations: validObs, created: true };
  } catch (err: any) {
    if (err.message.includes('UNIQUE')) {
      const existing = db.prepare('SELECT * FROM entities WHERE project_id = ? AND name = ?').get(projectId, name) as any;
      const existingObs = safeParse(existing.observations, []);
      const mergedObs = [...new Set([...existingObs, ...validObs])];

      db.prepare(`UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(JSON.stringify(mergedObs), existing.id);

      return { id: existing.id, project_id: projectId, name, entityType: existing.entity_type, observations: mergedObs, merged: true };
    }
    throw err;
  }
}

export function getEntity(db: Database.Database, name: string, projectId: string) {
  const entity = db.prepare(`
    SELECT * FROM entities WHERE name = ? AND (project_id = ? OR project_id = 'global')
    ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(name, projectId, projectId) as any;

  if (!entity) return { error: 'Entity not found', name };

  const relations = db.prepare(`
    SELECT * FROM entity_relations
    WHERE (from_entity = ? OR to_entity = ?) AND (project_id = ? OR project_id = 'global')
  `).all(entity.name, entity.name, projectId) as any[];

  const allObs: string[] = safeParse(entity.observations, []);
  return {
    id: entity.id,
    project_id: entity.project_id,
    name: entity.name,
    entityType: entity.entity_type,
    observation_count: allObs.length,
    observations: allObs.slice(-10).map(
      (o: string) => o.length > 200 ? o.slice(0, 200) + '...' : o
    ),
    relations: relations.map(r => ({
      from: r.from_entity,
      to: r.to_entity,
      type: r.relation_type,
    })),
  };
}

export function linkEntities(
  db: Database.Database,
  from: string,
  relationType: string,
  to: string,
  projectId: string
) {
  const id = randomUUID().replace(/-/g, '');

  try {
    db.prepare(`INSERT INTO entity_relations (id, project_id, from_entity, to_entity, relation_type) VALUES (?, ?, ?, ?, ?)`)
      .run(id, projectId, from, to, relationType);
    return { id, project_id: projectId, from, relationType, to, linked: true };
  } catch (err: any) {
    if (err.message.includes('UNIQUE')) {
      return { from, relationType, to, alreadyExists: true };
    }
    throw err;
  }
}

export function searchEntities(
  db: Database.Database,
  query: string,
  entityType?: string,
  projectId?: string,
  limit = 20
) {
  const project = projectId || 'global';
  let sql = `
    SELECT * FROM entities
    WHERE (project_id = ? OR project_id = 'global')
  `;
  const params: any[] = [project];

  if (query) {
    sql += ` AND (name LIKE ? OR observations LIKE ?)`;
    params.push(`%${sanitizeLikePattern(query)}%`, `%${sanitizeLikePattern(query)}%`);
  }

  if (entityType) {
    sql += ` AND entity_type = ?`;
    params.push(entityType);
  }

  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);

  const entities = db.prepare(sql).all(...params) as any[];

  return entities.map(e => {
    const allObs: string[] = safeParse(e.observations, []);
    return {
      id: e.id,
      project_id: e.project_id,
      name: e.name,
      entityType: e.entity_type,
      observation_count: allObs.length,
      observations: allObs.slice(-5).map(
        (o: string) => o.length > 150 ? o.slice(0, 150) + '...' : o
      ),
    };
  });
}

/**
 * Get entities for briefing with truncated observations to save tokens.
 * Returns at most 3 observations per entity, each truncated to 150 chars.
 */
export function getBriefingEntities(
  db: Database.Database,
  projectId: string,
  limit = 10
) {
  const project = projectId || 'global';
  const entities = db.prepare(`
    SELECT * FROM entities
    WHERE (project_id = ? OR project_id = 'global')
    ORDER BY updated_at DESC LIMIT ?
  `).all(project, limit) as any[];

  return entities.map(e => {
    const allObs: string[] = safeParse(e.observations, []);
    // Take last 3 observations (most recent) and truncate each
    const trimmedObs = allObs.slice(-3).map(
      (o: string) => o.length > 150 ? o.slice(0, 150) + '...' : o
    );
    return {
      name: e.name,
      entityType: e.entity_type,
      observation_count: allObs.length,
      observations: trimmedObs,
    };
  });
}

export function observeEntity(db: Database.Database, name: string, observations: string[], projectId: string) {
  const entity = db.prepare(`
    SELECT * FROM entities WHERE name = ? AND (project_id = ? OR project_id = 'global')
    ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(name, projectId, projectId) as any;

  if (!entity) return { error: 'Entity not found', name };

  const existingObs = safeParse(entity.observations, []);
  const newObs = validateObservations(observations);
  const mergedObs = [...new Set([...existingObs, ...newObs])];

  db.prepare(`UPDATE entities SET observations = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(mergedObs), entity.id);

  return { id: entity.id, name, added: newObs.length, total_observations: mergedObs.length };
}

export function deleteEntity(db: Database.Database, name: string, projectId: string) {
  const entity = db.prepare('SELECT * FROM entities WHERE name = ? AND project_id = ?').get(name, projectId) as any;

  if (!entity) return { error: 'Entity not found', name };

  db.prepare('DELETE FROM entity_relations WHERE (from_entity = ? OR to_entity = ?) AND project_id = ?').run(name, name, projectId);
  db.prepare('DELETE FROM entities WHERE id = ?').run(entity.id);

  return { name, deleted: true };
}

// ============================================================================
// Entity Type Hierarchy
// ============================================================================

export function getTypeAncestors(db: Database.Database, typeName: string): string[] {
  const ancestors: string[] = [];
  let current = typeName;
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current)) break;
    visited.add(current);

    const type = db.prepare('SELECT parent_type FROM entity_types WHERE name = ?').get(current) as any;
    if (type?.parent_type) {
      ancestors.push(type.parent_type);
      current = type.parent_type;
    } else {
      break;
    }
  }

  return ancestors;
}

export function getTypeDescendants(db: Database.Database, typeName: string): string[] {
  const descendants: string[] = [];
  const queue = [typeName];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const children = db.prepare('SELECT name FROM entity_types WHERE parent_type = ?').all(current) as any[];
    for (const child of children) {
      descendants.push(child.name);
      queue.push(child.name);
    }
  }

  return descendants;
}

export function defineEntityType(db: Database.Database, name: string, parentType?: string, description?: string) {
  if (!name || typeof name !== 'string') {
    throw new Error('Entity type name is required');
  }

  const normalizedName = name.toLowerCase().replace(/\s+/g, '_');

  if (parentType) {
    const parent = db.prepare('SELECT name FROM entity_types WHERE name = ?').get(parentType);
    if (!parent) {
      return { error: `Parent type '${parentType}' does not exist`, name: normalizedName };
    }
    const ancestors = getTypeAncestors(db, parentType);
    if (ancestors.includes(normalizedName)) {
      return { error: `Circular inheritance detected` };
    }
  }

  try {
    db.prepare('INSERT INTO entity_types (name, parent_type, description) VALUES (?, ?, ?)')
      .run(normalizedName, parentType || null, description || null);
    return { name: normalizedName, parentType: parentType || null, description, created: true };
  } catch (err: any) {
    if (err.message.includes('UNIQUE') || err.message.includes('PRIMARY KEY')) {
      db.prepare('UPDATE entity_types SET parent_type = ?, description = ? WHERE name = ?')
        .run(parentType || null, description || null, normalizedName);
      return { name: normalizedName, parentType: parentType || null, description, updated: true };
    }
    throw err;
  }
}

export function getTypeHierarchy(db: Database.Database, typeName: string) {
  const type = db.prepare('SELECT * FROM entity_types WHERE name = ?').get(typeName) as any;
  if (!type) return { error: `Entity type '${typeName}' not found` };

  return {
    name: type.name,
    description: type.description,
    parentType: type.parent_type,
    ancestors: getTypeAncestors(db, typeName),
    descendants: getTypeDescendants(db, typeName),
    depth: getTypeAncestors(db, typeName).length,
  };
}

export function listEntityTypes(db: Database.Database) {
  const types = db.prepare('SELECT * FROM entity_types ORDER BY name').all() as any[];

  // v3.13: Build parent/child maps in-memory to avoid N+1 queries
  const parentMap = new Map<string, string | null>();
  const childrenMap = new Map<string, string[]>();
  for (const t of types) {
    parentMap.set(t.name, t.parent_type || null);
    if (!childrenMap.has(t.name)) childrenMap.set(t.name, []);
    if (t.parent_type) {
      const siblings = childrenMap.get(t.parent_type) || [];
      siblings.push(t.name);
      childrenMap.set(t.parent_type, siblings);
    }
  }

  function getDepth(name: string): number {
    let depth = 0;
    let current = parentMap.get(name);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) break;
      visited.add(current);
      depth++;
      current = parentMap.get(current) || null;
    }
    return depth;
  }

  function countDescendants(name: string): number {
    let count = 0;
    const queue = childrenMap.get(name) || [];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const child = queue.shift()!;
      if (visited.has(child)) continue;
      visited.add(child);
      count++;
      const grandchildren = childrenMap.get(child) || [];
      queue.push(...grandchildren);
    }
    return count;
  }

  return types.map(t => ({
    name: t.name,
    parentType: t.parent_type,
    description: t.description,
    depth: getDepth(t.name),
    subtypeCount: countDescendants(t.name),
  }));
}

export function searchEntitiesByTypeHierarchy(
  db: Database.Database,
  entityType: string,
  query?: string,
  projectId?: string,
  limit = 50
) {
  const project = projectId || 'global';
  const allTypes = [entityType, ...getTypeDescendants(db, entityType)];

  let sql = `SELECT * FROM entities WHERE (project_id = ? OR project_id = 'global') AND entity_type IN (${allTypes.map(() => '?').join(', ')})`;
  const params: any[] = [project, ...allTypes];

  if (query) {
    sql += ` AND (name LIKE ? OR observations LIKE ?)`;
    params.push(`%${sanitizeLikePattern(query)}%`, `%${sanitizeLikePattern(query)}%`);
  }

  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);

  const entities = db.prepare(sql).all(...params) as any[];
  return {
    searchedType: entityType,
    includedTypes: allTypes,
    count: entities.length,
    entities: entities.map(e => ({
      id: e.id, name: e.name, entityType: e.entity_type,
      observations: safeParse(e.observations, []),
    })),
  };
}
