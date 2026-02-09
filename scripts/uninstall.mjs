#!/usr/bin/env node
/**
 * Just-Memory uninstall cleanup.
 * Removes auto-generated content from ~/.claude/CLAUDE.md.
 * Called via npm preuninstall hook.
 */
import { removeClaudeMd } from '../dist/claude-md-template.js';

const result = removeClaudeMd();
if (result === 'removed' || result === 'cleaned') {
  console.log(`[Just-Memory] Cleanup complete: ${result}`);
}
