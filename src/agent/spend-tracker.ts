// ============================================================
// Darwin - Spend Tracker
// ============================================================

import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';

/** In-memory session spend accumulator */
let sessionSpend = 0;
const sessionStartTime = Date.now();

/**
 * Record a spend event in the database and update session total.
 */
export function recordSpend(amount: number, category: string, description: string): void {
  const db = getDatabase();

  try {
    db.prepare(`
      INSERT INTO spend_tracking (category, amount, currency, description, timestamp)
      VALUES (?, ?, 'USDC', ?, ?)
    `).run(category, amount, description, Date.now());

    sessionSpend += amount;

    logger.info('spend-tracker', 'Spend recorded', {
      amount,
      category,
      description,
      sessionTotal: sessionSpend,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('spend-tracker', 'Failed to record spend', { error: errMsg });
  }
}

/**
 * Get the total spend for the current session.
 */
export function getSessionSpend(): number {
  return sessionSpend;
}

/**
 * Get the total spend for the current day (last 24 hours).
 */
export function getDailySpend(): number {
  const db = getDatabase();
  const since = Date.now() - 24 * 3600_000;

  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM spend_tracking
      WHERE timestamp > ?
    `).get(since) as { total: number };

    return row.total;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('spend-tracker', 'Failed to get daily spend', { error: errMsg });
    return 0;
  }
}

/**
 * Get the total spend since the session started (from DB, more accurate than in-memory).
 */
export function getSessionSpendFromDb(): number {
  const db = getDatabase();

  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM spend_tracking
      WHERE timestamp > ?
    `).get(sessionStartTime) as { total: number };

    return row.total;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('spend-tracker', 'Failed to get session spend from DB', { error: errMsg });
    return sessionSpend;
  }
}

/**
 * Reset the in-memory session spend counter.
 * Useful for testing or session restarts.
 */
export function resetSessionSpend(): void {
  sessionSpend = 0;
}
