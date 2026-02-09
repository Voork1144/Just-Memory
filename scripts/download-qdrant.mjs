#!/usr/bin/env node

/**
 * Download Qdrant binary for the current platform.
 *
 * Used in two contexts:
 * 1. postinstall fallback — if the @just-memory/qdrant-* optionalDependency
 *    failed to install (e.g. unsupported package manager, --ignore-scripts)
 * 2. Lazy runtime fallback — called from qdrant-store.ts when binary not found
 *
 * On any error this script warns to stderr and exits 0 (never breaks npm install).
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, createWriteStream, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import { execSync } from 'node:child_process';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';

const QDRANT_VERSION = '1.16.3';

const PLATFORM_MAP = {
  'linux-x64':      'qdrant-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64':    'qdrant-aarch64-unknown-linux-musl.tar.gz',
  'darwin-x64':     'qdrant-x86_64-apple-darwin.tar.gz',
  'darwin-arm64':   'qdrant-aarch64-apple-darwin.tar.gz',
  'win32-x64':      'qdrant-x86_64-pc-windows-msvc.zip',
};

const QDRANT_DIR = join(homedir(), '.just-memory', 'qdrant');
const BIN_DIR = join(QDRANT_DIR, 'bin');
const VERSION_FILE = join(QDRANT_DIR, '.qdrant-version');
const BINARY_NAME = platform() === 'win32' ? 'qdrant.exe' : 'qdrant';
const BINARY_PATH = join(BIN_DIR, BINARY_NAME);

/**
 * Download a URL to a file, following redirects.
 * Returns a promise that resolves when download is complete.
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const getter = url.startsWith('https') ? httpsGet : httpGet;

    const request = getter(url, (response) => {
      // Follow redirects (GitHub -> CDN)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        unlinkSync(destPath);
        return resolve(downloadFile(response.headers.location, destPath));
      }

      if (response.statusCode !== 200) {
        file.close();
        unlinkSync(destPath);
        return reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalBytes > 0) {
          const pct = ((downloaded / totalBytes) * 100).toFixed(0);
          process.stderr.write(`\r[Just-Memory] Downloading Qdrant... ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
        }
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        if (totalBytes > 0) process.stderr.write('\n');
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      try { unlinkSync(destPath); } catch { /* ignore */ }
      reject(err);
    });
  });
}

/**
 * Download and install the Qdrant binary for the current platform.
 * Exported so qdrant-store.ts can import and call it at runtime.
 */
export async function downloadQdrant() {
  const key = `${platform()}-${arch()}`;
  const archiveFilename = PLATFORM_MAP[key];

  if (!archiveFilename) {
    console.error(`[Just-Memory] No Qdrant binary available for ${key}`);
    return false;
  }

  // Skip if already installed with correct version
  if (existsSync(BINARY_PATH) && existsSync(VERSION_FILE)) {
    try {
      const installed = readFileSync(VERSION_FILE, 'utf-8').trim();
      if (installed === QDRANT_VERSION) {
        return true;
      }
      console.error(`[Just-Memory] Qdrant ${installed} installed, upgrading to ${QDRANT_VERSION}`);
    } catch { /* version file unreadable, re-download */ }
  }

  mkdirSync(BIN_DIR, { recursive: true });

  const url = `https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/${archiveFilename}`;
  const archivePath = join(QDRANT_DIR, archiveFilename);

  console.error(`[Just-Memory] Downloading Qdrant v${QDRANT_VERSION} for ${key}...`);

  await downloadFile(url, archivePath);

  // Extract
  try {
    if (archiveFilename.endsWith('.zip')) {
      execSync(`unzip -o "${archivePath}" -d "${BIN_DIR}"`, { stdio: 'pipe' });
    } else {
      execSync(`tar xzf "${archivePath}" -C "${BIN_DIR}"`, { stdio: 'pipe' });
    }
  } finally {
    // Clean up archive
    try { unlinkSync(archivePath); } catch { /* ignore */ }
  }

  // Set executable permission on unix
  if (platform() !== 'win32') {
    chmodSync(BINARY_PATH, 0o755);
  }

  // Write version marker
  writeFileSync(VERSION_FILE, QDRANT_VERSION);

  console.error(`[Just-Memory] Qdrant v${QDRANT_VERSION} installed at ${BINARY_PATH}`);
  return true;
}

// Run as postinstall script when executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('download-qdrant.mjs') ||
  process.argv[1].endsWith('download-qdrant')
);

if (isDirectRun) {
  downloadQdrant().catch((err) => {
    console.error(`[Just-Memory] Qdrant download failed: ${err.message}`);
    console.error('[Just-Memory] Qdrant is optional — falling back to sqlite-vec for vector search');
    // Exit 0: never break npm install
  });
}
