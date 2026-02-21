// ============================================================
// Darwin - Earnings Tracker
// ============================================================

import type { EarningSource, EarningRecord } from '../types.js';
import { getDatabase, recordEarning } from '../state/database.js';
import { logger } from '../observability/logger.js';

/**
 * Record an earning event to the database.
 */
export function recordEarningEvent(
  source: EarningSource,
  amount: number,
  description: string,
  txHash?: string,
): void {
  recordEarning(source, amount, description, txHash);
  logger.info('earnings', `Recorded earning: ${amount} USDC from ${source}`, {
    source,
    amount,
    description,
    txHash,
  });
}

/**
 * Get a full earnings summary: total, breakdown by source, and recent windows.
 */
export function getEarningsSummary(): {
  total: number;
  bySource: Record<string, number>;
  last24h: number;
  last7d: number;
} {
  const db = getDatabase();

  // Total earnings
  const totalRow = db
    .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM earnings_log')
    .get() as { total: number };

  // By source
  const sourceRows = db
    .prepare(
      'SELECT source, COALESCE(SUM(amount), 0) as total FROM earnings_log GROUP BY source',
    )
    .all() as Array<{ source: string; total: number }>;

  const bySource: Record<string, number> = {};
  for (const row of sourceRows) {
    bySource[row.source] = row.total;
  }

  // Last 24 hours
  const since24h = Date.now() - 24 * 3600_000;
  const last24hRow = db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM earnings_log WHERE timestamp > ?',
    )
    .get(since24h) as { total: number };

  // Last 7 days
  const since7d = Date.now() - 7 * 24 * 3600_000;
  const last7dRow = db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM earnings_log WHERE timestamp > ?',
    )
    .get(since7d) as { total: number };

  return {
    total: totalRow.total,
    bySource,
    last24h: last24hRow.total,
    last7d: last7dRow.total,
  };
}

/**
 * Get the most recent earning records.
 */
export function getRecentEarnings(limit: number = 20): EarningRecord[] {
  const db = getDatabase();

  const rows = db
    .prepare(
      'SELECT id, source, amount, currency, tx_hash, description, timestamp FROM earnings_log ORDER BY timestamp DESC LIMIT ?',
    )
    .all(limit) as Array<{
    id: number;
    source: string;
    amount: number;
    currency: string;
    tx_hash: string | null;
    description: string;
    timestamp: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    source: row.source as EarningSource,
    amount: row.amount,
    currency: row.currency,
    txHash: row.tx_hash ?? undefined,
    description: row.description,
    timestamp: row.timestamp,
  }));
}
