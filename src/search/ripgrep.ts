/**
 * Ripgrep Integration
 * Fast async search using @vscode/ripgrep
 */

import { spawn, type ChildProcess } from 'child_process';
import { rgPath } from '@vscode/ripgrep';
import type { SearchOptions, SearchMatch, SearchSession } from './types.js';

// Map to store active search sessions
const searchSessions = new Map<string, SearchSession>();

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Get a search session by ID
 */
export function getSession(sessionId: string): SearchSession | undefined {
  return searchSessions.get(sessionId);
}

/**
 * List all active sessions
 */
export function listSessions(): SearchSession[] {
  return Array.from(searchSessions.values());
}

/**
 * Clean up old sessions (older than 5 minutes)
 */
export function cleanupSessions(): void {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  for (const [id, session] of searchSessions) {
    if (session.status !== 'running' && session.endTime && (now - session.endTime) > maxAge) {
      searchSessions.delete(id);
    }
  }
}

/**
 * Parse ripgrep JSON output line
 */
function parseRgLine(line: string): SearchMatch | null {
  try {
    const json = JSON.parse(line);
    
    if (json.type === 'match') {
      const data = json.data;
      return {
        path: data.path.text,
        line: data.line_number,
        column: data.submatches?.[0]?.start ?? 0,
        content: data.lines.text.trimEnd(),
        beforeContext: [],
        afterContext: [],
      };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Build ripgrep arguments from options
 */
function buildRgArgs(options: SearchOptions): string[] {
  const args: string[] = [
    '--json',
    '--line-number',
    '--column',
  ];
  
  // Search type
  if (options.searchType === 'files') {
    args.push('--files');
    args.push('--glob', `*${options.pattern}*`);
  } else {
    // Content search
    if (options.literalSearch) {
      args.push('--fixed-strings');
    }
    args.push(options.pattern);
  }
  
  // Case sensitivity
  if (options.ignoreCase) {
    args.push('--ignore-case');
  }
  
  // Hidden files
  if (options.includeHidden) {
    args.push('--hidden');
  }
  
  // File pattern filter
  if (options.filePattern) {
    args.push('--glob', options.filePattern);
  }
  
  // Context lines
  if (options.contextLines && options.contextLines > 0) {
    args.push('--context', String(options.contextLines));
  }
  
  // Max results
  if (options.maxResults) {
    args.push('--max-count', String(options.maxResults));
  }
  
  // Search path
  args.push(options.path);
  
  return args;
}

/**
 * Start an async search
 */
export function startSearch(options: SearchOptions): SearchSession {
  const sessionId = generateSessionId();
  
  // Clean up old sessions first
  cleanupSessions();
  
  const session: SearchSession = {
    id: sessionId,
    status: 'running',
    options,
    results: [],
    totalResults: 0,
    startTime: Date.now(),
  };
  
  searchSessions.set(sessionId, session);
  
  try {
    const args = buildRgArgs(options);
    const rgProcess = spawn(rgPath, args, {
      cwd: options.path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    session.process = rgProcess;
    
    let buffer = '';
    
    rgProcess.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          const match = parseRgLine(line);
          if (match) {
            session.results.push(match);
            session.totalResults++;
          }
        }
      }
    });
    
    rgProcess.stderr.on('data', (data: Buffer) => {
      // Log errors but don't fail the search
      console.error(`[search] ripgrep stderr: ${data.toString()}`);
    });
    
    rgProcess.on('close', (code) => {
      session.endTime = Date.now();
      
      // Process any remaining buffer
      if (buffer.trim()) {
        const match = parseRgLine(buffer);
        if (match) {
          session.results.push(match);
          session.totalResults++;
        }
      }
      
      if (session.status === 'running') {
        session.status = code === 0 || code === 1 ? 'completed' : 'error';
        if (code !== 0 && code !== 1) {
          session.error = `ripgrep exited with code ${code}`;
        }
      }
      
      delete session.process;
    });
    
    rgProcess.on('error', (err) => {
      session.status = 'error';
      session.error = err.message;
      session.endTime = Date.now();
      delete session.process;
    });
    
    // Timeout handling
    if (options.timeout) {
      setTimeout(() => {
        if (session.status === 'running' && session.process) {
          session.process.kill('SIGTERM');
          session.status = 'completed';
          session.endTime = Date.now();
        }
      }, options.timeout);
    }
    
  } catch (err) {
    session.status = 'error';
    session.error = err instanceof Error ? err.message : 'Unknown error';
    session.endTime = Date.now();
  }
  
  return session;
}

/**
 * Stop a running search
 */
export function stopSearch(sessionId: string): SearchSession | null {
  const session = searchSessions.get(sessionId);
  
  if (!session) {
    return null;
  }
  
  if (session.status === 'running' && session.process) {
    session.process.kill('SIGTERM');
    session.status = 'cancelled';
    session.endTime = Date.now();
    delete session.process;
  }
  
  return session;
}

/**
 * Get results from a search session with pagination
 */
export function getResults(
  sessionId: string,
  offset: number = 0,
  limit: number = 50
): { session: SearchSession | null; results: SearchMatch[] } {
  const session = searchSessions.get(sessionId);
  
  if (!session) {
    return { session: null, results: [] };
  }
  
  const results = session.results.slice(offset, offset + limit);
  
  return { session, results };
}
