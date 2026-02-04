/**
 * Just-Memory Project Isolation
 * 
 * Implements D15: Project isolation via project_id column
 * 
 * Features:
 * - Auto-detect project from git root, package.json, or directory markers
 * - Global namespace for cross-project memories
 * - Project context management for queries
 * - Session-based project state
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Special project IDs
 */
export const GLOBAL_PROJECT_ID = '__global__';
export const UNKNOWN_PROJECT_ID = '__unknown__';

/**
 * Project detection result
 */
export interface ProjectInfo {
  /** Unique project identifier (hash of root path) */
  id: string;
  
  /** Human-readable project name */
  name: string;
  
  /** Absolute path to project root */
  rootPath: string;
  
  /** How the project was detected */
  detectionMethod: 'git' | 'package.json' | 'pyproject.toml' | 'cargo.toml' | 'directory' | 'explicit' | 'global';
  
  /** Optional version from package manager */
  version?: string;
  
  /** Optional description */
  description?: string;
}

/**
 * Current session context
 */
interface SessionContext {
  currentProject: ProjectInfo | null;
  workingDirectory: string;
  includeGlobal: boolean;
}

/**
 * Module-level session state
 */
let sessionContext: SessionContext = {
  currentProject: null,
  workingDirectory: process.cwd(),
  includeGlobal: true,
};

// =============================================================================
// Project Detection Functions
// =============================================================================

/**
 * Find the closest directory containing a marker file
 */
function findProjectRoot(startPath: string, markers: string[]): string | null {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;
  
  while (current !== root) {
    for (const marker of markers) {
      const markerPath = path.join(current, marker);
      if (fs.existsSync(markerPath)) {
        return current;
      }
    }
    current = path.dirname(current);
  }
  
  return null;
}

/**
 * Generate a stable project ID from the root path
 */
function generateProjectId(rootPath: string): string {
  const normalized = path.normalize(rootPath).toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Detect project from a git repository
 */
function detectGitProject(startPath: string): ProjectInfo | null {
  const gitRoot = findProjectRoot(startPath, ['.git']);
  if (!gitRoot) return null;
  
  // Try to get project name from remote or directory
  let name = path.basename(gitRoot);
  
  // Try to read .git/config for remote name
  const gitConfigPath = path.join(gitRoot, '.git', 'config');
  if (fs.existsSync(gitConfigPath)) {
    try {
      const config = fs.readFileSync(gitConfigPath, 'utf-8');
      const urlMatch = config.match(/url\s*=\s*.*[/:]([\w.-]+?)(?:\.git)?$/m);
      if (urlMatch && urlMatch[1]) {
        name = urlMatch[1];
      }
    } catch {
      // Ignore config read errors
    }
  }
  
  return {
    id: generateProjectId(gitRoot),
    name,
    rootPath: gitRoot,
    detectionMethod: 'git',
  };
}

/**
 * Detect project from package.json (Node.js/JavaScript)
 */
function detectNodeProject(startPath: string): ProjectInfo | null {
  const projectRoot = findProjectRoot(startPath, ['package.json']);
  if (!projectRoot) return null;
  
  const packagePath = path.join(projectRoot, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    return {
      id: generateProjectId(projectRoot),
      name: pkg.name || path.basename(projectRoot),
      rootPath: projectRoot,
      detectionMethod: 'package.json',
      version: pkg.version,
      description: pkg.description,
    };
  } catch {
    return null;
  }
}

/**
 * Detect project from pyproject.toml (Python)
 */
function detectPythonProject(startPath: string): ProjectInfo | null {
  const projectRoot = findProjectRoot(startPath, ['pyproject.toml', 'setup.py', 'setup.cfg']);
  if (!projectRoot) return null;
  
  let name = path.basename(projectRoot);
  let version: string | undefined;
  let description: string | undefined;
  
  // Try to read pyproject.toml
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      const versionMatch = content.match(/^version\s*=\s*"([^"]+)"/m);
      const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
      
      if (nameMatch && nameMatch[1]) name = nameMatch[1];
      if (versionMatch && versionMatch[1]) version = versionMatch[1];
      if (descMatch && descMatch[1]) description = descMatch[1];
    } catch {
      // Ignore parse errors
    }
  }
  
  return {
    id: generateProjectId(projectRoot),
    name,
    rootPath: projectRoot,
    detectionMethod: 'pyproject.toml',
    version,
    description,
  };
}

/**
 * Detect project from Cargo.toml (Rust)
 */
function detectRustProject(startPath: string): ProjectInfo | null {
  const projectRoot = findProjectRoot(startPath, ['Cargo.toml']);
  if (!projectRoot) return null;
  
  let name = path.basename(projectRoot);
  let version: string | undefined;
  let description: string | undefined;
  
  const cargoPath = path.join(projectRoot, 'Cargo.toml');
  try {
    const content = fs.readFileSync(cargoPath, 'utf-8');
    const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
    const versionMatch = content.match(/^version\s*=\s*"([^"]+)"/m);
    const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
    
    if (nameMatch && nameMatch[1]) name = nameMatch[1];
    if (versionMatch && versionMatch[1]) version = versionMatch[1];
    if (descMatch && descMatch[1]) description = descMatch[1];
  } catch {
    // Ignore parse errors
  }
  
  return {
    id: generateProjectId(projectRoot),
    name,
    rootPath: projectRoot,
    detectionMethod: 'cargo.toml',
    version,
    description,
  };
}

/**
 * Detect project from working directory as fallback
 */
function detectDirectoryProject(startPath: string): ProjectInfo {
  const resolved = path.resolve(startPath);
  return {
    id: generateProjectId(resolved),
    name: path.basename(resolved),
    rootPath: resolved,
    detectionMethod: 'directory',
  };
}

/**
 * Auto-detect project from a path
 * 
 * Detection priority:
 * 1. Git repository (.git)
 * 2. Node.js project (package.json)
 * 3. Python project (pyproject.toml, setup.py)
 * 4. Rust project (Cargo.toml)
 * 5. Fallback to directory name
 */
export function detectProject(fromPath?: string): ProjectInfo {
  const startPath = fromPath || process.cwd();
  
  // Try each detection method in priority order
  let project: ProjectInfo | null = null;
  
  // 1. Git (most reliable for project boundaries)
  project = detectGitProject(startPath);
  if (project) return project;
  
  // 2. Node.js
  project = detectNodeProject(startPath);
  if (project) return project;
  
  // 3. Python
  project = detectPythonProject(startPath);
  if (project) return project;
  
  // 4. Rust
  project = detectRustProject(startPath);
  if (project) return project;
  
  // 5. Fallback to directory
  return detectDirectoryProject(startPath);
}

/**
 * Create a global project info (for cross-project memories)
 */
export function getGlobalProject(): ProjectInfo {
  return {
    id: GLOBAL_PROJECT_ID,
    name: 'Global',
    rootPath: '',
    detectionMethod: 'global',
    description: 'Cross-project global memories',
  };
}

// =============================================================================
// Session Context Management
// =============================================================================

/**
 * Set the current project context
 */
export function setProjectContext(project: ProjectInfo | null): void {
  sessionContext.currentProject = project;
}

/**
 * Get the current project context
 * Auto-detects if not set
 */
export function getProjectContext(): ProjectInfo {
  if (!sessionContext.currentProject) {
    sessionContext.currentProject = detectProject(sessionContext.workingDirectory);
  }
  return sessionContext.currentProject;
}

/**
 * Set whether to include global memories in queries
 */
export function setIncludeGlobal(include: boolean): void {
  sessionContext.includeGlobal = include;
}

/**
 * Get whether global memories are included
 */
export function getIncludeGlobal(): boolean {
  return sessionContext.includeGlobal;
}

/**
 * Update the working directory (triggers re-detection on next query)
 */
export function setWorkingDirectory(dir: string): void {
  sessionContext.workingDirectory = dir;
  sessionContext.currentProject = null; // Force re-detection
}

/**
 * Get current working directory
 */
export function getWorkingDirectory(): string {
  return sessionContext.workingDirectory;
}

/**
 * Reset session context to defaults
 */
export function resetContext(): void {
  sessionContext = {
    currentProject: null,
    workingDirectory: process.cwd(),
    includeGlobal: true,
  };
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Options for building project-aware queries
 */
export interface ProjectQueryOptions {
  /** Specific project ID to filter by */
  projectId?: string;
  
  /** Include global memories */
  includeGlobal?: boolean;
  
  /** Query all projects (admin/cross-project search) */
  allProjects?: boolean;
}

/**
 * Build SQL WHERE clause for project filtering
 * 
 * Returns { clause: string, params: unknown[] }
 */
export function buildProjectFilter(
  options: ProjectQueryOptions = {},
  columnName: string = 'project_id'
): { clause: string; params: unknown[] } {
  // If querying all projects, no filter needed
  if (options.allProjects) {
    return { clause: '1=1', params: [] };
  }
  
  const includeGlobal = options.includeGlobal ?? sessionContext.includeGlobal;
  const projectId = options.projectId ?? getProjectContext().id;
  
  if (includeGlobal) {
    // Include both project-specific and global memories
    return {
      clause: `(${columnName} = ? OR ${columnName} = ? OR ${columnName} IS NULL)`,
      params: [projectId, GLOBAL_PROJECT_ID],
    };
  } else {
    // Only project-specific memories
    return {
      clause: `${columnName} = ?`,
      params: [projectId],
    };
  }
}

/**
 * Resolve project ID for storing a new memory
 * 
 * If no project ID provided:
 * - Use current session project
 * - If storing as "global", use GLOBAL_PROJECT_ID
 */
export function resolveProjectIdForStore(
  explicitProjectId?: string,
  isGlobal: boolean = false
): string {
  if (isGlobal) {
    return GLOBAL_PROJECT_ID;
  }
  
  if (explicitProjectId) {
    return explicitProjectId;
  }
  
  return getProjectContext().id;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a project ID represents the global namespace
 */
export function isGlobalProject(projectId: string | null | undefined): boolean {
  return projectId === GLOBAL_PROJECT_ID;
}

/**
 * Get display name for a project ID
 */
export function getProjectDisplayName(projectId: string | null | undefined): string {
  if (!projectId) return 'Unknown';
  if (projectId === GLOBAL_PROJECT_ID) return 'Global';
  if (projectId === UNKNOWN_PROJECT_ID) return 'Unknown';
  
  // If we have the current project cached and it matches, use its name
  if (sessionContext.currentProject?.id === projectId) {
    return sessionContext.currentProject.name;
  }
  
  // Otherwise return the ID (could be enhanced to look up from database)
  return projectId.slice(0, 8);
}

/**
 * List all known projects from the database
 */
export function listKnownProjects(db: { prepare: (sql: string) => { all: () => unknown[] } }): Array<{ projectId: string; count: number }> {
  const rows = db.prepare(`
    SELECT project_id, COUNT(*) as count
    FROM memories
    WHERE deleted_at IS NULL AND project_id IS NOT NULL
    GROUP BY project_id
    ORDER BY count DESC
  `).all() as Array<{ project_id: string; count: number }>;
  
  return rows.map(row => ({
    projectId: row.project_id,
    count: row.count,
  }));
}
