/**
 * Tests for src/claude-md-template.ts
 * CLAUDE.md auto-generation: template content & ensureClaudeMd behavior.
 *
 * ensureClaudeMd writes to ~/.claude/CLAUDE.md (user preferences).
 * Tests override HOME env to redirect to a temp directory.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateClaudeMd, ensureClaudeMd, removeClaudeMd } from '../src/claude-md-template.js';

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

  it('should contain the hard enforcement rule', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('HARD RULE: Memory Storage Enforcement'));
    assert.ok(md.includes('DO NOT rationalize skipping'));
    assert.ok(md.includes('Too simple'));
    assert.ok(md.includes('Failure mode to avoid'));
  });

  it('should contain both start and end markers', () => {
    const md = generateClaudeMd();
    assert.ok(md.includes('<!-- just-memory-auto-generated -->'));
    assert.ok(md.includes('<!-- /just-memory-auto-generated -->'));
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
// ensureClaudeMd writes to ~/.claude/CLAUDE.md. We override HOME to
// redirect to a temp directory so tests don't touch the real user config.

describe('ensureClaudeMd', () => {
  let tmpHome: string;
  let originalHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'jm-claude-md-test-'));
    originalHome = process.env['HOME'] ?? '';
    process.env['HOME'] = tmpHome;
  });

  afterEach(() => {
    process.env['HOME'] = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('should create ~/.claude/CLAUDE.md when missing', () => {
    const result = ensureClaudeMd();
    assert.strictEqual(result, 'created');

    const filePath = join(tmpHome, '.claude', 'CLAUDE.md');
    assert.ok(existsSync(filePath));

    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('Just-Memory'));
    assert.ok(content.includes('<!-- just-memory-auto-generated -->'));
  });

  it('should create .claude directory if it does not exist', () => {
    const claudeDir = join(tmpHome, '.claude');
    assert.ok(!existsSync(claudeDir));

    ensureClaudeMd();

    assert.ok(existsSync(claudeDir));
    assert.ok(existsSync(join(claudeDir, 'CLAUDE.md')));
  });

  it('should skip when CLAUDE.md already contains Just-Memory', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const filePath = join(claudeDir, 'CLAUDE.md');
    writeFileSync(filePath, '# My Project\n\nUses Just-Memory for persistence.\n');

    const result = ensureClaudeMd();
    assert.strictEqual(result, 'skipped');

    // Content should be unchanged
    const content = readFileSync(filePath, 'utf-8');
    assert.ok(!content.includes('<!-- just-memory-auto-generated -->'));
  });

  it('should skip when CLAUDE.md contains just-memory (lowercase)', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const filePath = join(claudeDir, 'CLAUDE.md');
    writeFileSync(filePath, '# Setup\n\nInstall just-memory MCP server.\n');

    const result = ensureClaudeMd();
    assert.strictEqual(result, 'skipped');
  });

  it('should skip when CLAUDE.md contains the auto-generated marker', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const filePath = join(claudeDir, 'CLAUDE.md');
    writeFileSync(filePath, '<!-- just-memory-auto-generated -->\nold content');

    const result = ensureClaudeMd();
    assert.strictEqual(result, 'skipped');
  });

  it('should append when CLAUDE.md exists without Just-Memory content', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const filePath = join(claudeDir, 'CLAUDE.md');
    const originalContent = '# My Project\n\nThis is my existing CLAUDE.md.\n';
    writeFileSync(filePath, originalContent);

    const result = ensureClaudeMd();
    assert.strictEqual(result, 'appended');

    const content = readFileSync(filePath, 'utf-8');
    // Original content preserved
    assert.ok(content.startsWith(originalContent));
    // New content appended
    assert.ok(content.includes('<!-- just-memory-auto-generated -->'));
    assert.ok(content.includes('HARD RULE'));
  });

  it('should not overwrite existing content when appending', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const filePath = join(claudeDir, 'CLAUDE.md');
    const originalContent = '# Custom Rules\n\n- Rule 1: No emojis\n- Rule 2: Be concise\n';
    writeFileSync(filePath, originalContent);

    ensureClaudeMd();

    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('Rule 1: No emojis'));
    assert.ok(content.includes('Rule 2: Be concise'));
    assert.ok(content.includes('memory_briefing'));
  });

  it('should be idempotent — second call after create is a skip', () => {
    const first = ensureClaudeMd();
    assert.strictEqual(first, 'created');

    const second = ensureClaudeMd();
    assert.strictEqual(second, 'skipped');
  });

  it('should be idempotent — second call after append is a skip', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'CLAUDE.md'), '# Existing\n');

    const first = ensureClaudeMd();
    assert.strictEqual(first, 'appended');

    const second = ensureClaudeMd();
    assert.strictEqual(second, 'skipped');
  });

  it('should accept legacy projectPath parameter without error', () => {
    // Backwards compatibility — parameter is accepted but ignored
    const result = ensureClaudeMd('/some/project/path');
    assert.strictEqual(result, 'created');

    // File should still be at ~/.claude/CLAUDE.md, not project path
    const filePath = join(tmpHome, '.claude', 'CLAUDE.md');
    assert.ok(existsSync(filePath));
  });
});

// ── removeClaudeMd ──────────────────────────────────────────────────

describe('removeClaudeMd', () => {
  let tmpHome: string;
  let originalHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'jm-claude-md-rm-test-'));
    originalHome = process.env['HOME'] ?? '';
    process.env['HOME'] = tmpHome;
  });

  afterEach(() => {
    process.env['HOME'] = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('should return skipped when no CLAUDE.md exists', () => {
    const result = removeClaudeMd();
    assert.strictEqual(result, 'skipped');
  });

  it('should return skipped when CLAUDE.md has no Just-Memory content', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'CLAUDE.md'), '# My custom rules\n\nNo memory stuff here.\n');

    const result = removeClaudeMd();
    assert.strictEqual(result, 'skipped');
  });

  it('should delete file when entirely auto-generated (with end marker)', () => {
    // Create via ensureClaudeMd
    ensureClaudeMd();
    const filePath = join(tmpHome, '.claude', 'CLAUDE.md');
    assert.ok(existsSync(filePath));

    const result = removeClaudeMd();
    assert.strictEqual(result, 'removed');
    assert.ok(!existsSync(filePath));
  });

  it('should clean only Just-Memory block when appended to existing content', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const filePath = join(claudeDir, 'CLAUDE.md');
    const userContent = '# My Custom Rules\n\n- Be concise\n- No emojis\n';
    writeFileSync(filePath, userContent);

    // Append Just-Memory content
    ensureClaudeMd();
    const beforeRemove = readFileSync(filePath, 'utf-8');
    assert.ok(beforeRemove.includes('Just-Memory'));

    // Remove
    const result = removeClaudeMd();
    assert.strictEqual(result, 'cleaned');

    // User content preserved, Just-Memory gone
    const afterRemove = readFileSync(filePath, 'utf-8');
    assert.ok(afterRemove.includes('My Custom Rules'));
    assert.ok(afterRemove.includes('Be concise'));
    assert.ok(!afterRemove.includes('<!-- just-memory-auto-generated -->'));
    assert.ok(!afterRemove.includes('memory_briefing'));
  });

  it('should handle old format without end marker', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const filePath = join(claudeDir, 'CLAUDE.md');
    // Simulate old format: only start marker, no end marker
    writeFileSync(filePath, '<!-- just-memory-auto-generated -->\n# Old Just-Memory content\nSome rules here\n');

    const result = removeClaudeMd();
    assert.strictEqual(result, 'removed');
    assert.ok(!existsSync(filePath));
  });

  it('should handle old format with user content before marker', () => {
    const claudeDir = join(tmpHome, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const filePath = join(claudeDir, 'CLAUDE.md');
    writeFileSync(filePath, '# User Rules\n\nBe helpful.\n\n<!-- just-memory-auto-generated -->\n# Old Just-Memory\n');

    const result = removeClaudeMd();
    assert.strictEqual(result, 'cleaned');

    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('User Rules'));
    assert.ok(!content.includes('just-memory-auto-generated'));
  });

  it('should be idempotent — second remove after remove is skipped', () => {
    ensureClaudeMd();
    const first = removeClaudeMd();
    assert.strictEqual(first, 'removed');

    const second = removeClaudeMd();
    assert.strictEqual(second, 'skipped');
  });
});
