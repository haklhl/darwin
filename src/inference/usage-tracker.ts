// ============================================================
// Darwin - Usage Tracking
// ============================================================

import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';
import type { UsageState } from '../types.js';

/**
 * Record a usage snapshot into the database.
 */
export function recordUsageSnapshot(percent: number, model: string, rawOutput: string): void {
  const db = getDatabase();

  try {
    db.prepare(`
      INSERT INTO usage_snapshots (timestamp, percent, model, raw_output)
      VALUES (?, ?, ?, ?)
    `).run(Date.now(), percent, model, rawOutput);

    logger.debug('usage-tracker', 'Usage snapshot recorded', { percent, model });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('usage-tracker', 'Failed to record usage snapshot', { error: errMsg });
  }
}

/**
 * Get the latest usage state by reading recent snapshots and computing trend.
 */
export function getLatestUsage(): UsageState {
  const db = getDatabase();

  // Get the most recent snapshot
  const latest = db.prepare(`
    SELECT percent, timestamp FROM usage_snapshots
    ORDER BY timestamp DESC LIMIT 1
  `).get() as { percent: number; timestamp: number } | undefined;

  const currentPercent = latest?.percent ?? 0;
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday

  // Compute weekly percent: estimate based on day of week and current usage
  // Assuming usage resets weekly, project weekly consumption
  const daysIntoWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
  const weeklyPercent = daysIntoWeek > 0
    ? Math.min(100, (currentPercent / daysIntoWeek) * 7)
    : currentPercent;

  // Reset day: assume Monday (1)
  const resetDay = 1;

  const trend = getUsageTrend(6);

  return {
    currentPercent,
    weeklyPercent,
    dayOfWeek,
    resetDay,
    trend,
  };
}

/**
 * Determine usage trend over the last N hours.
 * Compares the average of the first half of snapshots to the second half.
 */
export function getUsageTrend(hours: number): 'rising' | 'stable' | 'falling' {
  const db = getDatabase();
  const since = Date.now() - hours * 3600_000;

  const snapshots = db.prepare(`
    SELECT percent, timestamp FROM usage_snapshots
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `).all(since) as Array<{ percent: number; timestamp: number }>;

  if (snapshots.length < 2) {
    return 'stable';
  }

  const midpoint = Math.floor(snapshots.length / 2);
  const firstHalf = snapshots.slice(0, midpoint);
  const secondHalf = snapshots.slice(midpoint);

  const avgFirst = firstHalf.reduce((sum, s) => sum + s.percent, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((sum, s) => sum + s.percent, 0) / secondHalf.length;

  const diff = avgSecond - avgFirst;

  // Use a threshold to determine significant change
  if (diff > 2) {
    return 'rising';
  }
  if (diff < -2) {
    return 'falling';
  }

  return 'stable';
}
