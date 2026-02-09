/**
 * Just-Memory — CLAUDE.md Auto-Generation
 *
 * Generates a CLAUDE.md file for new projects with mandatory memory recording
 * rules and tool reference. Ensures Claude (or any LLM) uses Just-Memory
 * effectively from the first session.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MARKER = '<!-- just-memory-auto-generated -->';

/**
 * Generate the CLAUDE.md content for Just-Memory.
 * Returns the full markdown string.
 */
export function generateClaudeMd(): string {
  return `${MARKER}
# Just-Memory — Persistent Memory System

Just-Memory is an MCP server providing persistent memory across sessions: semantic search, knowledge graphs, contradiction detection, and crash recovery.

## Session Start (DO THIS FIRST)

1. Call \`memory_briefing\` to load context from previous sessions
2. Check \`in_progress_task\` — if present, you were mid-task and should resume
3. Review core memories, recent memories, and entities returned

**If you don't remember calling \`memory_briefing\` in this conversation, CALL IT IMMEDIATELY.** This happens after context compaction, retries, or session restarts.

## MANDATORY Memory Recording

Memory storage is NOT optional. Follow these rules every session:

**1. At task start** — store the goal:
\`\`\`
memory_task action: "set", description: "What the user asked for", total_steps: N
\`\`\`

**2. After every error/fix cycle** — store the finding immediately:
\`\`\`
memory_store type: "fact", content: "What broke + what fixed it", tags: [relevant-tags]
\`\`\`
Do NOT wait until the end. Store it the moment you solve the problem.

**3. After any research or discovery** — store what you learned:
- How an API/tool/system actually behaves (vs how you expected)
- Workarounds for limitations
- Configuration that took trial and error

**4. At task completion** — store the outcome:
\`\`\`
memory_store type: "fact", content: "What was accomplished, key decisions made", importance: 0.8+
memory_task action: "clear"
\`\`\`

**What to store (ALWAYS, no judgment calls needed):**
- Every error message + its fix
- Every workaround discovered
- Task goals and specs from the user
- User given tasks (what you were asked to do)
- Decisions made and why
- Configuration details
- Procedures that worked
- User preferences expressed
- Research findings
- Assets knowledge (images, docs, videos)

**Minimum:** 1 memory per task. If a task involved debugging, expect 2-5 memories.

## HARD RULE: Memory Storage Enforcement

**DO NOT rationalize skipping \`memory_store\`. There is NO task too trivial.**

Before you send your final response for ANY completed task, verify:
- Did I call \`memory_store\` with the user's task request/goal?
- Did I call \`memory_store\` with the outcome/result?
- Did I store every error + fix encountered?
- Did I store every user preference expressed?

If ANY answer is no, call \`memory_store\` NOW before responding.

**"Too simple" is NOT a valid reason to skip.** A user asking "make a webpage" is a task goal — store it. The file you created is an asset — store it. This is non-negotiable.

**Failure mode to avoid:** Seeing a simple task, deciding it's "not worth storing," and silently skipping \`memory_store\`. This defeats the entire purpose of Just-Memory. Users will not remind you. You must do this autonomously, every time, without prompting.

## Task Tracking (Crash Recovery)

Use \`memory_task\` so you can recover after context loss:

\`\`\`
# Starting a task
memory_task action: "set", description: "Implementing feature X", total_steps: 5

# After completing each step
memory_task action: "update", step: 1, step_description: "Created database schema"
memory_task action: "update", step: 2, step_description: "Added API endpoint"

# When done
memory_task action: "clear"
\`\`\`

## Memory Types

| Type | Use For |
|------|---------|
| \`fact\` | Verified information, error fixes, configurations |
| \`decision\` | Choices made and why |
| \`procedure\` | How to do something (steps, commands) |
| \`preference\` | User preferences |
| \`note\` | General observations |
| \`event\` | Things that happened (releases, deployments) |
| \`observation\` | Patterns noticed |

## Tool Quick Reference (23 tools)

### Core Memory
| Tool | Purpose |
|------|---------|
| \`memory_store\` | Store new memory (auto contradiction detection) |
| \`memory_recall\` | Get memory by ID (strengthens it) |
| \`memory_update\` | Modify memory content/tags/importance |
| \`memory_delete\` | Soft delete (permanent with flag) |
| \`memory_search\` | Hybrid keyword + semantic search |
| \`memory_list\` | List recent memories |
| \`memory_find_contradictions\` | Check for conflicts before storing |

### Session & Recovery
| Tool | Purpose |
|------|---------|
| \`memory_briefing\` | **CALL FIRST** — session context briefing |
| \`memory_task\` | Track current task (set/update/clear/get) |
| \`memory_scratch\` | Working memory scratchpad (set/get/delete/list/clear) |

### Knowledge Graph
| Tool | Purpose |
|------|---------|
| \`memory_entity\` | Entities (create/get/search/observe/link/delete) |
| \`memory_edge\` | Relationships between memories (create/query/invalidate) |
| \`memory_confidence\` | Adjust memory confidence (confirm/contradict) |
| \`memory_contradictions\` | Manage contradictions (scan/pending/resolve) |

### Utilities
| Tool | Purpose |
|------|---------|
| \`memory_suggest\` | Get suggestions based on context text |
| \`memory_stats\` | Memory statistics and counts |
| \`memory_project\` | Project context (list/set) |
| \`memory_scheduled\` | Task scheduling (schedule/list/check/complete/cancel) |
| \`memory_chat\` | Chat history ingestion (discover/ingest/search/stats) |
| \`memory_backup\` | Backup and restore (create/restore/list) |
| \`memory_tool_history\` | View recent tool calls |
| \`memory_rebuild_embeddings\` | Backfill or rebuild vector embeddings |
| \`memory_health\` | Server health check |
`;
}

/**
 * Ensure ~/.claude/CLAUDE.md contains Just-Memory instructions.
 *
 * Writes to user-level preferences (~/.claude/CLAUDE.md) so rules apply
 * globally across all projects — no per-project CLAUDE.md needed.
 *
 * - If ~/.claude/CLAUDE.md doesn't exist: creates it with the full template
 * - If it exists but doesn't mention Just-Memory: appends the template
 * - If it already has Just-Memory content: skips (no-op)
 *
 * The projectPath parameter is accepted for backwards compatibility but
 * is no longer used — rules always go to user preferences.
 *
 * Never throws — logs warnings to stderr on failure.
 * Returns: 'created' | 'appended' | 'skipped' | null
 */
export function ensureClaudeMd(_projectPath?: string | null): 'created' | 'appended' | 'skipped' | null {
  const claudeDir = join(homedir(), '.claude');
  const claudeMdPath = join(claudeDir, 'CLAUDE.md');

  try {
    // Ensure ~/.claude/ directory exists
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    if (existsSync(claudeMdPath)) {
      const existing = readFileSync(claudeMdPath, 'utf-8');

      // Already has Just-Memory content (either auto-generated or user-written)
      if (existing.includes('Just-Memory') || existing.includes('just-memory') || existing.includes(MARKER)) {
        return 'skipped';
      }

      // Existing CLAUDE.md without Just-Memory — append
      const template = generateClaudeMd();
      appendFileSync(claudeMdPath, '\n\n' + template);
      console.error(`[Just-Memory] Appended memory instructions to ${claudeMdPath}`);
      return 'appended';
    }

    // No CLAUDE.md — create
    const template = generateClaudeMd();
    writeFileSync(claudeMdPath, template);
    console.error(`[Just-Memory] Generated CLAUDE.md at ${claudeMdPath}`);
    return 'created';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Just-Memory] Could not write ~/.claude/CLAUDE.md: ${msg}`);
    return null;
  }
}
