// ============================================================
// Darwin - Metrics Collection
// ============================================================

import type { MetricSnapshot } from '../types.js';
import { getDatabase } from '../state/database.js';
import { logger } from './logger.js';

export function recordMetricSnapshot(snapshot: MetricSnapshot): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO metric_snapshots (
      timestamp, usdc_balance, eth_balance, survival_tier,
      heartbeat_count, agent_loop_count, total_earnings,
      total_spend, memory_entries, usage_percent, active_model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.timestamp,
    snapshot.usdcBalance,
    snapshot.ethBalance,
    snapshot.survivalTier,
    snapshot.heartbeatCount,
    snapshot.agentLoopCount,
    snapshot.totalEarnings,
    snapshot.totalSpend,
    snapshot.memoryEntries,
    snapshot.usagePercent,
    snapshot.activeModel,
  );
}

export function getLatestMetrics(): MetricSnapshot | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM metric_snapshots ORDER BY timestamp DESC LIMIT 1
  `).get() as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    timestamp: row.timestamp as number,
    usdcBalance: row.usdc_balance as number,
    ethBalance: row.eth_balance as number,
    survivalTier: row.survival_tier as MetricSnapshot['survivalTier'],
    heartbeatCount: row.heartbeat_count as number,
    agentLoopCount: row.agent_loop_count as number,
    totalEarnings: row.total_earnings as number,
    totalSpend: row.total_spend as number,
    memoryEntries: row.memory_entries as number,
    usagePercent: row.usage_percent as number,
    activeModel: row.active_model as MetricSnapshot['activeModel'],
  };
}

export function getMetricHistory(hours: number = 24): MetricSnapshot[] {
  const db = getDatabase();
  const since = Date.now() - hours * 3600_000;
  const rows = db.prepare(`
    SELECT * FROM metric_snapshots WHERE timestamp > ? ORDER BY timestamp ASC
  `).all(since) as Record<string, unknown>[];

  return rows.map(row => ({
    timestamp: row.timestamp as number,
    usdcBalance: row.usdc_balance as number,
    ethBalance: row.eth_balance as number,
    survivalTier: row.survival_tier as MetricSnapshot['survivalTier'],
    heartbeatCount: row.heartbeat_count as number,
    agentLoopCount: row.agent_loop_count as number,
    totalEarnings: row.total_earnings as number,
    totalSpend: row.total_spend as number,
    memoryEntries: row.memory_entries as number,
    usagePercent: row.usage_percent as number,
    activeModel: row.active_model as MetricSnapshot['activeModel'],
  }));
}

export function logMetricsSummary(): void {
  const latest = getLatestMetrics();
  if (!latest) {
    logger.info('metrics', 'No metrics recorded yet');
    return;
  }

  logger.info('metrics', 'Current status', {
    tier: latest.survivalTier,
    usdc: latest.usdcBalance,
    eth: latest.ethBalance,
    earnings: latest.totalEarnings,
    spend: latest.totalSpend,
    usage: `${latest.usagePercent}%`,
    model: latest.activeModel,
  });
}
