/**
 * Tests for src/chat-ingestion.ts
 * Parsing, dedup, fact storage, search.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestDb, insertTestMemory } from './helpers/test-db.js';
import {
  isDuplicateFact,
  storeExtractedFact,
  searchConversations,
  isQualityFact,
  isDefiniteGarbage,
  cleanupGarbageFacts,
  summarizeConversation,
  summarizeBatch,
  extractConversationTopics,
  searchConversationSummaries,
  type ExtractedFact,
} from '../src/chat-ingestion.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const project = 'test-project';

before(() => { db = createTestDb(); });
after(() => { db.close(); });

describe('isDuplicateFact', () => {
  it('should detect exact duplicate', () => {
    const fact: ExtractedFact = {
      content: 'The sky is blue',
      type: 'fact',
      confidence: 0.8,
      importance: 0.5,
      tags: [],
    };

    // Insert a memory with the same content
    insertTestMemory(db, { content: 'The sky is blue', project_id: project });

    const result = isDuplicateFact(db, fact, project);
    assert.strictEqual(result, true, 'Should detect exact duplicate');
  });

  it('should return false for unique content', () => {
    const fact: ExtractedFact = {
      content: 'Completely unique fact ' + Date.now(),
      type: 'fact',
      confidence: 0.8,
      importance: 0.5,
      tags: [],
    };

    const result = isDuplicateFact(db, fact, project);
    assert.strictEqual(result, false, 'Should not detect as duplicate');
  });

  it('should detect substring match', () => {
    const longContent = 'This is a very specific piece of content that is long enough to trigger substring matching';
    insertTestMemory(db, { content: longContent, project_id: project });

    const fact: ExtractedFact = {
      content: longContent,
      type: 'fact',
      confidence: 0.8,
      importance: 0.5,
      tags: [],
    };

    const result = isDuplicateFact(db, fact, project);
    assert.strictEqual(result, true, 'Should detect via substring match');
  });
});

describe('storeExtractedFact', () => {
  it('should store a fact and return its ID', () => {
    const fact: ExtractedFact = {
      content: 'Stored fact test ' + Date.now(),
      type: 'fact',
      confidence: 0.9,
      importance: 0.7,
      tags: ['test', 'unit'],
    };

    const id = storeExtractedFact(db, fact, project);
    assert.ok(id, 'Should return a memory ID');

    // Verify it was stored
    const stored = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    assert.ok(stored, 'Memory should exist in DB');
    assert.strictEqual(stored.content, fact.content);
    assert.strictEqual(stored.type, 'fact');
    assert.strictEqual(stored.project_id, project);
  });

  it('should store fact without entities successfully', () => {
    const fact: ExtractedFact = {
      content: 'No entity fact test ' + Date.now(),
      type: 'fact',
      confidence: 0.8,
      importance: 0.5,
      tags: ['clean'],
    };

    const id = storeExtractedFact(db, fact, project);
    assert.ok(id, 'Should return a memory ID');

    const stored = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    assert.ok(stored, 'Memory should exist');
    assert.strictEqual(JSON.parse(stored.tags)[0], 'clean');
  });

  it('should store with entity linking and add observation', () => {
    const entityName = 'Alice_' + Date.now();
    const fact: ExtractedFact = {
      content: 'Entity link test ' + Date.now(),
      type: 'fact',
      confidence: 0.8,
      importance: 0.5,
      tags: [],
      entities: [`person:${entityName}`],
    };

    const id = storeExtractedFact(db, fact, project);
    assert.ok(id, 'Should return a memory ID');

    // Verify entity was created with correct entity_type column (bug fix 1.3)
    const entity = db.prepare("SELECT * FROM entities WHERE name = ? AND project_id = ?").get(entityName, project) as any;
    assert.ok(entity, 'Entity should be created');
    assert.strictEqual(entity.entity_type, 'person', 'Entity type should be person');

    // Verify observation was added linking memory to entity
    const obs: string[] = JSON.parse(entity.observations);
    assert.ok(obs.some((o: string) => o.includes(id!)), 'Entity should have observation referencing the memory');
  });
});

describe('searchConversations', () => {
  it('should return empty for no matches', () => {
    const results = searchConversations(db, 'nonexistent_term_xyz', project, 10);
    assert.ok(Array.isArray(results), 'Should return array');
    assert.strictEqual(results.length, 0, 'Should be empty');
  });

  it('should find matching messages', () => {
    // Insert a conversation and message
    const convId = 'test-conv-' + Date.now();
    db.prepare(`
      INSERT INTO conversations (id, project_id, source, started_at, source_session_id)
      VALUES (?, ?, 'test', datetime('now'), ?)
    `).run(convId, project, 'session-' + Date.now());

    db.prepare(`
      INSERT INTO conversation_messages (id, conversation_id, project_id, role, content, timestamp)
      VALUES (?, ?, ?, 'assistant', 'This is searchable content about databases', datetime('now'))
    `).run('msg-' + Date.now(), convId, project);

    const results = searchConversations(db, 'searchable databases', project, 10);
    assert.ok(results.length >= 1, 'Should find at least 1 result');
  });

  it('should handle LIKE wildcard characters safely', () => {
    // Should not crash when searching for strings with % or _
    const results = searchConversations(db, '100% done_now', project, 10);
    assert.ok(Array.isArray(results), 'Should handle wildcards without error');
  });
});

describe('isQualityFact', () => {
  it('should reject content with fewer than 4 words', () => {
    assert.strictEqual(isQualityFact('fresh context'), false);
    assert.strictEqual(isQualityFact('to get App'), false);
    assert.strictEqual(isQualityFact('highest priority remaining'), false);
  });

  it('should reject content that is mostly stop words', () => {
    assert.strictEqual(isQualityFact('to do it for me with all of them'), false);
    assert.strictEqual(isQualityFact('I would have been to the one'), false);
  });

  it('should accept meaningful content', () => {
    assert.strictEqual(isQualityFact('Project uses TypeScript with SQLite backend'), true);
    assert.strictEqual(isQualityFact('VectorStore abstraction supports Qdrant sidecar'), true);
  });

  it('should reject mid-sentence fragments starting with articles/connectives', () => {
    assert.strictEqual(isQualityFact('a solid architectural foundation with clean separation'), false);
    assert.strictEqual(isQualityFact('the filesystem tools to examine the project'), false);
    assert.strictEqual(isQualityFact('to create the parent directory first here'), false);
  });

  it('should reject markdown table and git log fragments', () => {
    assert.strictEqual(isQualityFact('some | table | content | here'), false);
    assert.strictEqual(isQualityFact('7ed7dfb Add research docs about Qt6'), false);
  });

  it('should reject markdown formatting artifacts', () => {
    assert.strictEqual(isQualityFact('**BUILD SUCCESS** Exit code 0 confirmed'), false);
    assert.strictEqual(isQualityFact('# Heading about something important here'), false);
    assert.strictEqual(isQualityFact('- list item about some topic here'), false);
  });

  it('should reject expanded connective/verb fragments (v4.2)', () => {
    assert.strictEqual(isQualityFact('have unlimited context either, we have selective retrieval from long-term storage'), false);
    assert.strictEqual(isQualityFact('actually see any "Just_Memory" tools in my available tools'), false);
    assert.strictEqual(isQualityFact('where the project configuration files are located'), false);
    assert.strictEqual(isQualityFact('when the user asks about something important'), false);
    assert.strictEqual(isQualityFact('basically just a wrapper around the core function'), false);
    assert.strictEqual(isQualityFact('should probably refactor this later for clarity'), false);
  });

  it('should reject truncated content (v4.2)', () => {
    assert.strictEqual(isQualityFact('to find where r'), false);
    assert.strictEqual(isQualityFact('to replace `await r'), false);
    assert.strictEqual(isQualityFact('the function returns a'), false);
    assert.strictEqual(isQualityFact('need to check the `f'), false);
  });

  it('should reject meta-commentary / self-narration (v4.2)', () => {
    assert.strictEqual(isQualityFact('let me search for more code snippets in the project'), false);
    assert.strictEqual(isQualityFact("I'll look at the configuration files next"), false);
    assert.strictEqual(isQualityFact('I need to check the database schema for issues'), false);
    assert.strictEqual(isQualityFact('looking at the test results for any failures'), false);
    assert.strictEqual(isQualityFact('searching for similar patterns in the codebase'), false);
  });

  it('should reject malformed sentence boundaries (v4.2)', () => {
    assert.strictEqual(isQualityFact('bug fix that blocks tests:Now moving to P1 tasks'), false);
    assert.strictEqual(isQualityFact('completed the refactor:Starting the next phase now'), false);
  });

  it('should reject content that is mostly inline code (v4.2)', () => {
    assert.strictEqual(isQualityFact('use `await` with `Promise.all`'), false);
    assert.strictEqual(isQualityFact('call `db.prepare` with `run`'), false);
  });

  it('should still accept legitimate content with new rules (v4.2)', () => {
    assert.strictEqual(isQualityFact('Eric is the creator of Just-Memory and EvoSteward'), true);
    assert.strictEqual(isQualityFact('DECAY_PER_DAY controls how fast confidence drops'), true);
    assert.strictEqual(isQualityFact('Bazzite uses rpm-ostree for package management'), true);
    assert.strictEqual(isQualityFact('The vcpkg build system is broken on GCC 15'), true);
    // Ensure URLs with colons are not rejected
    assert.strictEqual(isQualityFact('Download Qdrant binary from https://github.com/qdrant/releases'), true);
  });
});

describe('cleanupGarbageFacts', () => {
  it('should delete auto-extracted garbage and garbage entities', () => {
    const cleanDb = createTestDb();
    const ts = Date.now();

    // Create required conversation rows for FK constraints
    cleanDb.prepare(`
      INSERT INTO conversations (id, project_id, source, started_at, source_session_id)
      VALUES ('conv-1', ?, 'test', datetime('now'), 'sess-1')
    `).run(project);
    cleanDb.prepare(`
      INSERT INTO conversations (id, project_id, source, started_at, source_session_id)
      VALUES ('conv-2', ?, 'test', datetime('now'), 'sess-2')
    `).run(project);

    // Insert a garbage auto-extracted memory (fails quality: too short)
    const garbageId = 'garbage-' + ts;
    cleanDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding)
      VALUES (?, ?, 'fresh context stuff', 'fact', '["fact"]', 0.5, 0.7, NULL)
    `).run(garbageId, project);

    cleanDb.prepare(`
      INSERT INTO memory_sources (id, memory_id, conversation_id, extraction_type, confidence)
      VALUES (?, ?, 'conv-1', 'auto', 0.7)
    `).run('src-' + ts, garbageId);

    // Insert a quality auto-extracted memory (passes quality)
    const goodId = 'good-' + ts;
    cleanDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding)
      VALUES (?, ?, 'Project uses TypeScript with SQLite backend for persistence', 'fact', '["fact"]', 0.5, 0.7, NULL)
    `).run(goodId, project);

    cleanDb.prepare(`
      INSERT INTO memory_sources (id, memory_id, conversation_id, extraction_type, confidence)
      VALUES (?, ?, 'conv-2', 'auto', 0.7)
    `).run('src2-' + ts, goodId);

    // Insert a garbage entity (stop word name)
    cleanDb.prepare(`
      INSERT INTO entities (id, project_id, name, entity_type, observations)
      VALUES (?, ?, 'wants', 'person', '[]')
    `).run('ent-' + Date.now(), project);

    const result = cleanupGarbageFacts(cleanDb, project);
    assert.ok(result.memoriesDeleted >= 1, 'Should delete at least 1 garbage memory');
    assert.ok(result.entitiesDeleted >= 1, 'Should delete at least 1 garbage entity');

    // Verify the good memory survived
    const survived = cleanDb.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(goodId);
    assert.ok(survived, 'Quality memory should survive cleanup');

    // Verify garbage is soft-deleted
    const deleted = cleanDb.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NOT NULL').get(garbageId);
    assert.ok(deleted, 'Garbage memory should be soft-deleted');

    cleanDb.close();
  });

  it('should delete manually-stored garbage via Strategy 3 (v4.2)', () => {
    const cleanDb = createTestDb();

    // Manually-stored garbage: no memory_sources link, confidence != 0.7
    const garbageManualId = 'manual-garbage-' + Date.now();
    cleanDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding)
      VALUES (?, ?, 'have unlimited context either, we have selective retrieval from long-term storage', 'preference', '["preference"]', 0.7, 0.75, NULL)
    `).run(garbageManualId, project);

    // Another manually-stored garbage: truncated
    const garbageTruncId = 'manual-trunc-' + Date.now();
    cleanDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding)
      VALUES (?, ?, 'to find where r', 'preference', '["preference"]', 0.7, 0.75, NULL)
    `).run(garbageTruncId, project);

    // Quality manually-stored memory: should survive
    const goodManualId = 'manual-good-' + Date.now();
    cleanDb.prepare(`
      INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, embedding)
      VALUES (?, ?, 'Eric is the creator and developer of Just-Memory project', 'fact', '["creator", "authorship"]', 1.0, 0.95, NULL)
    `).run(goodManualId, project);

    const result = cleanupGarbageFacts(cleanDb, project);
    assert.ok(result.memoriesDeleted >= 2, 'Should delete at least 2 garbage memories');

    // Verify quality memory survived
    const survived = cleanDb.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL').get(goodManualId);
    assert.ok(survived, 'Quality manually-stored memory should survive Strategy 3');

    // Verify garbage was soft-deleted
    const deleted1 = cleanDb.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NOT NULL').get(garbageManualId);
    assert.ok(deleted1, 'Manually-stored garbage fragment should be soft-deleted by Strategy 3');
    const deleted2 = cleanDb.prepare('SELECT id FROM memories WHERE id = ? AND deleted_at IS NOT NULL').get(garbageTruncId);
    assert.ok(deleted2, 'Truncated garbage should be soft-deleted by Strategy 3');

    cleanDb.close();
  });
});

describe('isDefiniteGarbage', () => {
  it('should flag truncated content', () => {
    assert.strictEqual(isDefiniteGarbage('to find where r'), true);
    assert.strictEqual(isDefiniteGarbage('to replace `await r'), true);
  });

  it('should flag meta-commentary', () => {
    assert.strictEqual(isDefiniteGarbage('let me search for more code snippets in the project'), true);
    assert.strictEqual(isDefiniteGarbage("I'll look at the configuration files next"), true);
  });

  it('should flag malformed boundaries', () => {
    assert.strictEqual(isDefiniteGarbage('bug fix that blocks tests:Now moving to P1 tasks'), true);
  });

  it('should flag lowercase connective fragments', () => {
    assert.strictEqual(isDefiniteGarbage('have unlimited context either, we have selective retrieval'), true);
    assert.strictEqual(isDefiniteGarbage('actually see any tools in my available tools list'), true);
  });

  it('should NOT flag quality content', () => {
    assert.strictEqual(isDefiniteGarbage('Eric is the creator of Just-Memory and EvoSteward'), false);
    assert.strictEqual(isDefiniteGarbage('DECAY_PER_DAY controls how fast confidence drops'), false);
    assert.strictEqual(isDefiniteGarbage('Bazzite uses rpm-ostree for package management'), false);
    assert.strictEqual(isDefiniteGarbage('Download Qdrant binary from https://github.com/qdrant/releases'), false);
  });
});

// ============================================================================
// Layer 3: Conversation Summarization Tests (v4.2)
// ============================================================================

describe('summarizeConversation', () => {
  it('should return error for non-existent conversation', async () => {
    const result = await summarizeConversation(db, 'nonexistent-conv-id', project);
    assert.ok('error' in result, 'Should return error');
  });

  it('should return error for conversation with no messages', async () => {
    const convId = 'empty-conv-' + Date.now();
    db.prepare(`
      INSERT INTO conversations (id, project_id, source, started_at, source_session_id)
      VALUES (?, ?, 'test', datetime('now'), ?)
    `).run(convId, project, 'sess-empty-' + Date.now());

    const result = await summarizeConversation(db, convId, project);
    assert.ok('error' in result, 'Should return error for empty conversation');
  });
});

describe('summarizeBatch', () => {
  it('should return counts and not crash on empty batch', async () => {
    // Use a unique project so there are no unsummarized conversations
    const result = await summarizeBatch(db, 'unique-summarize-project-' + Date.now(), 5);
    assert.strictEqual(typeof result.summarized, 'number');
    assert.strictEqual(typeof result.errors, 'number');
    assert.strictEqual(result.summarized, 0, 'No conversations to summarize');
  });
});

describe('extractConversationTopics', () => {
  it('should return empty for conversation with no messages', () => {
    const convId = 'topic-empty-' + Date.now();
    db.prepare(`
      INSERT INTO conversations (id, project_id, source, started_at, source_session_id)
      VALUES (?, ?, 'test', datetime('now'), ?)
    `).run(convId, project, 'sess-topic-' + Date.now());

    const topics = extractConversationTopics(db, convId, project);
    assert.ok(Array.isArray(topics), 'Should return array');
    assert.strictEqual(topics.length, 0, 'Should be empty');
  });

  it('should extract topics from conversation messages', () => {
    const convId = 'topic-test-' + Date.now();
    db.prepare(`
      INSERT INTO conversations (id, project_id, source, started_at, source_session_id)
      VALUES (?, ?, 'test', datetime('now'), ?)
    `).run(convId, project, 'sess-topic2-' + Date.now());

    // Insert messages with repeated terms
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, project_id, role, content, timestamp)
        VALUES (?, ?, ?, 'assistant', ?, datetime('now'))
      `).run(`msg-topic-${Date.now()}-${i}`, convId, project,
        'The database migration requires updating the schema. Database performance depends on proper indexing. Schema migration tools handle database versioning automatically.');
    }

    const topics = extractConversationTopics(db, convId, project);
    assert.ok(Array.isArray(topics), 'Should return array');
    assert.ok(topics.length > 0, 'Should extract at least one topic');
    // 'database' and 'migration' and 'schema' should be among the topics
    const topicsLower = topics.map(t => t.toLowerCase());
    assert.ok(
      topicsLower.some(t => t.includes('database') || t.includes('migration') || t.includes('schema')),
      `Should extract database/migration/schema related topics, got: ${topics.join(', ')}`
    );
  });
});

describe('searchConversationSummaries', () => {
  it('should return empty for no matches', () => {
    const results = searchConversationSummaries(db, 'nonexistent_search_term_xyz', project, 10);
    assert.ok(Array.isArray(results), 'Should return array');
    assert.strictEqual(results.length, 0, 'Should be empty');
  });

  it('should find matching summaries', () => {
    const convId = 'summary-search-' + Date.now();
    db.prepare(`
      INSERT INTO conversations (id, project_id, source, started_at, source_session_id)
      VALUES (?, ?, 'test', datetime('now'), ?)
    `).run(convId, project, 'sess-summ-' + Date.now());

    // Insert a summary directly
    db.prepare(`
      INSERT INTO conversation_summaries (id, conversation_id, project_id, summary_type, content, model_used)
      VALUES (?, ?, ?, 'brief', 'Discussion about database optimization and query performance tuning', 'test-model')
    `).run('summ-' + Date.now(), convId, project);

    const results = searchConversationSummaries(db, 'database optimization', project, 10);
    assert.ok(results.length >= 1, 'Should find at least 1 result');
    assert.ok(results[0].summary.includes('database'), 'Should contain search term');
  });
});
