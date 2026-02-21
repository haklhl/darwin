// ============================================================
// Darwin - Episodic Memory (event log, persisted to DB)
// ============================================================

import type { MemoryEntry } from '../types.js';
import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';

const MODULE = 'memory-episodic';
const LAYER = 'episodic';

interface MemoryRow {
  id: number;
  layer: string;
  key: string;
  content: string;
  metadata: string;
  importance: number;
  access_count: number;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    layer: row.layer as MemoryEntry['layer'],
    key: row.key,
    content: row.content,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    importance: row.importance,
    accessCount: row.access_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

/**
 * Record an episodic event (something that happened).
 * @param type - A short event type identifier (e.g. "error", "transaction", "observation").
 * @param content - The full event description.
 * @param importance - Importance score from 0.0 to 1.0 (default 0.5).
 */
export function recordEvent(type: string, content: string, importance: number = 0.5): void {
  const db = getDatabase();
  const now = Date.now();
  const key = `${type}:${now}`;

  db.prepare(`
    INSERT INTO memories (layer, key, content, metadata, importance, access_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(LAYER, key, content, JSON.stringify({ type }), importance, now, now);

  logger.debug(MODULE, `Recorded episodic event: ${type}`, { key, importance });
}

/**
 * Retrieve the most recent episodic events.
 * @param limit - Maximum number of events to return (default 20).
 */
export function getRecentEvents(limit: number = 20): MemoryEntry[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, layer, key, content, metadata, importance, access_count, created_at, updated_at, expires_at
    FROM memories
    WHERE layer = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(LAYER, limit) as MemoryRow[];

  // Increment access counts for retrieved entries
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    db.prepare(`
      UPDATE memories SET access_count = access_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})
    `).run(...ids);
  }

  return rows.map(rowToEntry);
}

/**
 * Search episodic events by text content (case-insensitive substring match).
 * @param query - The search query string.
 */
export function searchEvents(query: string): MemoryEntry[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, layer, key, content, metadata, importance, access_count, created_at, updated_at, expires_at
    FROM memories
    WHERE layer = ? AND content LIKE ?
    ORDER BY importance DESC, created_at DESC
    LIMIT 50
  `).all(LAYER, `%${query}%`) as MemoryRow[];

  return rows.map(rowToEntry);
}
