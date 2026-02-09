/**
 * Tests for src/claude-md-template.ts
 * CLAUDE.md auto-generation: template content & ensureClaudeMd behavior.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateClaudeMd, ensureClaudeMd } from '../src/claude-md-template.js';

// ── Template content ─────────────────────────────────────────────────

describe('generateClaudeMd', () => {
  it('should return a non-empty string', () => {
    const md = generateClaudeMd();
    assert.ok(md.length > 0);
  });

  it('should contain the auto-generated marker', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('<!-- just-memory-auto-generated -->'));
  });

  it('should contain session start instructions', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('memory_briefing'));
    assert.ok(md.includes('in_progress_task'));
  });

  it('should contain mandatory memory recording section', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('MANDATORY Memory Recording'));
    assert.ok(md.includes('memory_store'));
    assert.ok(md.includes('memory_task'));
  });

  it('should list all memory trigger points', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('At task start'));
    assert.ok(md.includes('error/fix cycle'));
    assert.ok(md.includes('research or discovery'));
    assert.ok(md.includes('At task completion'));
  });

  it('should contain the what-to-store list', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('Every error message'));
    assert.ok(md.includes('Every workaround'));
    assert.ok(md.includes('Task goals and specs'));
    assert.ok(md.includes('User given tasks'));
    assert.ok(md.includes('User preferences'));
    assert.ok(md.includes('Research findings'));
    assert.ok(md.includes('Assets knowledge'));
  });

  it('should contain memory types table', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('fact'));
    assert.ok(md.includes('decision'));
    assert.ok(md.includes('procedure'));
    assert.ok(md.includes('preference'));
    assert.ok(md.includes('observation'));
  });

  it('should contain tool quick reference with all categories', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('Core Memory'));
    assert.ok(md.includes('Session & Recovery'));
    assert.ok(md.includes('Knowledge Graph'));
    assert.ok(md.includes('Utilities'));
  });

  it('should reference all 23 tools', () => {
    const md = generateClaudeMd();
    const tools = [
      'memory_store', 'memory_recall', 'memory_update', 'memory_delete',
      'memory_search', 'memory_list', 'memory_find_contradictions',
      'memory_briefing', 'memory_task', 'memory_scratch',
      'memory_entity', 'memory_edge', 'memory_confidence', 'memory_contradictions',
      'memory_suggest', 'memory_stats', 'memory_project', 'memory_scheduled',
      'memory_chat', 'memory_backup', 'memory_tool_history',
      'memory_rebuild_embeddings', 'memory_health',
    ];
    for (const tool of tools) {
      assert.ok(md.includes(tool), `Template should mention ${tool}`);
    }
  });

  it('should contain task tracking crash recovery section', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('Task Tracking'));
    assert.ok(md.includes('Crash Recovery'));
    assert.ok(md.includes('action: "set"'));
    assert.ok(md.includes('action: "update"'));
    assert.ok(md.includes('action: "clear"'));
  });
});

// ── ensureClaudeMd ───────────────────────────────────────────────────

describe('ensureClaudeMd', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jm-claude-md-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null when projectPath is null', () => {
    const result = ensureClaudeMd(null);
    assert.strictEqual(result, null);
  });

  it('should create CLAUDE.md when missing', () => {
    const result = ensureClaudeMd(tmpDir);
    assert.strictEqual(result, 'created');

    const filePath = join(tmpDir, 'CLAUDE.md');
    assert.ok(existsSync(filePath));

    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('Just-Memory'));
    assert.ok(content.includes('<!-- just-memory-auto-generated -->'));
  });

  it('should skip when CLAUDE.md already contains Just-Memory', () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    writeFileSync(filePath, '# My Project\n\nUses Just-Memory for persistence.\n');

    const result = ensureClaudeMd(tmpDir);
    assert.strictEqual(result, 'skipped');

    // Content should be unchanged
    const content = readFileSync(filePath, 'utf-8');
    assert.ok(!content.includes('<!-- just-memory-auto-generated -->'));
  });

  it('should skip when CLAUDE.md contains just-memory (lowercase)', () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    writeFileSync(filePath, '# Setup\n\nInstall just-memory MCP server.\n');

    const result = ensureClaudeMd(tmpDir);
    assert.strictEqual(result, 'skipped');
  });

  it('should skip when CLAUDE.md contains the auto-generated marker', () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    writeFileSync(filePath, '<!-- just-memory-auto-generated -->\nold content');

    const result = ensureClaudeMd(tmpDir);
    assert.strictEqual(result, 'skipped');
  });

  it('should append when CLAUDE.md exists without Just-Memory content', () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    const originalContent = '# My Project\n\nThis is my existing CLAUDE.md.\n';
    writeFileSync(filePath, originalContent);

    const result = ensureClaudeMd(tmpDir);
    assert.strictEqual(result, 'appended');

    const content = readFileSync(filePath, 'utf-8');
    // Original content preserved
    assert.ok(content.startsWith(originalContent));
    // New content appended
    assert.ok(content.includes('<!-- just-memory-auto-generated -->'));
    assert.ok(content.includes('Just-Memory'));
  });

  it('should not overwrite existing content when appending', () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    const originalContent = '# Custom Rules\n\n- Rule 1: No emojis\n- Rule 2: Be concise\n';
    writeFileSync(filePath, originalContent);

    ensureClaudeMd(tmpDir);

    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('Rule 1: No emojis'));
    assert.ok(content.includes('Rule 2: Be concise'));
    assert.ok(content.includes('memory_briefing'));
  });

  it('should be idempotent — second call after create is a skip', () => {
    const first = ensureClaudeMd(tmpDir);
    assert.strictEqual(first, 'created');

    const second = ensureClaudeMd(tmpDir);
    assert.strictEqual(second, 'skipped');
  });

  it('should be idempotent — second call after append is a skip', () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    writeFileSync(filePath, '# Existing\n');

    const first = ensureClaudeMd(tmpDir);
    assert.strictEqual(first, 'appended');

    const second = ensureClaudeMd(tmpDir);
    assert.strictEqual(second, 'skipped');
  });
});
