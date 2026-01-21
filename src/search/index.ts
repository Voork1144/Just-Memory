/**
 * Search Module Exports
 * Async ripgrep-powered file and content search
 */

export * from './types.js';
export {
  startSearch,
  stopSearch,
  getResults,
  getSession,
  listSessions as listSearchSessions,
  generateSessionId,
  cleanupSessions,
} from './ripgrep.js';

// Re-export for convenience
import {
  startSearch as _startSearch,
  stopSearch as _stopSearch,
  getResults as _getResults,
} from './ripgrep.js';

import type {
  SearchOptions,
  StartSearchResult,
  GetResultsOptions,
  GetResultsResult,
  StopSearchResult,
} from './types.js';

/**
 * MCP Tool: start_search
 * Start an async ripgrep search
 */
export async function startSearchTool(options: SearchOptions): Promise<StartSearchResult> {
  const session = _startSearch({
    ...options,
    searchType: options.searchType || 'content',
    ignoreCase: options.ignoreCase ?? true,
    maxResults: options.maxResults ?? 1000,
    timeout: options.timeout ?? 30000,
  });
  
  // Give ripgrep a moment to start
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return {
    sessionId: session.id,
    status: session.status,
    message: session.status === 'running' 
      ? `Search started. Use get_search_results to retrieve results.`
      : session.error || 'Search completed immediately',
  };
}

/**
 * MCP Tool: get_search_results
 * Get paginated results from a search session
 */
export async function getSearchResultsTool(options: GetResultsOptions): Promise<GetResultsResult> {
  const { sessionId, offset = 0, limit = 50 } = options;
  
  const { session, results } = _getResults(sessionId, offset, limit);
  
  if (!session) {
    throw new Error(`Search session not found: ${sessionId}`);
  }
  
  const runtime = session.endTime 
    ? session.endTime - session.startTime 
    : Date.now() - session.startTime;
  
  return {
    sessionId,
    status: session.status,
    results,
    totalResults: session.totalResults,
    hasMore: offset + results.length < session.totalResults,
    runtime,
  };
}

/**
 * MCP Tool: stop_search
 * Cancel a running search
 */
export async function stopSearchTool(sessionId: string): Promise<StopSearchResult> {
  const session = _stopSearch(sessionId);
  
  if (!session) {
    throw new Error(`Search session not found: ${sessionId}`);
  }
  
  return {
    sessionId,
    status: session.status,
    totalResults: session.totalResults,
    message: session.status === 'cancelled' 
      ? 'Search cancelled successfully'
      : `Search was already ${session.status}`,
  };
}
