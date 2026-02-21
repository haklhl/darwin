// ============================================================
// Darwin - Git Upstream Sync
// ============================================================

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { logger } from '../observability/logger.js';

const MODULE = 'self-mod:upstream';
const DARWIN_ROOT = resolve(homedir(), 'darwin');

/**
 * Execute a shell command in the Darwin project directory.
 * Returns stdout as a trimmed string, or null on failure.
 */
function exec(command: string): string | null {
  try {
    const output = execSync(command, {
      cwd: DARWIN_ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim();
  } catch (err) {
    logger.warn(MODULE, `Command failed: ${command}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Check if there are upstream updates available on origin/main.
 */
export async function checkForUpdates(): Promise<{
  hasUpdates: boolean;
  commitsBehind: number;
  latestCommit: string;
}> {
  logger.info(MODULE, 'Checking for upstream updates');

  // Fetch latest from remote
  const fetchResult = exec('git fetch origin');
  if (fetchResult === null) {
    logger.warn(MODULE, 'git fetch failed, may not have remote configured');
    return { hasUpdates: false, commitsBehind: 0, latestCommit: '' };
  }

  // Get commits we're behind
  const logOutput = exec('git log HEAD..origin/main --oneline');
  if (logOutput === null || logOutput.length === 0) {
    logger.info(MODULE, 'No upstream updates available');
    return { hasUpdates: false, commitsBehind: 0, latestCommit: '' };
  }

  const commits = logOutput.split('\n').filter((line) => line.trim().length > 0);
  const commitsBehind = commits.length;
  const latestCommit = commits.length > 0 ? commits[0] : '';

  logger.info(MODULE, 'Upstream updates found', { commitsBehind, latestCommit });

  return {
    hasUpdates: commitsBehind > 0,
    commitsBehind,
    latestCommit,
  };
}

/**
 * Apply upstream updates using git pull --rebase.
 */
export async function applyUpdates(): Promise<{ success: boolean; message: string }> {
  logger.info(MODULE, 'Applying upstream updates');

  const result = exec('git pull --rebase origin main');

  if (result === null) {
    const message = 'git pull --rebase failed. Manual intervention may be required.';
    logger.error(MODULE, message);
    return { success: false, message };
  }

  logger.info(MODULE, 'Upstream updates applied', { output: result });
  return { success: true, message: result };
}

/**
 * Get the current project version from package.json.
 */
export function getCurrentVersion(): string {
  try {
    const pkgPath = resolve(DARWIN_ROOT, 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch (err) {
    logger.error(MODULE, 'Failed to read package.json version', {
      error: err instanceof Error ? err.message : String(err),
    });
    return '0.0.0';
  }
}
