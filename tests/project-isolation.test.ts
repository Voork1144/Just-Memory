/**
 * Tests for Just-Memory Project Isolation
 * 
 * Tests project detection, context management, and query filtering.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  detectProject,
  getGlobalProject,
  setProjectContext,
  getProjectContext,
  setIncludeGlobal,
  getIncludeGlobal,
  setWorkingDirectory,
  resetContext,
  buildProjectFilter,
  resolveProjectIdForStore,
  isGlobalProject,
  getProjectDisplayName,
  GLOBAL_PROJECT_ID,
  UNKNOWN_PROJECT_ID,
  type ProjectInfo,
} from '../src/memory/project-isolation.js';

describe('Project Isolation', () => {
  let tempDir: string;
  
  beforeEach(() => {
    // Create temp directory for test projects
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-test-'));
    resetContext();
  });
  
  afterEach(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetContext();
  });
  
  describe('Project Detection', () => {
    it('should detect git project', () => {
      // Create a git project
      const projectDir = path.join(tempDir, 'git-project');
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, '.git'));
      
      const project = detectProject(projectDir);
      
      expect(project.detectionMethod).toBe('git');
      expect(project.name).toBe('git-project');
      expect(project.rootPath).toBe(projectDir);
      expect(project.id).toHaveLength(16);
    });
    
    it('should detect Node.js project from package.json', () => {
      const projectDir = path.join(tempDir, 'node-project');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'my-node-app',
          version: '1.0.0',
          description: 'Test Node.js project',
        })
      );
      
      const project = detectProject(projectDir);
      
      expect(project.detectionMethod).toBe('package.json');
      expect(project.name).toBe('my-node-app');
      expect(project.version).toBe('1.0.0');
      expect(project.description).toBe('Test Node.js project');
    });
    
    it('should detect Python project from pyproject.toml', () => {
      const projectDir = path.join(tempDir, 'python-project');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(
        path.join(projectDir, 'pyproject.toml'),
        `[project]
name = "my-python-app"
version = "2.0.0"
description = "Test Python project"
`
      );
      
      const project = detectProject(projectDir);
      
      expect(project.detectionMethod).toBe('pyproject.toml');
      expect(project.name).toBe('my-python-app');
      expect(project.version).toBe('2.0.0');
    });
    
    it('should detect Rust project from Cargo.toml', () => {
      const projectDir = path.join(tempDir, 'rust-project');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(
        path.join(projectDir, 'Cargo.toml'),
        `[package]
name = "my-rust-app"
version = "0.1.0"
`
      );
      
      const project = detectProject(projectDir);
      
      expect(project.detectionMethod).toBe('cargo.toml');
      expect(project.name).toBe('my-rust-app');
      expect(project.version).toBe('0.1.0');
    });
    
    it('should fallback to directory detection', () => {
      const projectDir = path.join(tempDir, 'plain-directory');
      fs.mkdirSync(projectDir);
      
      const project = detectProject(projectDir);
      
      expect(project.detectionMethod).toBe('directory');
      expect(project.name).toBe('plain-directory');
    });
    
    it('should detect project from subdirectory', () => {
      // Create git project with nested directory
      const projectDir = path.join(tempDir, 'parent-project');
      const subDir = path.join(projectDir, 'src', 'utils');
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      fs.mkdirSync(subDir, { recursive: true });
      
      const project = detectProject(subDir);
      
      expect(project.detectionMethod).toBe('git');
      expect(project.rootPath).toBe(projectDir);
    });
    
    it('should prioritize git over package.json', () => {
      const projectDir = path.join(tempDir, 'git-and-node');
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({ name: 'node-name' })
      );
      
      const project = detectProject(projectDir);
      
      expect(project.detectionMethod).toBe('git');
    });
    
    it('should generate stable project IDs', () => {
      const projectDir = path.join(tempDir, 'stable-id');
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, '.git'));
      
      const project1 = detectProject(projectDir);
      const project2 = detectProject(projectDir);
      
      expect(project1.id).toBe(project2.id);
    });
  });
  
  describe('Global Project', () => {
    it('should return global project info', () => {
      const global = getGlobalProject();
      
      expect(global.id).toBe(GLOBAL_PROJECT_ID);
      expect(global.name).toBe('Global');
      expect(global.detectionMethod).toBe('global');
    });
    
    it('should identify global project ID', () => {
      expect(isGlobalProject(GLOBAL_PROJECT_ID)).toBe(true);
      expect(isGlobalProject('abc123')).toBe(false);
      expect(isGlobalProject(null)).toBe(false);
      expect(isGlobalProject(undefined)).toBe(false);
    });
  });
  
  describe('Session Context', () => {
    it('should auto-detect project on first access', () => {
      const project = getProjectContext();
      
      expect(project).toBeDefined();
      expect(project.id).toBeTruthy();
    });
    
    it('should allow setting project context explicitly', () => {
      const customProject: ProjectInfo = {
        id: 'custom-id',
        name: 'Custom Project',
        rootPath: '/custom/path',
        detectionMethod: 'explicit',
      };
      
      setProjectContext(customProject);
      const project = getProjectContext();
      
      expect(project.id).toBe('custom-id');
      expect(project.name).toBe('Custom Project');
    });
    
    it('should track include global setting', () => {
      expect(getIncludeGlobal()).toBe(true); // Default
      
      setIncludeGlobal(false);
      expect(getIncludeGlobal()).toBe(false);
      
      setIncludeGlobal(true);
      expect(getIncludeGlobal()).toBe(true);
    });
    
    it('should re-detect project when working directory changes', () => {
      // Set initial context
      const project1 = getProjectContext();
      
      // Create a different project
      const newDir = path.join(tempDir, 'new-project');
      fs.mkdirSync(newDir);
      fs.writeFileSync(
        path.join(newDir, 'package.json'),
        JSON.stringify({ name: 'different-project' })
      );
      
      // Change working directory
      setWorkingDirectory(newDir);
      const project2 = getProjectContext();
      
      expect(project2.name).toBe('different-project');
      expect(project2.id).not.toBe(project1.id);
    });
    
    it('should reset context properly', () => {
      setIncludeGlobal(false);
      setProjectContext({
        id: 'test',
        name: 'Test',
        rootPath: '/test',
        detectionMethod: 'explicit',
      });
      
      resetContext();
      
      expect(getIncludeGlobal()).toBe(true);
      // After reset, should auto-detect again
      const project = getProjectContext();
      expect(project.id).not.toBe('test');
    });
  });
  
  describe('Query Filtering', () => {
    it('should build filter including global', () => {
      setProjectContext({
        id: 'project-123',
        name: 'Test',
        rootPath: '/test',
        detectionMethod: 'explicit',
      });
      setIncludeGlobal(true);
      
      const filter = buildProjectFilter();
      
      expect(filter.clause).toContain('OR');
      expect(filter.clause).toContain('project_id');
      expect(filter.params).toContain('project-123');
      expect(filter.params).toContain(GLOBAL_PROJECT_ID);
    });
    
    it('should build filter excluding global', () => {
      setProjectContext({
        id: 'project-456',
        name: 'Test',
        rootPath: '/test',
        detectionMethod: 'explicit',
      });
      setIncludeGlobal(false);
      
      const filter = buildProjectFilter();
      
      expect(filter.clause).not.toContain('OR');
      expect(filter.params).toEqual(['project-456']);
    });
    
    it('should allow explicit project ID override', () => {
      const filter = buildProjectFilter({ projectId: 'explicit-id' });
      
      expect(filter.params).toContain('explicit-id');
    });
    
    it('should support all projects query', () => {
      const filter = buildProjectFilter({ allProjects: true });
      
      expect(filter.clause).toBe('1=1');
      expect(filter.params).toEqual([]);
    });
    
    it('should support custom column name', () => {
      const filter = buildProjectFilter({}, 'p.project_id');
      
      expect(filter.clause).toContain('p.project_id');
    });
    
    it('should override session includeGlobal with option', () => {
      setIncludeGlobal(true);
      
      const filter = buildProjectFilter({ includeGlobal: false });
      
      expect(filter.clause).not.toContain('OR');
      expect(filter.params).not.toContain(GLOBAL_PROJECT_ID);
    });
  });
  
  describe('Project ID Resolution for Storage', () => {
    beforeEach(() => {
      setProjectContext({
        id: 'session-project',
        name: 'Session',
        rootPath: '/session',
        detectionMethod: 'explicit',
      });
    });
    
    it('should use session project when no explicit ID', () => {
      const id = resolveProjectIdForStore();
      
      expect(id).toBe('session-project');
    });
    
    it('should use explicit project ID when provided', () => {
      const id = resolveProjectIdForStore('explicit-project');
      
      expect(id).toBe('explicit-project');
    });
    
    it('should use global ID when isGlobal is true', () => {
      const id = resolveProjectIdForStore(undefined, true);
      
      expect(id).toBe(GLOBAL_PROJECT_ID);
    });
    
    it('should prefer global over explicit when isGlobal is true', () => {
      const id = resolveProjectIdForStore('explicit', true);
      
      expect(id).toBe(GLOBAL_PROJECT_ID);
    });
  });
  
  describe('Display Names', () => {
    it('should return Global for global project ID', () => {
      expect(getProjectDisplayName(GLOBAL_PROJECT_ID)).toBe('Global');
    });
    
    it('should return Unknown for null/undefined', () => {
      expect(getProjectDisplayName(null)).toBe('Unknown');
      expect(getProjectDisplayName(undefined)).toBe('Unknown');
    });
    
    it('should return Unknown for unknown project ID constant', () => {
      expect(getProjectDisplayName(UNKNOWN_PROJECT_ID)).toBe('Unknown');
    });
    
    it('should return cached project name if available', () => {
      setProjectContext({
        id: 'cached-id',
        name: 'Cached Project',
        rootPath: '/cached',
        detectionMethod: 'explicit',
      });
      
      expect(getProjectDisplayName('cached-id')).toBe('Cached Project');
    });
    
    it('should return truncated ID for unknown projects', () => {
      expect(getProjectDisplayName('abcdef123456789')).toBe('abcdef12');
    });
  });
});
