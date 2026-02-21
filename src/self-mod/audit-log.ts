// ============================================================
// Darwin - Self-Modification Audit Log
// ============================================================

import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';

const MODULE = 'self-mod:audit';

/**
 * Record a self-modification event to the audit log.
 * Returns the inserted row ID.
 */
export function logModification(filePath: string, diff: string, reason: string): number {
  const db = getDatabase();
  const now = Date.now();

  const result = db.prepare(`
    INSERT INTO self_mod_log (file_path, diff, reason, approved, timestamp)
    VALUES (?, ?, ?, 1, ?)
  `).run(filePath, diff, reason, now);

  const id = Number(result.lastInsertRowid);

  logger.info(MODULE, 'Modification logged', { id, filePath, reason });

  return id;
}

/**
 * Retrieve the audit log of self-modifications.
 * Optionally limited to the most recent N entries.
 */
export function getAuditLog(limit?: number): Array<{
  id: number;
  filePath: string;
  diff: string;
  reason: string;
  approved: boolean;
  timestamp: number;
}> {
  const db = getDatabase();
  const effectiveLimit = limit ?? 100;

  const rows = db.prepare(`
    SELECT id, file_path, diff, reason, approved, timestamp
    FROM self_mod_log
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(effectiveLimit) as Array<{
    id: number;
    file_path: string;
    diff: string;
    reason: string;
    approved: number;
    timestamp: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    filePath: row.file_path,
    diff: row.diff,
    reason: row.reason,
    approved: row.approved === 1,
    timestamp: row.timestamp,
  }));
}

/**
 * Count the number of modifications within a given time window.
 * Defaults to the last 24 hours if no window specified.
 */
export function getModificationCount(hours?: number): number {
  const db = getDatabase();
  const windowHours = hours ?? 24;
  const since = Date.now() - windowHours * 3_600_000;

  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM self_mod_log WHERE timestamp > ?
  `).get(since) as { count: number };

  return row.count;
}
