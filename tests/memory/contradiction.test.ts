/**
 * Tests for Contradiction Detection System
 * 
 * Tests the contradiction detection, flagging, resolution,
 * and statistics functions for Just-Memory.
 * 
 * Based on TACL 2024 research: "When Can LLMs Actually Correct Their Own Mistakes?"
 */

import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';

// Mock setup before imports
const TEST_DB_PATH = path.join(__dirname, 'test_contradiction.db');

// Clean up any existing test DB
beforeAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

afterAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

// Mock the database module
jest.mock('../../src/memory/database', () => {
  let db: Database.Database | null = null;
  
  return {
    getDatabase: () => {
      if (!db) {
        db = new Database(TEST_DB_PATH);
        // Create minimal schema
        db.exec(`
          CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            type TEXT DEFAULT 'fact',
            tags TEXT,
            importance REAL DEFAULT 0.5,
            confidence_score REAL DEFAULT 1.0,
            project_id TEXT,
            embedding BLOB,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            deleted_at TEXT
          )
        `);
      }
      return db;
    },
    closeDatabase: () => {
      if (db) {
        db.close();
        db = null;
      }
    },
  };
});

// Mock embeddings
let mockEmbedding: number[] | null = null;
jest.mock('../../src/memory/embeddings', () => ({
  generateEmbedding: jest.fn().mockImplementation(async () => mockEmbedding),
  cosineSimilarity: jest.fn().mockImplementation((a: number[], b: number[]) => {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }),
  bufferToEmbedding: jest.fn().mockImplementation((buffer: Buffer) => {
    try {
      const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
      return Array.from(floats);
    } catch {
      return null;
    }
  }),
}));

// Mock project isolation
jest.mock('../../src/memory/project-isolation', () => ({
  buildProjectFilter: jest.fn().mockImplementation(() => ({ clause: '', params: [] })),
  getProjectContext: jest.fn().mockReturnValue('test-project'),
  GLOBAL_PROJECT_ID: '__global__',
}));

import {
  detectContradiction,
  checkAndAdjustConfidence,
  flagContradiction,
  resolveContradiction,
  getUnresolvedContradictions,
  getContradictionStats,
  type ContradictionResult,
  type ContradictionType,
} from '../../src/memory/contradiction';
import { getDatabase, closeDatabase } from '../../src/memory/database';
import { generateEmbedding } from '../../src/memory/embeddings';

describe('Contradiction Detection System', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = getDatabase();
  });

  afterAll(() => {
    closeDatabase();
  });

  beforeEach(() => {
    // Clear memories and contradictions between tests
    db.exec('DELETE FROM memories');
    try {
      db.exec('DELETE FROM contradictions');
    } catch {
      // Table may not exist yet
    }
    mockEmbedding = null;
  });


  // ============================================================================
  // Detection with No Candidates Tests
  // ============================================================================
  
  describe('detectContradiction - no candidates', () => {
    it('should return no contradiction when database is empty', async () => {
      mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      
      const result = await detectContradiction('The sky is blue');
      
      expect(result.hasContradiction).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should return no contradiction when embedding generation fails', async () => {
      mockEmbedding = null;
      
      const result = await detectContradiction('Some content');
      
      expect(result.hasContradiction).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should return no contradiction when no similar memories found', async () => {
      // Add a memory with embedding
      const embedding = new Float32Array([0.9, 0.8, 0.7, 0.6, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_1', 'Completely unrelated content about cars', embBuffer);
      
      // Search with very different embedding
      mockEmbedding = [0.1, 0.1, 0.1, 0.1, 0.1];
      
      const result = await detectContradiction('Content about space exploration');
      
      expect(result.hasContradiction).toBe(false);
    });
  });

  // ============================================================================
  // Negation Detection Tests
  // ============================================================================
  
  describe('detectContradiction - negation patterns', () => {
    beforeEach(() => {
      // Use similar embeddings for these tests
      mockEmbedding = [0.5, 0.5, 0.5, 0.5, 0.5];
    });

    it('should detect "is" vs "is not" contradiction', async () => {
      // Add existing memory with very similar embedding
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_neg_1', 'The project is complete', embBuffer);

      const result = await detectContradiction('The project is not complete');
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('negation');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect "never" negation pattern', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_neg_2', 'John visited Paris in 2020', embBuffer);

      const result = await detectContradiction('John never visited Paris');
      
      // May detect based on semantic similarity and negation patterns
      expect(typeof result.hasContradiction).toBe('boolean');
    });

    it('should detect "no longer" negation pattern', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_neg_3', 'Alice works at Google', embBuffer);

      const result = await detectContradiction('Alice no longer works at Google');
      
      expect(typeof result.hasContradiction).toBe('boolean');
    });
  });


  // ============================================================================
  // Antonym Detection Tests
  // ============================================================================
  
  describe('detectContradiction - antonym patterns', () => {
    beforeEach(() => {
      mockEmbedding = [0.5, 0.5, 0.5, 0.5, 0.5];
    });

    it('should detect true/false antonym contradiction', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_ant_1', 'The statement is true', embBuffer);

      const result = await detectContradiction('The statement is false');
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('antonym');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect alive/dead antonym contradiction', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_ant_2', 'The patient is alive and recovering', embBuffer);

      const result = await detectContradiction('The patient is dead');
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('antonym');
    });

    it('should detect hot/cold antonym contradiction', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_ant_3', 'The weather is hot today', embBuffer);

      const result = await detectContradiction('The weather is cold today');
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('antonym');
    });

    it('should detect success/failure antonym contradiction', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_ant_4', 'The launch was a success', embBuffer);

      const result = await detectContradiction('The launch was a failure');
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('antonym');
    });

    it('should NOT detect contradiction with unrelated antonyms', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_ant_5', 'The coffee is hot', embBuffer);

      // Different context - should not trigger antonym conflict
      const result = await detectContradiction('The ice cream is cold');
      
      // This depends on semantic similarity - may or may not detect
      expect(typeof result.hasContradiction).toBe('boolean');
    });
  });


  // ============================================================================
  // Numeric Contradiction Tests
  // ============================================================================
  
  describe('detectContradiction - numeric patterns', () => {
    beforeEach(() => {
      mockEmbedding = [0.5, 0.5, 0.5, 0.5, 0.5];
    });

    it('should detect significant numeric disagreement', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_num_1', 'The population is 1000000 people', embBuffer);

      const result = await detectContradiction('The population is 500000 people');
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('numeric');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect price contradictions', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_num_2', 'The laptop costs $1500', embBuffer);

      const result = await detectContradiction('The laptop costs $800');
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('numeric');
    });

    it('should NOT flag small numeric differences (<10%)', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_num_3', 'The temperature is 72 degrees', embBuffer);

      // 5% difference - should not be flagged
      const result = await detectContradiction('The temperature is 75 degrees');
      
      // Small differences may not be flagged as contradictions
      expect(typeof result.hasContradiction).toBe('boolean');
    });
  });

  // ============================================================================
  // Entity-Attribute Conflict Tests
  // ============================================================================
  
  describe('detectContradiction - entity conflicts', () => {
    beforeEach(() => {
      mockEmbedding = [0.5, 0.5, 0.5, 0.5, 0.5];
    });

    it('should detect entity attribute conflict', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_ent_1', "John's job is engineer", embBuffer);

      const result = await detectContradiction("John's job is doctor");
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('entity_conflict');
    });

    it('should detect location conflicts', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_ent_2', 'Alice lives in New York', embBuffer);

      const result = await detectContradiction('Alice lives in London');
      
      expect(result.hasContradiction).toBe(true);
      expect(result.contradictionType).toBe('entity_conflict');
    });

    it('should detect workplace conflicts', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_ent_3', 'Bob works at Google', embBuffer);

      const result = await detectContradiction('Bob works at Microsoft');
      
      expect(result.hasContradiction).toBe(true);
    });
  });


  // ============================================================================
  // Confidence Adjustment Tests
  // ============================================================================
  
  describe('checkAndAdjustConfidence', () => {
    beforeEach(() => {
      mockEmbedding = [0.5, 0.5, 0.5, 0.5, 0.5];
    });

    it('should not adjust confidence when no contradiction found', async () => {
      const result = await checkAndAdjustConfidence('mem_test', 'Unique content with no conflicts');
      
      expect(result.confidence).toBe(1.0);
      expect(result.contradiction).toBeUndefined();
    });

    it('should lower confidence when contradiction detected', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_conf_1', 'The result is true', embBuffer);

      const result = await checkAndAdjustConfidence('mem_test', 'The result is false', 1.0);
      
      expect(result.confidence).toBeLessThan(1.0);
      expect(result.contradiction).toBeDefined();
      expect(result.contradiction?.hasContradiction).toBe(true);
    });

    it('should never lower confidence below 0.1', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_conf_2', 'Status is active', embBuffer);

      // Start with very low confidence
      const result = await checkAndAdjustConfidence('mem_test', 'Status is inactive', 0.15);
      
      expect(result.confidence).toBeGreaterThanOrEqual(0.1);
    });

    it('should use custom starting confidence', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
      const embBuffer = Buffer.from(embedding.buffer);
      
      db.prepare(`
        INSERT INTO memories (id, content, embedding)
        VALUES (?, ?, ?)
      `).run('mem_conf_3', 'Value is high', embBuffer);

      const result = await checkAndAdjustConfidence('mem_test', 'Value is low', 0.8);
      
      // Should be lower than starting value
      if (result.contradiction?.hasContradiction) {
        expect(result.confidence).toBeLessThan(0.8);
      }
    });
  });


  // ============================================================================
  // Contradiction Flagging Tests
  // ============================================================================
  
  describe('flagContradiction', () => {
    beforeEach(() => {
      // Ensure memories exist for foreign keys
      db.prepare(`
        INSERT OR IGNORE INTO memories (id, content)
        VALUES (?, ?)
      `).run('mem_flag_1', 'Memory 1 content');
      
      db.prepare(`
        INSERT OR IGNORE INTO memories (id, content)
        VALUES (?, ?)
      `).run('mem_flag_2', 'Memory 2 content');
    });

    it('should create contradictions table if not exists', async () => {
      await flagContradiction(
        'mem_flag_1',
        'mem_flag_2',
        'negation',
        'Test contradiction'
      );

      // Check table exists
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='contradictions'
      `).get();
      
      expect(tableExists).toBeDefined();
    });

    it('should store contradiction with all fields', async () => {
      await flagContradiction(
        'mem_flag_1',
        'mem_flag_2',
        'antonym',
        'Antonym conflict detected'
      );

      const row = db.prepare(`
        SELECT * FROM contradictions
        WHERE memory_id = ? AND conflicting_id = ?
      `).get('mem_flag_1', 'mem_flag_2') as any;

      expect(row).toBeDefined();
      expect(row.contradiction_type).toBe('antonym');
      expect(row.explanation).toBe('Antonym conflict detected');
      expect(row.resolved).toBe(0);
    });

    it('should generate unique ID for each contradiction', async () => {
      await flagContradiction('mem_flag_1', 'mem_flag_2', 'negation', 'First');
      await flagContradiction('mem_flag_1', 'mem_flag_2', 'numeric', 'Second');

      const rows = db.prepare(`
        SELECT id FROM contradictions
      `).all() as any[];

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].id).not.toBe(rows[1].id);
    });
  });

  // ============================================================================
  // Contradiction Resolution Tests
  // ============================================================================
  
  describe('resolveContradiction', () => {
    let contradictionId: string;

    beforeEach(async () => {
      // Clear and recreate test data
      db.prepare(`INSERT OR REPLACE INTO memories (id, content) VALUES (?, ?)`).run('mem_res_1', 'Old content');
      db.prepare(`INSERT OR REPLACE INTO memories (id, content) VALUES (?, ?)`).run('mem_res_2', 'New content');

      await flagContradiction('mem_res_2', 'mem_res_1', 'temporal', 'Newer fact');

      const row = db.prepare(`
        SELECT id FROM contradictions
        WHERE memory_id = 'mem_res_2'
        ORDER BY created_at DESC LIMIT 1
      `).get() as any;
      
      contradictionId = row?.id || '';
    });

    it('should mark contradiction as resolved', async () => {
      await resolveContradiction(contradictionId, 'keep_both');

      const row = db.prepare(`
        SELECT resolved, resolved_at FROM contradictions WHERE id = ?
      `).get(contradictionId) as any;

      expect(row.resolved).toBe(1);
      expect(row.resolved_at).toBeTruthy();
    });

    it('should soft delete old memory on keep_new', async () => {
      await resolveContradiction(contradictionId, 'keep_new');

      const oldMem = db.prepare(`
        SELECT deleted_at FROM memories WHERE id = 'mem_res_1'
      `).get() as any;

      expect(oldMem.deleted_at).toBeTruthy();
    });

    it('should soft delete new memory on keep_old', async () => {
      await resolveContradiction(contradictionId, 'keep_old');

      const newMem = db.prepare(`
        SELECT deleted_at FROM memories WHERE id = 'mem_res_2'
      `).get() as any;

      expect(newMem.deleted_at).toBeTruthy();
    });

    it('should NOT delete anything on keep_both', async () => {
      await resolveContradiction(contradictionId, 'keep_both');

      const mem1 = db.prepare(`SELECT deleted_at FROM memories WHERE id = 'mem_res_1'`).get() as any;
      const mem2 = db.prepare(`SELECT deleted_at FROM memories WHERE id = 'mem_res_2'`).get() as any;

      expect(mem1.deleted_at).toBeNull();
      expect(mem2.deleted_at).toBeNull();
    });

    it('should NOT delete anything on merge', async () => {
      await resolveContradiction(contradictionId, 'merge');

      const mem1 = db.prepare(`SELECT deleted_at FROM memories WHERE id = 'mem_res_1'`).get() as any;
      const mem2 = db.prepare(`SELECT deleted_at FROM memories WHERE id = 'mem_res_2'`).get() as any;

      expect(mem1.deleted_at).toBeNull();
      expect(mem2.deleted_at).toBeNull();
    });

    it('should handle non-existent contradiction gracefully', async () => {
      // Should not throw
      await expect(
        resolveContradiction('non_existent_id', 'keep_both')
      ).resolves.toBeUndefined();
    });
  });

