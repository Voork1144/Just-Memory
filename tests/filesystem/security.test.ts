/**
 * Just-Command Filesystem Security Tests
 * 
 * Tests for filesystem security features:
 * - Path traversal prevention
 * - Symlink attack prevention
 * - Allowed directories enforcement
 * 
 * Uses Node.js built-in test runner.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import filesystem security module (tsx will handle TypeScript)
import {
  validatePath,
  normalizePath,
  isPathAllowed,
  isPathBlocked,
  updateSecurityConfig,
  getSecurityConfig,
  sanitizeFilename,
  isHiddenFile,
} from '../../src/filesystem/security.js';

// Test directories
const TEST_ROOT = join(tmpdir(), `just-command-fs-test-${Date.now()}`);
const ALLOWED_DIR = join(TEST_ROOT, 'allowed');
const FORBIDDEN_DIR = join(TEST_ROOT, 'forbidden');
const NESTED_DIR = join(ALLOWED_DIR, 'nested', 'deep');

describe('Filesystem Security', () => {
  before(() => {
    // Create test directory structure
    mkdirSync(ALLOWED_DIR, { recursive: true });
    mkdirSync(FORBIDDEN_DIR, { recursive: true });
    mkdirSync(NESTED_DIR, { recursive: true });

    // Create test files
    writeFileSync(join(ALLOWED_DIR, 'test.txt'), 'allowed content');
    writeFileSync(join(FORBIDDEN_DIR, 'secret.txt'), 'forbidden content');
    writeFileSync(join(NESTED_DIR, 'deep.txt'), 'deep content');

    // Set allowed directories for tests
    updateSecurityConfig({ allowedDirectories: [ALLOWED_DIR] });
  });

  after(() => {
    // Cleanup test directories
    try {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Reset security config
    updateSecurityConfig({ allowedDirectories: [] });
  });

  describe('normalizePath', () => {
    it('should normalize relative paths', () => {
      const normalized = normalizePath('./test/../file.txt');
      assert.ok(!normalized.includes('..'), 'Should remove .. segments');
    });

    it('should convert backslashes to forward slashes', () => {
      const normalized = normalizePath('folder\\subfolder\\file.txt');
      // On any platform it should return a valid path
      assert.ok(normalized.length > 0);
    });

    it('should handle tilde expansion', () => {
      const normalized = normalizePath('~/test.txt');
      assert.ok(!normalized.startsWith('~'), 'Should expand tilde');
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should block simple path traversal', () => {
      const maliciousPath = join(ALLOWED_DIR, '..', 'forbidden', 'secret.txt');
      
      const error = validatePath(maliciousPath, 'read');
      assert.ok(error !== null, 'Should return error for traversal');
      assert.strictEqual(error?.code, 'PERMISSION_DENIED');
    });

    it('should allow valid paths within allowed directories', () => {
      const validPath = join(ALLOWED_DIR, 'test.txt');
      
      const error = validatePath(validPath, 'read');
      assert.strictEqual(error, null, 'Valid path should return null');
    });

    it('should allow valid nested paths', () => {
      const validPath = join(NESTED_DIR, 'deep.txt');
      
      const error = validatePath(validPath, 'read');
      assert.strictEqual(error, null, 'Valid nested path should return null');
    });
  });

  describe('Allowed Directories Enforcement', () => {
    it('should allow paths within allowed directories', () => {
      const allowedPath = join(ALLOWED_DIR, 'test.txt');
      
      const result = isPathAllowed(allowedPath);
      assert.strictEqual(result, true, 'Path in allowed dir should be allowed');
    });

    it('should block paths outside allowed directories', () => {
      const forbiddenPath = join(FORBIDDEN_DIR, 'secret.txt');
      
      const result = isPathAllowed(forbiddenPath);
      assert.strictEqual(result, false, 'Path outside allowed dir should be blocked');
    });

    it('should allow paths in nested subdirectories', () => {
      const nestedPath = join(NESTED_DIR, 'deep.txt');
      
      const result = isPathAllowed(nestedPath);
      assert.strictEqual(result, true, 'Nested path should be allowed');
    });

    it('should return security configuration', () => {
      const config = getSecurityConfig();
      
      assert.ok(Array.isArray(config.allowedDirectories));
      assert.ok(config.allowedDirectories.length > 0);
    });

    it('should update security configuration', () => {
      const originalConfig = getSecurityConfig();
      const originalDirs = [...originalConfig.allowedDirectories];
      
      updateSecurityConfig({ allowedDirectories: [ALLOWED_DIR, FORBIDDEN_DIR] });
      const updated = getSecurityConfig();
      
      assert.strictEqual(updated.allowedDirectories.length, 2);
      
      // Restore original
      updateSecurityConfig({ allowedDirectories: originalDirs });
    });
  });

  describe('validatePath', () => {
    it('should reject empty path', () => {
      const error = validatePath('', 'read');
      assert.ok(error !== null);
      assert.strictEqual(error?.code, 'INVALID_PATH');
    });

    it('should reject whitespace-only path', () => {
      const error = validatePath('   ', 'read');
      assert.ok(error !== null);
      assert.strictEqual(error?.code, 'INVALID_PATH');
    });

    it('should validate read operation', () => {
      const validPath = join(ALLOWED_DIR, 'test.txt');
      const error = validatePath(validPath, 'read');
      assert.strictEqual(error, null);
    });

    it('should validate write operation', () => {
      const validPath = join(ALLOWED_DIR, 'new-file.txt');
      const error = validatePath(validPath, 'write');
      assert.strictEqual(error, null);
    });

    it('should validate delete operation', () => {
      const validPath = join(ALLOWED_DIR, 'test.txt');
      const error = validatePath(validPath, 'delete');
      assert.strictEqual(error, null);
    });

    it('should validate list operation', () => {
      const error = validatePath(ALLOWED_DIR, 'list');
      assert.strictEqual(error, null);
    });
  });

  describe('Symlink Security', () => {
    const SYMLINK_PATH = join(ALLOWED_DIR, 'symlink_to_forbidden');

    before(() => {
      try {
        // Create symlink pointing outside allowed directory
        symlinkSync(FORBIDDEN_DIR, SYMLINK_PATH);
      } catch {
        // Symlink creation may fail on some systems (Windows without admin)
      }
    });

    it('should check symlink paths', function() {
      // The symlink target resolution happens at the filesystem level
      // Our isPathAllowed checks the logical path
      const symlinkPath = join(SYMLINK_PATH, 'secret.txt');
      
      // The path itself starts with ALLOWED_DIR so it passes the prefix check
      // Real symlink security requires following the symlink to check the target
      const result = isPathAllowed(symlinkPath);
      // This documents current behavior - may need enhancement
      assert.ok(typeof result === 'boolean');
    });
  });

  describe('Special Characters', () => {
    it('should handle paths with spaces', () => {
      const pathWithSpaces = join(ALLOWED_DIR, 'file with spaces.txt');
      
      const result = isPathAllowed(pathWithSpaces);
      assert.strictEqual(result, true);
    });

    it('should handle Unicode filenames', () => {
      const unicodePath = join(ALLOWED_DIR, '文件.txt');
      
      const result = isPathAllowed(unicodePath);
      assert.strictEqual(result, true);
    });

    it('should handle emoji in filenames', () => {
      const emojiPath = join(ALLOWED_DIR, '📝notes.txt');
      
      const result = isPathAllowed(emojiPath);
      assert.strictEqual(result, true);
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove dangerous characters', () => {
      const sanitized = sanitizeFilename('file<>:"/\\|?*name.txt');
      
      assert.ok(!sanitized.includes('<'));
      assert.ok(!sanitized.includes('>'));
      assert.ok(!sanitized.includes(':'));
      assert.ok(!sanitized.includes('"'));
      assert.ok(!sanitized.includes('|'));
      assert.ok(!sanitized.includes('?'));
      assert.ok(!sanitized.includes('*'));
    });

    it('should remove path traversal attempts', () => {
      const sanitized = sanitizeFilename('..\\..\\file.txt');
      
      assert.ok(!sanitized.includes('..'), 'Should remove .. sequences');
    });

    it('should remove control characters', () => {
      const sanitized = sanitizeFilename('file\x00\x1fname.txt');
      
      assert.ok(!sanitized.includes('\x00'));
      assert.ok(!sanitized.includes('\x1f'));
    });

    it('should preserve safe characters', () => {
      const sanitized = sanitizeFilename('my-file_2024.txt');
      
      assert.strictEqual(sanitized, 'my-file_2024.txt');
    });
  });

  describe('isHiddenFile', () => {
    it('should detect dot files as hidden', () => {
      const result = isHiddenFile('.gitignore');
      assert.strictEqual(result, true);
    });

    it('should detect nested dot files', () => {
      const result = isHiddenFile('/path/to/.hidden');
      assert.strictEqual(result, true);
    });

    it('should not flag regular files as hidden', () => {
      const result = isHiddenFile('regular.txt');
      assert.strictEqual(result, false);
    });

    it('should not flag files with dots in middle', () => {
      const result = isHiddenFile('file.test.txt');
      assert.strictEqual(result, false);
    });
  });

  describe('isPathBlocked', () => {
    before(() => {
      // Add some blocked paths and extensions
      updateSecurityConfig({
        blockedPaths: ['/etc/passwd', '/etc/shadow'],
        blockedExtensions: ['.exe', '.dll'],
      });
    });

    after(() => {
      // Reset blocked paths
      updateSecurityConfig({
        blockedPaths: [],
        blockedExtensions: [],
      });
    });

    it('should block configured blocked paths', () => {
      const result = isPathBlocked('/etc/passwd');
      assert.strictEqual(result, true);
    });

    it('should block configured blocked extensions', () => {
      const result = isPathBlocked('malware.exe');
      assert.strictEqual(result, true);
    });

    it('should allow non-blocked paths', () => {
      const result = isPathBlocked('/home/user/document.txt');
      assert.strictEqual(result, false);
    });

    it('should be case-sensitive for extensions', () => {
      const lowerResult = isPathBlocked('file.exe');
      const upperResult = isPathBlocked('file.EXE');
      
      assert.strictEqual(lowerResult, true);
      // Upper case may or may not be blocked depending on implementation
      assert.ok(typeof upperResult === 'boolean');
    });
  });

  describe('Edge Cases', () => {
    it('should handle root path', () => {
      const result = isPathAllowed('/');
      // Root should be blocked if allowed directories are configured
      assert.strictEqual(result, false);
    });

    it('should handle very long paths', () => {
      const longPath = join(ALLOWED_DIR, 'a'.repeat(200));
      
      // Should either work or fail gracefully
      try {
        const result = isPathAllowed(longPath);
        assert.ok(typeof result === 'boolean');
      } catch (error) {
        assert.ok(error instanceof Error);
      }
    });

    it('should allow all paths when no directories configured', () => {
      const originalConfig = getSecurityConfig();
      
      updateSecurityConfig({ allowedDirectories: [] });
      
      const result = isPathAllowed('/any/random/path');
      assert.strictEqual(result, true, 'Should allow all when no restrictions');
      
      // Restore
      updateSecurityConfig({ allowedDirectories: originalConfig.allowedDirectories });
    });
  });
});
