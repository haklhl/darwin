// ============================================================
// Darwin - Safe Code Editing (Self-Modification)
// ============================================================

import { writeFileSync } from 'fs';
import { resolve, relative } from 'path';
import { homedir } from 'os';
import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';

const MODULE = 'self-mod:code';

/** Files that must never be edited by self-modification. */
const PROTECTED_FILES = ['constitution.md', 'wallet.json'];

/** The root directory boundary for all edits. */
const DARWIN_ROOT = resolve(homedir(), 'darwin');

/**
 * Check whether a file path is safe to edit.
 * Rejects protected files and anything outside ~/darwin/.
 */
function isSafePath(filePath: string): { safe: boolean; reason: string } {
  const resolved = resolve(filePath);
  const rel = relative(DARWIN_ROOT, resolved);

  // Must be within ~/darwin/
  if (rel.startsWith('..') || resolve(DARWIN_ROOT, rel) !== resolved) {
    return { safe: false, reason: `Path "${filePath}" is outside ~/darwin/` };
  }

  // Must not be a protected file
  const fileName = resolved.split('/').pop() ?? '';
  for (const protectedFile of PROTECTED_FILES) {
    if (fileName === protectedFile) {
      return { safe: false, reason: `File "${protectedFile}" is protected and cannot be modified` };
    }
  }

  return { safe: true, reason: '' };
}

/**
 * Generate a simple line-by-line diff between old and new content.
 */
function generateDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diffLines: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      diffLines.push(`  ${oldLine}`);
    } else {
      if (oldLine !== undefined) {
        diffLines.push(`- ${oldLine}`);
      }
      if (newLine !== undefined) {
        diffLines.push(`+ ${newLine}`);
      }
    }
  }

  return diffLines.join('\n');
}

/**
 * Propose a code edit. Records the proposal in self_mod_log without applying it.
 * Returns the proposal ID and generated diff.
 */
export function proposeEdit(
  filePath: string,
  oldContent: string,
  newContent: string,
  reason: string,
): { id: number; diff: string } {
  const safety = isSafePath(filePath);
  if (!safety.safe) {
    throw new Error(`Edit refused: ${safety.reason}`);
  }

  const diff = generateDiff(oldContent, newContent);
  const resolvedPath = resolve(filePath);
  const db = getDatabase();
  const now = Date.now();

  const result = db.prepare(`
    INSERT INTO self_mod_log (file_path, diff, reason, approved, timestamp)
    VALUES (?, ?, ?, 0, ?)
  `).run(resolvedPath, diff, reason, now);

  const id = Number(result.lastInsertRowid);

  logger.info(MODULE, 'Edit proposed', { id, filePath: resolvedPath, reason });

  return { id, diff };
}

/**
 * Apply a previously proposed edit by ID.
 * Reads the proposal from the database, applies the file change, and marks as approved.
 */
export function applyEdit(editId: number): boolean {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT id, file_path, diff, reason, approved
    FROM self_mod_log
    WHERE id = ?
  `).get(editId) as
    | { id: number; file_path: string; diff: string; reason: string; approved: number }
    | undefined;

  if (!row) {
    logger.warn(MODULE, 'Edit not found', { editId });
    return false;
  }

  if (row.approved === 1) {
    logger.warn(MODULE, 'Edit already applied', { editId });
    return false;
  }

  const safety = isSafePath(row.file_path);
  if (!safety.safe) {
    logger.error(MODULE, `Cannot apply edit: ${safety.reason}`, { editId });
    return false;
  }

  // Reconstruct new content from diff
  const diffLines = row.diff.split('\n');
  const newLines: string[] = [];

  for (const line of diffLines) {
    if (line.startsWith('+ ')) {
      newLines.push(line.slice(2));
    } else if (line.startsWith('- ')) {
      // Removed line - skip
      continue;
    } else if (line.startsWith('  ')) {
      newLines.push(line.slice(2));
    } else {
      // Fallback: include as-is (handles empty lines in diff)
      newLines.push(line);
    }
  }

  const newContent = newLines.join('\n');

  try {
    writeFileSync(row.file_path, newContent, 'utf-8');

    db.prepare(`
      UPDATE self_mod_log SET approved = 1 WHERE id = ?
    `).run(editId);

    logger.info(MODULE, 'Edit applied successfully', {
      editId,
      filePath: row.file_path,
      reason: row.reason,
    });

    return true;
  } catch (err) {
    logger.error(MODULE, 'Failed to apply edit', {
      editId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Get all proposed (unapproved) edits.
 */
export function getProposedEdits(): Array<{
  id: number;
  filePath: string;
  diff: string;
  reason: string;
  timestamp: number;
}> {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, file_path, diff, reason, timestamp
    FROM self_mod_log
    WHERE approved = 0
    ORDER BY timestamp DESC
  `).all() as Array<{
    id: number;
    file_path: string;
    diff: string;
    reason: string;
    timestamp: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    filePath: row.file_path,
    diff: row.diff,
    reason: row.reason,
    timestamp: row.timestamp,
  }));
}

/**
 * Reject a proposed edit by removing it from the pending proposals.
 * Sets approved to -1 to indicate rejection (preserving audit trail).
 */
export function rejectEdit(editId: number): void {
  const db = getDatabase();

  const result = db.prepare(`
    UPDATE self_mod_log SET approved = -1 WHERE id = ? AND approved = 0
  `).run(editId);

  if (result.changes === 0) {
    logger.warn(MODULE, 'Edit not found or already processed', { editId });
  } else {
    logger.info(MODULE, 'Edit rejected', { editId });
  }
}
