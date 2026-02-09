/**
 * Tests for src/entities.ts
 * Entities, edges, scratchpad, entity type hierarchy.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import {
  createEdge, queryEdges, invalidateEdge,
  scratchSet, scratchGet, scratchDelete, scratchList, scratchClear,
  createEntity, getEntity, linkEntities, searchEntities,
  observeEntity, deleteEntity,
  defineEntityType, getTypeHierarchy, listEntityTypes, searchEntitiesByTypeHierarchy,
} from '../src/entities.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

before(() => { db = createTestDb(); });
after(() => { db.close(); });

// ============================================================================
// Scratchpad
// ============================================================================
describe('Scratchpad', () => {
  it('should set and get a value', () => {
    scratchSet(db, 'test-key', 'test-value', undefined, 'test-project');
    const result = scratchGet(db, 'test-key', 'test-project');
    assert.strictEqual(result.value, 'test-value');
  });

  it('should return null for missing key', () => {
    const result = scratchGet(db, 'missing-key', 'test-project');
    assert.strictEqual(result.value, null);
  });

  it('should overwrite on re-set', () => {
    scratchSet(db, 'overwrite-key', 'v1', undefined, 'test-project');
    scratchSet(db, 'overwrite-key', 'v2', undefined, 'test-project');
    const result = scratchGet(db, 'overwrite-key', 'test-project');
    assert.strictEqual(result.value, 'v2');
  });

  it('should delete a key', () => {
    scratchSet(db, 'del-key', 'val', undefined, 'test-project');
    scratchDelete(db, 'del-key', 'test-project');
    const result = scratchGet(db, 'del-key', 'test-project');
    assert.strictEqual(result.value, null);
  });

  it('should list keys', () => {
    const project = `scratch-list-${Date.now()}`;
    scratchSet(db, 'k1', 'v1', undefined, project);
    scratchSet(db, 'k2', 'v2', undefined, project);
    const result = scratchList(db, project);
    assert.ok(result.keys.length >= 2, `Expected >= 2 keys, got ${result.keys.length}`);
  });

  it('should clear all keys for a project', () => {
    const project = `scratch-clear-${Date.now()}`;
    scratchSet(db, 'c1', 'v1', undefined, project);
    scratchSet(db, 'c2', 'v2', undefined, project);
    const result = scratchClear(db, project);
    assert.ok(result.cleared >= 2);
    const after = scratchList(db, project);
    assert.strictEqual(after.keys.length, 0);
  });

  it('should honor TTL (expired entries not returned)', () => {
    // Set with TTL of -1 second (already expired)
    db.prepare(`
      INSERT OR REPLACE INTO scratchpad (key, project_id, value, expires_at)
      VALUES (?, ?, ?, datetime('now', '-1 second'))
    `).run('expired-key', 'test-project', 'expired');
    const result = scratchGet(db, 'expired-key', 'test-project');
    assert.strictEqual(result.value, null, 'Expired entry should not be returned');
  });
});

// ============================================================================
// Edges
// ============================================================================
describe('Edges', () => {
  it('should create an edge between two memories', () => {
    const m1 = insertTestMemory(db, { content: 'Edge source' });
    const m2 = insertTestMemory(db, { content: 'Edge target' });
    const edge = createEdge(db, m1, m2, 'relates_to', 0.9, {}, 'test-project');
    assert.ok(edge.id, 'Should have an ID');
    assert.strictEqual(edge.from_id, m1);
    assert.strictEqual(edge.to_id, m2);
    assert.strictEqual(edge.relation_type, 'relates_to');
  });

  it('should query edges for a memory', () => {
    const m1 = insertTestMemory(db, { content: 'Query edge src' });
    const m2 = insertTestMemory(db, { content: 'Query edge tgt' });
    createEdge(db, m1, m2, 'depends_on', 1.0, {}, 'test-project');
    const edges = queryEdges(db, m1, 'both', 'test-project');
    assert.ok(edges.length >= 1, 'Should find at least 1 edge');
  });

  it('should query outgoing edges only', () => {
    const m1 = insertTestMemory(db, { content: 'Direction src' });
    const m2 = insertTestMemory(db, { content: 'Direction tgt' });
    createEdge(db, m1, m2, 'outgoing_test', 1.0, {}, 'test-project');
    const outgoing = queryEdges(db, m1, 'outgoing', 'test-project');
    const incoming = queryEdges(db, m1, 'incoming', 'test-project');
    assert.ok(outgoing.some(e => e.relation_type === 'outgoing_test'), 'Should find outgoing edge');
    assert.ok(!incoming.some(e => e.relation_type === 'outgoing_test'), 'Should not find as incoming');
  });

  it('should query incoming edges only', () => {
    const m1 = insertTestMemory(db, { content: 'Incoming src' });
    const m2 = insertTestMemory(db, { content: 'Incoming tgt' });
    createEdge(db, m1, m2, 'incoming_test', 1.0, {}, 'test-project');
    const incoming = queryEdges(db, m2, 'incoming', 'test-project');
    const outgoing = queryEdges(db, m2, 'outgoing', 'test-project');
    assert.ok(incoming.some(e => e.relation_type === 'incoming_test'), 'Should find incoming edge');
    assert.ok(!outgoing.some(e => e.relation_type === 'incoming_test'), 'Should not find as outgoing');
  });

  it('should invalidate an edge', () => {
    const m1 = insertTestMemory(db, { content: 'Inv edge src' });
    const m2 = insertTestMemory(db, { content: 'Inv edge tgt' });
    const edge = createEdge(db, m1, m2, 'test_type', 1.0, {}, 'test-project');
    const result = invalidateEdge(db, edge.id);
    assert.ok(result.invalidated, 'Should be invalidated');
  });
});

// ============================================================================
// Entities
// ============================================================================
describe('Entities', () => {
  it('should create an entity', () => {
    const result = createEntity(db, 'TestEntity', 'concept', ['obs1', 'obs2'], 'test-project');
    assert.ok(result.id, 'Should have an ID');
    assert.strictEqual(result.name, 'TestEntity');
    assert.deepStrictEqual(result.observations, ['obs1', 'obs2']);
  });

  it('should merge observations on duplicate create', () => {
    const project = `entity-merge-${Date.now()}`;
    createEntity(db, 'MergeEntity', 'concept', ['obs1'], project);
    const result = createEntity(db, 'MergeEntity', 'concept', ['obs2'], project);
    assert.ok(result.merged, 'Should be merged');
    assert.ok(result.observations.includes('obs1'), 'Should keep original obs');
    assert.ok(result.observations.includes('obs2'), 'Should have new obs');
  });

  it('should get an entity with relations', () => {
    const project = `entity-get-${Date.now()}`;
    createEntity(db, 'GetEntity', 'person', ['is a developer'], project);
    const result = getEntity(db, 'GetEntity', project);
    assert.ok(!result.error, 'Should not error');
    assert.strictEqual(result.name, 'GetEntity');
    assert.strictEqual(result.entityType, 'person');
  });

  it('should return error for missing entity', () => {
    const result = getEntity(db, 'NonexistentEntity', 'test-project');
    assert.ok(result.error, 'Should have error');
  });

  it('should link two entities', () => {
    const project = `entity-link-${Date.now()}`;
    createEntity(db, 'A', 'concept', [], project);
    createEntity(db, 'B', 'concept', [], project);
    const result = linkEntities(db, 'A', 'related_to', 'B', project);
    assert.ok(result.linked || result.alreadyExists, 'Should link or already exist');
  });

  it('should search entities by name', () => {
    const project = `entity-search-${Date.now()}`;
    createEntity(db, 'SearchableAlpha', 'concept', [], project);
    createEntity(db, 'SearchableBeta', 'concept', [], project);
    const results = searchEntities(db, 'Searchable', undefined, project, 10);
    assert.ok(results.length >= 2, `Expected >= 2, got ${results.length}`);
  });

  it('should observe (add observations to) entity', () => {
    const project = `entity-obs-${Date.now()}`;
    createEntity(db, 'ObsEntity', 'concept', ['initial'], project);
    const result = observeEntity(db, 'ObsEntity', ['new observation'], project);
    assert.ok(!result.error);
    assert.strictEqual(result.added, 1);
    assert.strictEqual(result.total_observations, 2);
  });

  it('should delete entity and its relations', () => {
    const project = `entity-del-${Date.now()}`;
    createEntity(db, 'DelEntity', 'concept', [], project);
    createEntity(db, 'RelatedEntity', 'concept', [], project);
    linkEntities(db, 'DelEntity', 'knows', 'RelatedEntity', project);
    const result = deleteEntity(db, 'DelEntity', project);
    assert.ok(result.deleted, 'Should be deleted');
    const get = getEntity(db, 'DelEntity', project);
    assert.ok(get.error, 'Should not be found after delete');
  });
});

// ============================================================================
// Entity Type Hierarchy
// ============================================================================
describe('Entity Type Hierarchy', () => {
  it('should define a new entity type', () => {
    const result = defineEntityType(db, 'developer', 'person', 'Software developer');
    assert.ok(result.created || result.updated, 'Should be created or updated');
    assert.strictEqual(result.name, 'developer');
    assert.strictEqual(result.parentType, 'person');
  });

  it('should get type hierarchy', () => {
    defineEntityType(db, 'senior_dev', 'developer', 'Senior developer');
    const hierarchy = getTypeHierarchy(db, 'senior_dev');
    assert.ok(!hierarchy.error);
    assert.ok(hierarchy.ancestors.includes('developer'), 'Should include developer ancestor');
    assert.ok(hierarchy.ancestors.includes('person'), 'Should include person ancestor');
  });

  it('should prevent circular inheritance', () => {
    defineEntityType(db, 'cycle_a', undefined, 'Cycle A');
    defineEntityType(db, 'cycle_b', 'cycle_a', 'Cycle B');
    const result = defineEntityType(db, 'cycle_a', 'cycle_b', 'Circular');
    assert.ok(result.error, 'Should detect circular inheritance');
  });

  it('should list all entity types', () => {
    const types = listEntityTypes(db);
    assert.ok(types.length >= 8, `Expected >= 8 default types, got ${types.length}`);
  });

  it('should search entities by type hierarchy', () => {
    const project = `hierarchy-search-${Date.now()}`;
    defineEntityType(db, 'test_child_type', 'concept', 'Test child');
    createEntity(db, 'HierarchyEntity', 'test_child_type', ['test'], project);
    const result = searchEntitiesByTypeHierarchy(db, 'concept', undefined, project, 50);
    assert.ok(result.includedTypes.includes('test_child_type'), 'Should include child type');
  });
});

// ============================================================================
// Entity Error Paths & Edge Cases (v4.3.4)
// ============================================================================
describe('Entity Error Paths', () => {
  it('should handle observeEntity on non-existent entity', () => {
    const result = observeEntity(db, 'NonexistentEntity_' + Date.now(), ['obs'], 'test-project');
    assert.ok(result.error, 'Should return error for non-existent entity');
  });

  it('should handle deleteEntity on non-existent entity', () => {
    const result = deleteEntity(db, 'NeverCreated_' + Date.now(), 'test-project');
    assert.ok(result.error, 'Should return error for non-existent entity');
  });

  it('should allow linkEntities even when entity names do not exist in entities table', () => {
    const project = `link-nocheck-${Date.now()}`;
    // entity_relations has no FK to entities — names are just strings
    const result = linkEntities(db, 'NonexistentSource', 'relates_to', 'NonexistentTarget', project);
    assert.ok(result.linked, 'Should succeed (no FK constraint on entity_relations)');
  });

  it('should return alreadyExists for duplicate link', () => {
    const project = `link-dup-${Date.now()}`;
    createEntity(db, 'DupLinkA', 'concept', [], project);
    createEntity(db, 'DupLinkB', 'concept', [], project);
    linkEntities(db, 'DupLinkA', 'relates_to', 'DupLinkB', project);
    const result = linkEntities(db, 'DupLinkA', 'relates_to', 'DupLinkB', project);
    assert.ok(result.alreadyExists, 'Should detect duplicate link');
  });

  it('should search entities by type filter', () => {
    const project = `search-type-${Date.now()}`;
    createEntity(db, 'PersonEntity', 'person', ['is a person'], project);
    createEntity(db, 'ConceptEntity', 'concept', ['is a concept'], project);
    const personResults = searchEntities(db, 'Entity', 'person', project, 10);
    assert.ok(personResults.length >= 1, 'Should find person entity');
    assert.ok(personResults.every((e: any) => e.entityType === 'person'), 'All results should be person type');
  });

  it('should handle empty observation array in observeEntity', () => {
    const project = `obs-empty-${Date.now()}`;
    createEntity(db, 'EmptyObsEntity', 'concept', ['initial'], project);
    const result = observeEntity(db, 'EmptyObsEntity', [], project);
    assert.ok(!result.error);
    assert.strictEqual(result.added, 0, 'Should add 0 observations');
  });
});
