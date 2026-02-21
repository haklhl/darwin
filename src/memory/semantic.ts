// ============================================================
// Darwin - Semantic Memory (knowledge base, persisted to DB)
// ============================================================

import type { MemoryEntry } from '../types.js';
import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';

const MODULE = 'memory-semantic';
const LAYER = 'semantic';

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
 * Store a piece of knowledge in semantic memory.
 * If a key already exists, it will be replaced.
 * @param key - A unique identifier for this knowledge.
 * @param content - The knowledge content.
 * @param importance - Importance score from 0.0 to 1.0 (default 0.5).
 */
export function storeKnowledge(key: string, content: string, importance: number = 0.5): void {
  const db = getDatabase();
  const now = Date.now();

  // Upsert: replace if key already exists in semantic layer
  const existing = db.prepare(
    'SELECT id FROM memories WHERE layer = ? AND key = ?',
  ).get(LAYER, key) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE memories SET content = ?, importance = ?, updated_at = ? WHERE id = ?
    `).run(content, importance, now, existing.id);
    logger.debug(MODULE, `Updated semantic knowledge: "${key}"`);
  } else {
    db.prepare(`
      INSERT INTO memories (layer, key, content, metadata, importance, access_count, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, 0, ?, ?)
    `).run(LAYER, key, content, importance, now, now);
    logger.debug(MODULE, `Stored new semantic knowledge: "${key}"`);
  }
}

/**
 * Retrieve a specific piece of knowledge by key.
 * Increments the access counter on retrieval.
 */
export function getKnowledge(key: string): MemoryEntry | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT id, layer, key, content, metadata, importance, access_count, created_at, updated_at, expires_at
    FROM memories
    WHERE layer = ? AND key = ?
  `).get(LAYER, key) as MemoryRow | undefined;

  if (!row) return null;

  // Increment access count
  db.prepare('UPDATE memories SET access_count = access_count + 1 WHERE id = ?').run(row.id);

  return rowToEntry(row);
}

/**
 * Search semantic knowledge by text content (case-insensitive substring match).
 */
export function searchKnowledge(query: string): MemoryEntry[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, layer, key, content, metadata, importance, access_count, created_at, updated_at, expires_at
    FROM memories
    WHERE layer = ? AND (content LIKE ? OR key LIKE ?)
    ORDER BY importance DESC, access_count DESC
    LIMIT 50
  `).all(LAYER, `%${query}%`, `%${query}%`) as MemoryRow[];

  return rows.map(rowToEntry);
}

/**
 * Update the content of an existing knowledge entry.
 * Throws if the key does not exist.
 */
export function updateKnowledge(key: string, content: string): void {
  const db = getDatabase();
  const now = Date.now();

  const result = db.prepare(`
    UPDATE memories SET content = ?, updated_at = ? WHERE layer = ? AND key = ?
  `).run(content, now, LAYER, key);

  if (result.changes === 0) {
    logger.warn(MODULE, `Cannot update: semantic key "${key}" not found`);
    throw new Error(`Semantic knowledge key "${key}" does not exist`);
  }

  logger.debug(MODULE, `Updated semantic knowledge: "${key}"`);
}
