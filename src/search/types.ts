/**
 * Search Module Types
 * Async ripgrep-powered search with session management
 */

export type SearchType = 'content' | 'files';

export interface SearchOptions {
  path: string;
  pattern: string;
  searchType?: SearchType;
  filePattern?: string;        // Glob filter (e.g., "*.ts")
  ignoreCase?: boolean;
  includeHidden?: boolean;
  maxResults?: number;
  contextLines?: number;       // Lines of context around matches
  literalSearch?: boolean;     // Treat pattern as literal string, not regex
  timeout?: number;            // Search timeout in ms
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  content: string;
  beforeContext?: string[];
  afterContext?: string[];
}

export interface SearchSession {
  id: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  options: SearchOptions;
  results: SearchMatch[];
  totalResults: number;
  startTime: number;
  endTime?: number;
  error?: string;
  process?: ReturnType<typeof import('child_process').spawn>;
}

export interface StartSearchResult {
  sessionId: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  message: string;
}

export interface GetResultsOptions {
  sessionId: string;
  offset?: number;
  limit?: number;
}

export interface GetResultsResult {
  sessionId: string;
  status: SearchSession['status'];
  results: SearchMatch[];
  totalResults: number;
  hasMore: boolean;
  runtime: number;
}

export interface StopSearchResult {
  sessionId: string;
  status: 'running' | 'cancelled' | 'completed' | 'error';
  totalResults: number;
  message: string;
}
