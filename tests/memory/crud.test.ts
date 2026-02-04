/**
 * Just-Command Memory CRUD Tests
 * 
 * Tests for memory module CRUD operations.
 * Uses Node.js built-in test runner.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import memory module (tsx will handle TypeScript)
import {
  initDatabase,
  closeDatabase,
  storeMemory,
  recallMemory,
  updateMemory,
  deleteMemory,
  recoverMemory,
  purgeMemory,
  listRecentMemories,
  listDeletedMemories,
  searchMemories,
  getDatabaseStats,
} from '../../src/memory/index.js';

// Test database path
const TEST_DB_PATH = join(tmpdir(), `just-command-test-${Date.now()}.db`);

describe('Memory CRUD Operations', () => {
  before(async () => {
    // Initialize test database
    process.env.JUST_COMMAND_DB_PATH = TEST_DB_PATH;
    initDatabase({ dbPath: TEST_DB_PATH });
  });

  after(async () => {
    // Cleanup
    closeDatabase();
    try {
      rmSync(TEST_DB_PATH, { force: true });
      rmSync(`${TEST_DB_PATH}-wal`, { force: true });
      rmSync(`${TEST_DB_PATH}-shm`, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('storeMemory', () => {
    it('should store a basic memory', async () => {
      const memory = await storeMemory({
        content: 'Test memory content',
        type: 'fact',
      });

      assert.ok(memory.id, 'Memory should have an ID');
      assert.strictEqual(memory.content, 'Test memory content');
      assert.strictEqual(memory.type, 'fact');
      assert.ok(memory.createdAt, 'Memory should have createdAt');
      assert.ok(memory.updatedAt, 'Memory should have updatedAt');
    });

    it('should store memory with all metadata', async () => {
      const memory = await storeMemory({
        content: 'Detailed test memory',
        type: 'preference',
        tags: ['test', 'important'],
        source: 'unit-test',
        projectId: 'test-project',
        importance: 0.9,
        decayEnabled: false,
      });

      assert.strictEqual(memory.type, 'preference');
      assert.deepStrictEqual(memory.tags, ['test', 'important']);
      assert.strictEqual(memory.source, 'unit-test');
      assert.strictEqual(memory.projectId, 'test-project');
      assert.strictEqual(memory.importance, 0.9);
      assert.strictEqual(memory.decayEnabled, false);
    });

    it('should auto-generate ID if not provided', async () => {
      const memory = await storeMemory({
        content: 'Auto ID test',
      });

      assert.ok(memory.id);
      assert.ok(memory.id.length > 0);
    });
  });

  describe('recallMemory', () => {
    it('should recall stored memory by ID', async () => {
      const stored = await storeMemory({
        content: 'Recall test memory',
        type: 'note',
      });

      const recalled = recallMemory(stored.id);

      assert.ok(recalled, 'Memory should be recalled');
      assert.strictEqual(recalled!.id, stored.id);
      assert.strictEqual(recalled!.content, 'Recall test memory');
      assert.strictEqual(recalled!.type, 'note');
    });

    it('should return null for non-existent ID', () => {
      const result = recallMemory('non-existent-id');
      assert.strictEqual(result, null, 'Should return null for non-existent ID');
    });
  });

  describe('updateMemory', () => {
    it('should update memory content', async () => {
      const stored = await storeMemory({
        content: 'Original content',
        type: 'fact',
      });

      const updated = await updateMemory(stored.id, {
        content: 'Updated content',
      });

      assert.ok(updated, 'Should return updated memory');
      assert.strictEqual(updated!.content, 'Updated content');
      assert.strictEqual(updated!.type, 'fact');
    });

    it('should update memory tags', async () => {
      const stored = await storeMemory({
        content: 'Tag test',
        tags: ['old'],
      });

      const updated = await updateMemory(stored.id, {
        tags: ['new', 'tags'],
      });

      assert.ok(updated, 'Should return updated memory');
      assert.deepStrictEqual(updated!.tags, ['new', 'tags']);
    });

    it('should update importance', async () => {
      const stored = await storeMemory({
        content: 'Importance test',
        importance: 0.5,
      });

      const updated = await updateMemory(stored.id, {
        importance: 0.95,
      });

      assert.ok(updated, 'Should return updated memory');
      assert.strictEqual(updated!.importance, 0.95);
    });

    it('should return null for non-existent memory', async () => {
      const result = await updateMemory('non-existent-id', {
        content: 'Should not work',
      });

      assert.strictEqual(result, null, 'Should return null for non-existent memory');
    });
  });

  describe('deleteMemory', () => {
    it('should soft-delete memory', async () => {
      const stored = await storeMemory({
        content: 'Soft delete test',
      });

      const deleted = deleteMemory(stored.id);
      assert.strictEqual(deleted, true, 'Should return true on successful delete');

      // Should not be found in normal recall
      const recalled = recallMemory(stored.id);
      assert.strictEqual(recalled, null, 'Deleted memory should not be recalled');

      // Should appear in deleted list
      const deletedList = listDeletedMemories();
      const found = deletedList.find(m => m.id === stored.id);
      assert.ok(found, 'Memory should be in deleted list');
    });

    it('should return false for non-existent memory', () => {
      const result = deleteMemory('non-existent-id');
      assert.strictEqual(result, false, 'Should return false for non-existent memory');
    });
  });

  describe('purgeMemory', () => {
    it('should permanently delete memory', async () => {
      const stored = await storeMemory({
        content: 'Permanent delete test',
      });

      const purged = purgeMemory(stored.id);
      assert.strictEqual(purged, true, 'Should return true on successful purge');

      // Should not be found anywhere
      const recalled = recallMemory(stored.id);
      assert.strictEqual(recalled, null, 'Purged memory should not be recalled');
    });
  });

  describe('recoverMemory', () => {
    it('should recover soft-deleted memory', async () => {
      const stored = await storeMemory({
        content: 'Recovery test',
      });

      deleteMemory(stored.id);
      const recovered = recoverMemory(stored.id);

      assert.ok(recovered, 'Should return recovered memory');
      assert.strictEqual(recovered!.content, 'Recovery test');
      assert.strictEqual(recovered!.deletedAt, null, 'deletedAt should be null');
    });

    it('should return null for non-deleted memory', async () => {
      const stored = await storeMemory({
        content: 'Not deleted',
      });

      const result = recoverMemory(stored.id);
      assert.strictEqual(result, null, 'Should return null for non-deleted memory');
    });
  });

  describe('listRecentMemories', () => {
    before(async () => {
      // Clear any existing test memories by creating fresh ones
      await storeMemory({ content: 'List test 1', type: 'fact' });
      await storeMemory({ content: 'List test 2', type: 'event' });
      await storeMemory({ content: 'List test 3', type: 'note' });
    });

    it('should list recent memories with limit', () => {
      const memories = listRecentMemories({ limit: 2 });

      assert.ok(memories.length <= 2, `Should respect limit, got ${memories.length}`);
    });

    it('should filter by type', async () => {
      // Create specific type memories for this test
      await storeMemory({ content: 'Event for filter test', type: 'event' });
      
      const events = listRecentMemories({ type: 'event', limit: 10 });
      
      assert.ok(events.length > 0, 'Should find event memories');
      for (const m of events) {
        assert.strictEqual(m.type, 'event', `Expected type 'event', got '${m.type}'`);
      }
    });

    it('should filter by projectId', async () => {
      // Create project-specific memories for this test
      await storeMemory({ content: 'Project A memory', projectId: 'project-filter-a' });
      await storeMemory({ content: 'Project B memory', projectId: 'project-filter-b' });

      const projectA = listRecentMemories({ projectId: 'project-filter-a', limit: 10 });
      
      assert.ok(projectA.length > 0, 'Should find memories for project-filter-a');
      for (const m of projectA) {
        assert.strictEqual(m.projectId, 'project-filter-a');
      }
    });

    it('should support offset for pagination', async () => {
      // Store several memories to test pagination
      for (let i = 0; i < 5; i++) {
        await storeMemory({ content: `Pagination test ${i}`, projectId: 'pagination-test' });
      }

      const page1 = listRecentMemories({ projectId: 'pagination-test', limit: 2, offset: 0 });
      const page2 = listRecentMemories({ projectId: 'pagination-test', limit: 2, offset: 2 });

      assert.ok(page1.length <= 2, 'Page 1 should have at most 2 items');
      assert.ok(page2.length <= 2, 'Page 2 should have at most 2 items');
      
      // Ensure pages don't overlap (unless there are fewer memories)
      if (page1.length > 0 && page2.length > 0) {
        const page1Ids = new Set(page1.map(m => m.id));
        const hasOverlap = page2.some(m => page1Ids.has(m.id));
        assert.strictEqual(hasOverlap, false, 'Pages should not overlap');
      }
    });
  });

  describe('searchMemories', () => {
    before(async () => {
      // Store some searchable memories
      await storeMemory({ content: 'The quick brown fox jumps over the lazy dog', type: 'fact' });
      await storeMemory({ content: 'Python is a great programming language', type: 'note' });
      await storeMemory({ content: 'TypeScript adds static typing to JavaScript', type: 'fact' });
    });

    it('should find memories by keyword', async () => {
      const results = await searchMemories('Python programming');

      assert.ok(results.length > 0, 'Should find results');
      // At least one result should mention Python
      const hasPython = results.some(r => 
        r.memory.content.toLowerCase().includes('python')
      );
      assert.ok(hasPython, 'Should find Python-related memory');
    });

    it('should return scores with results', async () => {
      const results = await searchMemories('JavaScript TypeScript');

      for (const result of results) {
        assert.ok(result.score !== undefined, 'Result should have score');
        assert.ok(result.score >= 0 && result.score <= 1, `Score should be 0-1, got ${result.score}`);
      }
    });

    it('should respect limit parameter', async () => {
      const results = await searchMemories('the', { limit: 2 });

      assert.ok(results.length <= 2, `Should respect limit, got ${results.length}`);
    });

    it('should filter by type', async () => {
      await storeMemory({ content: 'Search type filter note', type: 'note' });
      
      const results = await searchMemories('filter', { type: 'note' });

      for (const result of results) {
        assert.strictEqual(result.memory.type, 'note');
      }
    });
  });

  describe('getDatabaseStats', () => {
    it('should return database statistics', () => {
      const stats = getDatabaseStats();

      assert.ok(typeof stats.memoryCount === 'number', 'Should have memoryCount');
      assert.ok(typeof stats.deletedMemoryCount === 'number', 'Should have deletedMemoryCount');
      assert.ok(typeof stats.entityCount === 'number', 'Should have entityCount');
      assert.ok(typeof stats.relationCount === 'number', 'Should have relationCount');
      assert.ok(typeof stats.schemaVersion === 'number', 'Should have schemaVersion');
    });

    it('should track memory counts correctly', async () => {
      const statsBefore = getDatabaseStats();
      
      const memory = await storeMemory({ content: 'Stats test memory' });
      const statsAfterStore = getDatabaseStats();
      
      assert.ok(
        statsAfterStore.memoryCount >= statsBefore.memoryCount,
        'Memory count should not decrease after store'
      );

      deleteMemory(memory.id);
      const statsAfterDelete = getDatabaseStats();
      
      assert.ok(
        statsAfterDelete.deletedMemoryCount >= statsBefore.deletedMemoryCount,
        'Deleted count should not decrease after delete'
      );
    });
  });
});
