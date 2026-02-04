"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNKNOWN_PROJECT_ID = exports.GLOBAL_PROJECT_ID = void 0;
exports.detectProject = detectProject;
exports.getGlobalProject = getGlobalProject;
exports.setProjectContext = setProjectContext;
exports.getProjectContext = getProjectContext;
exports.setIncludeGlobal = setIncludeGlobal;
exports.getIncludeGlobal = getIncludeGlobal;
exports.setWorkingDirectory = setWorkingDirectory;
exports.getWorkingDirectory = getWorkingDirectory;
exports.resetContext = resetContext;
exports.buildProjectFilter = buildProjectFilter;
exports.resolveProjectIdForStore = resolveProjectIdForStore;
exports.isGlobalProject = isGlobalProject;
exports.getProjectDisplayName = getProjectDisplayName;
exports.listKnownProjects = listKnownProjects;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
/**
 * Special project IDs
 */
exports.GLOBAL_PROJECT_ID = '__global__';
exports.UNKNOWN_PROJECT_ID = '__unknown__';
/**
 * Module-level session state
 */
let sessionContext = {
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
function findProjectRoot(startPath, markers) {
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
function generateProjectId(rootPath) {
    const normalized = path.normalize(rootPath).toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
/**
 * Detect project from a git repository
 */
function detectGitProject(startPath) {
    const gitRoot = findProjectRoot(startPath, ['.git']);
    if (!gitRoot)
        return null;
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
        }
        catch {
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
function detectNodeProject(startPath) {
    const projectRoot = findProjectRoot(startPath, ['package.json']);
    if (!projectRoot)
        return null;
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
    }
    catch {
        return null;
    }
}
/**
 * Detect project from pyproject.toml (Python)
 */
function detectPythonProject(startPath) {
    const projectRoot = findProjectRoot(startPath, ['pyproject.toml', 'setup.py', 'setup.cfg']);
    if (!projectRoot)
        return null;
    let name = path.basename(projectRoot);
    let version;
    let description;
    // Try to read pyproject.toml
    const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
        try {
            const content = fs.readFileSync(pyprojectPath, 'utf-8');
            const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
            const versionMatch = content.match(/^version\s*=\s*"([^"]+)"/m);
            const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
            if (nameMatch && nameMatch[1])
                name = nameMatch[1];
            if (versionMatch && versionMatch[1])
                version = versionMatch[1];
            if (descMatch && descMatch[1])
                description = descMatch[1];
        }
        catch {
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
function detectRustProject(startPath) {
    const projectRoot = findProjectRoot(startPath, ['Cargo.toml']);
    if (!projectRoot)
        return null;
    let name = path.basename(projectRoot);
    let version;
    let description;
    const cargoPath = path.join(projectRoot, 'Cargo.toml');
    try {
        const content = fs.readFileSync(cargoPath, 'utf-8');
        const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
        const versionMatch = content.match(/^version\s*=\s*"([^"]+)"/m);
        const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
        if (nameMatch && nameMatch[1])
            name = nameMatch[1];
        if (versionMatch && versionMatch[1])
            version = versionMatch[1];
        if (descMatch && descMatch[1])
            description = descMatch[1];
    }
    catch {
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
function detectDirectoryProject(startPath) {
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
function detectProject(fromPath) {
    const startPath = fromPath || process.cwd();
    // Try each detection method in priority order
    let project = null;
    // 1. Git (most reliable for project boundaries)
    project = detectGitProject(startPath);
    if (project)
        return project;
    // 2. Node.js
    project = detectNodeProject(startPath);
    if (project)
        return project;
    // 3. Python
    project = detectPythonProject(startPath);
    if (project)
        return project;
    // 4. Rust
    project = detectRustProject(startPath);
    if (project)
        return project;
    // 5. Fallback to directory
    return detectDirectoryProject(startPath);
}
/**
 * Create a global project info (for cross-project memories)
 */
function getGlobalProject() {
    return {
        id: exports.GLOBAL_PROJECT_ID,
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
function setProjectContext(project) {
    sessionContext.currentProject = project;
}
/**
 * Get the current project context
 * Auto-detects if not set
 */
function getProjectContext() {
    if (!sessionContext.currentProject) {
        sessionContext.currentProject = detectProject(sessionContext.workingDirectory);
    }
    return sessionContext.currentProject;
}
/**
 * Set whether to include global memories in queries
 */
function setIncludeGlobal(include) {
    sessionContext.includeGlobal = include;
}
/**
 * Get whether global memories are included
 */
function getIncludeGlobal() {
    return sessionContext.includeGlobal;
}
/**
 * Update the working directory (triggers re-detection on next query)
 */
function setWorkingDirectory(dir) {
    sessionContext.workingDirectory = dir;
    sessionContext.currentProject = null; // Force re-detection
}
/**
 * Get current working directory
 */
function getWorkingDirectory() {
    return sessionContext.workingDirectory;
}
/**
 * Reset session context to defaults
 */
function resetContext() {
    sessionContext = {
        currentProject: null,
        workingDirectory: process.cwd(),
        includeGlobal: true,
    };
}
/**
 * Build SQL WHERE clause for project filtering
 *
 * Returns { clause: string, params: unknown[] }
 */
function buildProjectFilter(options = {}, columnName = 'project_id') {
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
            params: [projectId, exports.GLOBAL_PROJECT_ID],
        };
    }
    else {
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
function resolveProjectIdForStore(explicitProjectId, isGlobal = false) {
    if (isGlobal) {
        return exports.GLOBAL_PROJECT_ID;
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
function isGlobalProject(projectId) {
    return projectId === exports.GLOBAL_PROJECT_ID;
}
/**
 * Get display name for a project ID
 */
function getProjectDisplayName(projectId) {
    if (!projectId)
        return 'Unknown';
    if (projectId === exports.GLOBAL_PROJECT_ID)
        return 'Global';
    if (projectId === exports.UNKNOWN_PROJECT_ID)
        return 'Unknown';
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
function listKnownProjects(db) {
    const rows = db.prepare(`
    SELECT project_id, COUNT(*) as count
    FROM memories
    WHERE deleted_at IS NULL AND project_id IS NOT NULL
    GROUP BY project_id
    ORDER BY count DESC
  `).all();
    return rows.map(row => ({
        projectId: row.project_id,
        count: row.count,
    }));
}
//# sourceMappingURL=project-isolation.js.map