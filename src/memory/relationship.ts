// ============================================================
// Darwin - Relationship Memory (trust scores, persisted to DB)
// ============================================================

import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';

const MODULE = 'memory-relationship';

/**
 * Update the trust score for an entity.
 * The score is clamped to [0, 1].
 * @param entity - The entity identifier (e.g. wallet address, username).
 * @param delta - Amount to add to the current score (can be negative).
 * @param reason - Reason for the trust change.
 */
export function updateTrust(entity: string, delta: number, reason: string): void {
  const db = getDatabase();
  const now = Date.now();

  // Get current score or default to 0.5
  const existing = db.prepare(
    'SELECT id, score, interactions FROM trust_scores WHERE entity = ?',
  ).get(entity) as { id: number; score: number; interactions: number } | undefined;

  if (existing) {
    const newScore = Math.max(0, Math.min(1, existing.score + delta));
    db.prepare(`
      UPDATE trust_scores
      SET score = ?, interactions = interactions + 1, last_interaction = ?, notes = ?
      WHERE id = ?
    `).run(newScore, now, reason, existing.id);
    logger.debug(MODULE, `Updated trust for "${entity}": ${existing.score.toFixed(3)} -> ${newScore.toFixed(3)}`, {
      delta,
      reason,
    });
  } else {
    const initialScore = Math.max(0, Math.min(1, 0.5 + delta));
    db.prepare(`
      INSERT INTO trust_scores (entity, score, interactions, last_interaction, notes)
      VALUES (?, ?, 1, ?, ?)
    `).run(entity, initialScore, now, reason);
    logger.debug(MODULE, `Created trust record for "${entity}": ${initialScore.toFixed(3)}`, {
      delta,
      reason,
    });
  }
}

/**
 * Get the current trust score for an entity.
 * Returns 0.5 (neutral) if the entity is unknown.
 */
export function getTrust(entity: string): number {
  const db = getDatabase();

  const row = db.prepare(
    'SELECT score FROM trust_scores WHERE entity = ?',
  ).get(entity) as { score: number } | undefined;

  return row?.score ?? 0.5;
}

/**
 * Get all known relationships with their trust scores and interaction counts.
 */
export function getRelationships(): Array<{ entity: string; score: number; interactions: number }> {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT entity, score, interactions
    FROM trust_scores
    ORDER BY interactions DESC, score DESC
  `).all() as Array<{ entity: string; score: number; interactions: number }>;

  return rows;
}
