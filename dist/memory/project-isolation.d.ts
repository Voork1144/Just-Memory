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
/**
 * Special project IDs
 */
export declare const GLOBAL_PROJECT_ID = "__global__";
export declare const UNKNOWN_PROJECT_ID = "__unknown__";
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
 * Auto-detect project from a path
 *
 * Detection priority:
 * 1. Git repository (.git)
 * 2. Node.js project (package.json)
 * 3. Python project (pyproject.toml, setup.py)
 * 4. Rust project (Cargo.toml)
 * 5. Fallback to directory name
 */
export declare function detectProject(fromPath?: string): ProjectInfo;
/**
 * Create a global project info (for cross-project memories)
 */
export declare function getGlobalProject(): ProjectInfo;
/**
 * Set the current project context
 */
export declare function setProjectContext(project: ProjectInfo | null): void;
/**
 * Get the current project context
 * Auto-detects if not set
 */
export declare function getProjectContext(): ProjectInfo;
/**
 * Set whether to include global memories in queries
 */
export declare function setIncludeGlobal(include: boolean): void;
/**
 * Get whether global memories are included
 */
export declare function getIncludeGlobal(): boolean;
/**
 * Update the working directory (triggers re-detection on next query)
 */
export declare function setWorkingDirectory(dir: string): void;
/**
 * Get current working directory
 */
export declare function getWorkingDirectory(): string;
/**
 * Reset session context to defaults
 */
export declare function resetContext(): void;
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
export declare function buildProjectFilter(options?: ProjectQueryOptions, columnName?: string): {
    clause: string;
    params: unknown[];
};
/**
 * Resolve project ID for storing a new memory
 *
 * If no project ID provided:
 * - Use current session project
 * - If storing as "global", use GLOBAL_PROJECT_ID
 */
export declare function resolveProjectIdForStore(explicitProjectId?: string, isGlobal?: boolean): string;
/**
 * Check if a project ID represents the global namespace
 */
export declare function isGlobalProject(projectId: string | null | undefined): boolean;
/**
 * Get display name for a project ID
 */
export declare function getProjectDisplayName(projectId: string | null | undefined): string;
/**
 * List all known projects from the database
 */
export declare function listKnownProjects(db: {
    prepare: (sql: string) => {
        all: () => unknown[];
    };
}): Array<{
    projectId: string;
    count: number;
}>;
//# sourceMappingURL=project-isolation.d.ts.map