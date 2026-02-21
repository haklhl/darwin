// ============================================================
// Darwin - Telegram 4-Hour Reporter
// ============================================================

import { logger } from '../observability/logger.js';
import { getDatabase } from '../state/database.js';
import { sendToOperator } from './bot.js';
import { checkSurvivalState } from '../survival/monitor.js';

const MODULE = 'telegram-reporter';
const REPORT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Generate and send a 4-hour activity report to the operator.
 */
export async function sendPeriodicReport(): Promise<void> {
  logger.info(MODULE, 'Generating 4-hour report');

  try {
    const report = await generateReport();
    await sendToOperator(report);
    logger.info(MODULE, 'Report sent successfully');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(MODULE, 'Failed to send report', { error: msg });
  }
}

/**
 * Generate the report content by querying the database.
 */
async function generateReport(): Promise<string> {
  const now = Date.now();
  const since = now - REPORT_INTERVAL_MS;
  const db = getDatabase();

  // Time range formatting
  const startTime = new Date(since).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const endTime = new Date(now).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = new Date(now).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });

  // 1. Current balance and tier
  let balanceStr = 'Unknown';
  let tierStr = 'Unknown';
  try {
    const state = await checkSurvivalState();
    balanceStr = `$${state.usdcBalance.toFixed(2)} USDC | ${state.ethBalance.toFixed(6)} ETH`;
    tierStr = state.tier.toUpperCase();
  } catch {
    // Use fallback
  }

  // 2. Earnings in period
  const earningsRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM earnings_log
    WHERE timestamp > ?
  `).get(since) as { total: number };

  const earningsDetail = db.prepare(`
    SELECT source, SUM(amount) as total
    FROM earnings_log
    WHERE timestamp > ?
    GROUP BY source
  `).all(since) as Array<{ source: string; total: number }>;

  // 3. Spend in period
  const spendRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM spend_tracking
    WHERE timestamp > ?
  `).get(since) as { total: number };

  // 4. Activity summary from heartbeat_log
  const activities = db.prepare(`
    SELECT task_name, COUNT(*) as count, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
    FROM heartbeat_log
    WHERE started_at > ?
    GROUP BY task_name
    ORDER BY count DESC
  `).all(since) as Array<{ task_name: string; count: number; success_count: number }>;

  // 5. Agent loops in period
  const agentLoops = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(steps_count), 0) as total_steps
    FROM conversations
    WHERE started_at > ?
  `).get(since) as { count: number; total_steps: number };

  // 6. Policy decisions
  const policyStats = db.prepare(`
    SELECT decision, COUNT(*) as count
    FROM policy_decisions
    WHERE timestamp > ?
    GROUP BY decision
  `).all(since) as Array<{ decision: string; count: number }>;

  // Build report
  let report = `🧬 Darwin 4小时汇报\n`;
  report += `━━━━━━━━━━━━━━━━━━\n`;
  report += `⏰ ${dateStr} ${startTime} - ${endTime}\n`;
  report += `💰 余额: ${balanceStr}\n`;
  report += `📊 生存层级: ${tierStr}\n`;
  report += `\n`;

  // Financials
  const netValue = earningsRow.total - spendRow.total;
  const netSign = netValue >= 0 ? '+' : '';
  report += `📈 收支:\n`;
  report += `  收入: +$${earningsRow.total.toFixed(4)}`;
  if (earningsDetail.length > 0) {
    report += ` (${earningsDetail.map(e => `${e.source}: $${e.total.toFixed(4)}`).join(', ')})`;
  }
  report += `\n`;
  report += `  支出: -$${spendRow.total.toFixed(4)}\n`;
  report += `  净值: ${netSign}$${netValue.toFixed(4)}\n`;
  report += `\n`;

  // Activity
  report += `🔧 活动摘要:\n`;
  if (activities.length === 0 && agentLoops.count === 0) {
    report += `  (无活动记录)\n`;
  } else {
    for (const act of activities) {
      const failCount = act.count - act.success_count;
      const failStr = failCount > 0 ? ` (${failCount} failed)` : '';
      report += `  - ${act.task_name} x${act.count}${failStr}\n`;
    }
    if (agentLoops.count > 0) {
      report += `  - Agent loops: ${agentLoops.count} (${agentLoops.total_steps} steps)\n`;
    }
  }

  // Policy
  if (policyStats.length > 0) {
    report += `\n🛡️ 策略决策:\n`;
    for (const p of policyStats) {
      report += `  ${p.decision}: ${p.count}\n`;
    }
  }

  report += `\n📋 下一步:\n`;
  report += `  - 继续自主运行和监控\n`;
  report += `  - 维护心跳和服务健康\n`;

  return report;
}
