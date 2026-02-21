// ============================================================
// Darwin - Procedural Memory (how-to procedures, persisted to DB)
// ============================================================

import type { MemoryEntry } from '../types.js';
import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';

const MODULE = 'memory-procedural';
const LAYER = 'procedural';

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
 * Store a procedure (a series of steps for how to do something).
 * @param name - Unique name for this procedure.
 * @param steps - The step-by-step instructions.
 * @param metadata - Optional metadata (e.g. tags, prerequisites).
 */
export function storeProcedure(
  name: string,
  steps: string,
  metadata?: Record<string, unknown>,
): void {
  const db = getDatabase();
  const now = Date.now();
  const meta = JSON.stringify(metadata ?? {});

  // Upsert: replace if procedure name already exists
  const existing = db.prepare(
    'SELECT id FROM memories WHERE layer = ? AND key = ?',
  ).get(LAYER, name) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE memories SET content = ?, metadata = ?, updated_at = ? WHERE id = ?
    `).run(steps, meta, now, existing.id);
    logger.debug(MODULE, `Updated procedure: "${name}"`);
  } else {
    db.prepare(`
      INSERT INTO memories (layer, key, content, metadata, importance, access_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0.7, 0, ?, ?)
    `).run(LAYER, name, steps, meta, now, now);
    logger.debug(MODULE, `Stored new procedure: "${name}"`);
  }
}

/**
 * Retrieve a specific procedure by name.
 * Increments the access counter on retrieval.
 */
export function getProcedure(name: string): MemoryEntry | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT id, layer, key, content, metadata, importance, access_count, created_at, updated_at, expires_at
    FROM memories
    WHERE layer = ? AND key = ?
  `).get(LAYER, name) as MemoryRow | undefined;

  if (!row) return null;

  db.prepare('UPDATE memories SET access_count = access_count + 1 WHERE id = ?').run(row.id);

  return rowToEntry(row);
}

/**
 * List all stored procedures, ordered by access frequency.
 */
export function listProcedures(): MemoryEntry[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, layer, key, content, metadata, importance, access_count, created_at, updated_at, expires_at
    FROM memories
    WHERE layer = ?
    ORDER BY access_count DESC, created_at DESC
  `).all(LAYER) as MemoryRow[];

  return rows.map(rowToEntry);
}
