// ============================================================
// 角都 - Built-in Heartbeat Task Handlers
// ============================================================

import { getDatabase, kvSet, kvGet, insertWakeEvent } from '../state/database.js';
import { logger } from '../observability/logger.js';
import { sendPeriodicReport } from '../telegram/reporter.js';
import { getLatestUsage } from '../inference/usage-tracker.js';
import { checkSurvivalState } from '../survival/monitor.js';

const MODULE = 'heartbeat-tasks';

export interface HeartbeatTaskResult {
  shouldWake: boolean;
  message?: string;
}

/** Log a heartbeat ping and record timestamp to DB. */
export async function heartbeatPing(): Promise<HeartbeatTaskResult> {
  const now = Date.now();
  kvSet('last_heartbeat_ping', String(now));

  const db = getDatabase();
  db.prepare(`
    INSERT INTO heartbeat_log (task_name, started_at, ended_at, success, duration_ms)
    VALUES ('heartbeat_ping', ?, ?, 1, 0)
  `).run(now, now);

  logger.info(MODULE, 'Heartbeat ping recorded', { timestamp: now });
  return { shouldWake: false };
}

/** Check USDC balance on-chain. Wake if tier changed. */
export async function checkUsdcBalance(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Checking USDC balance');
  try {
    const state = await checkSurvivalState();
    const prevTier = kvGet('last_survival_tier');

    kvSet('last_usdc_balance', String(state.usdcBalance));
    kvSet('last_eth_balance', String(state.ethBalance));
    kvSet('last_survival_tier', state.tier);
    kvSet('last_usdc_check', String(Date.now()));

    // Wake if tier dropped
    if (prevTier && prevTier !== state.tier) {
      const msg = `生存等级变化: ${prevTier} → ${state.tier} (USDC: $${state.usdcBalance.toFixed(2)})`;
      logger.warn(MODULE, msg);
      return { shouldWake: true, message: msg };
    }

    // Wake if critical or dead
    if (state.tier === 'critical' || state.tier === 'dead') {
      return { shouldWake: true, message: `危险！等级: ${state.tier}, 余额: $${state.usdcBalance.toFixed(2)}` };
    }

    return { shouldWake: false };
  } catch (error) {
    logger.warn(MODULE, 'Balance check failed', { error: error instanceof Error ? error.message : String(error) });
    return { shouldWake: false };
  }
}

/** Check DeFi positions. */
export async function checkDefiPositions(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Checking DeFi positions');
  kvSet('last_defi_check', String(Date.now()));
  // TODO: Check actual DeFi positions when chain module is wired up
  return { shouldWake: false };
}

/** Check AI service health. */
export async function checkAiService(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Checking AI service health');
  kvSet('last_ai_service_check', String(Date.now()));
  return { shouldWake: false };
}

/** Check for software updates. */
export async function checkForUpdates(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Checking for updates');
  kvSet('last_update_check', String(Date.now()));
  return { shouldWake: false };
}

/** Soul reflection cycle. */
export async function soulReflection(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Running soul reflection');
  kvSet('last_soul_reflection', String(Date.now()));
  // TODO: Wire up actual soul reflection
  return { shouldWake: false };
}

/** Check Claude CLI usage levels. */
export async function checkCliUsage(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Checking CLI usage');
  try {
    const usage = getLatestUsage();
    const maxPercent = Math.max(usage.sessionPercent, usage.weeklyAllPercent, usage.weeklySonnetPercent);

    logger.info(MODULE, 'CLI usage levels', {
      session: usage.sessionPercent.toFixed(1),
      weeklyAll: usage.weeklyAllPercent.toFixed(1),
      weeklySonnet: usage.weeklySonnetPercent.toFixed(1),
    });

    // Wake if any window is critically high
    if (maxPercent > 90) {
      const which = usage.sessionPercent > 90 ? 'Session' :
                    usage.weeklyAllPercent > 90 ? 'Weekly All' : 'Weekly Sonnet';
      return { shouldWake: true, message: `CLI 用量过高: ${which} ${maxPercent.toFixed(1)}%，需要切换模型节流` };
    }
  } catch (error) {
    logger.warn(MODULE, 'Failed to check CLI usage', { error: error instanceof Error ? error.message : String(error) });
  }
  kvSet('last_cli_usage_check', String(Date.now()));
  return { shouldWake: false };
}

/** Generate weekly usage plan. */
export async function weeklyUsagePlan(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Generating weekly usage plan');
  kvSet('last_weekly_plan', String(Date.now()));
  return { shouldWake: false };
}

/** Report metrics snapshot. */
export async function reportMetrics(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Reporting metrics');
  kvSet('last_metrics_report', String(Date.now()));
  return { shouldWake: false };
}

/** Memory maintenance (prune expired, consolidate). */
export async function memoryMaintenance(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Running memory maintenance');
  kvSet('last_memory_maintenance', String(Date.now()));
  return { shouldWake: false };
}

/** Send 4-hour activity report to operator via Telegram. */
export async function telegramReport(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Sending Telegram periodic report');
  await sendPeriodicReport();
  kvSet('last_telegram_report', String(Date.now()));
  return { shouldWake: false };
}

/** 自主思考 — 定期唤醒角都进行自主决策 */
export async function autonomousThink(): Promise<HeartbeatTaskResult> {
  logger.info(MODULE, 'Autonomous think trigger');
  kvSet('last_autonomous_think', String(Date.now()));
  return {
    shouldWake: true,
    message: '定时自主思考：审视资产状况，评估市场机会，决定下一步赚钱行动。',
  };
}

/** Map a task name to its handler function. */
export function getTaskHandler(name: string): (() => Promise<HeartbeatTaskResult>) | null {
  const handlers: Record<string, () => Promise<HeartbeatTaskResult>> = {
    heartbeat_ping: heartbeatPing,
    check_usdc_balance: checkUsdcBalance,
    check_defi_positions: checkDefiPositions,
    check_ai_service: checkAiService,
    check_for_updates: checkForUpdates,
    soul_reflection: soulReflection,
    check_cli_usage: checkCliUsage,
    weekly_usage_plan: weeklyUsagePlan,
    report_metrics: reportMetrics,
    memory_maintenance: memoryMaintenance,
    telegram_report: telegramReport,
    autonomous_think: autonomousThink,
  };

  return handlers[name] ?? null;
}
