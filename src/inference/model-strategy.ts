// ============================================================
// Darwin - Model Selection Strategy
// ============================================================

import type { UsageState, TaskType, ModelTier } from '../types.js';

/**
 * Select the appropriate model tier based on current usage state and task type.
 *
 * Strategy:
 * - Usage > 80%: always haiku (conserve budget)
 * - Late week (day >= 4) and weeklyPercent > 60%: haiku
 * - Late week: sonnet
 * - Code generation or complex reasoning with usage < 50%: opus
 * - Default: sonnet
 */
export function selectModel(usage: UsageState, taskType: TaskType): ModelTier {
  // Critical usage - always use cheapest model
  if (usage.currentPercent > 80) {
    return 'haiku';
  }

  // Late in the week - be conservative
  if (usage.dayOfWeek >= 4) {
    if (usage.weeklyPercent > 60) {
      return 'haiku';
    }
    return 'sonnet';
  }

  // High-value tasks with plenty of budget
  if (
    (taskType === 'code_generation' || taskType === 'complex_reasoning') &&
    usage.currentPercent < 50
  ) {
    return 'opus';
  }

  // Default to balanced model
  return 'sonnet';
}

/**
 * Calculate the heartbeat interval based on usage percentage.
 * As usage increases, we slow down the heartbeat to conserve budget.
 *
 * @param usagePercent - Current usage percentage (0-100)
 * @param baseInterval - Base heartbeat interval in milliseconds
 * @returns Adjusted interval in milliseconds
 */
export function getHeartbeatInterval(usagePercent: number, baseInterval: number): number {
  if (usagePercent < 50) {
    return baseInterval;
  }

  if (usagePercent < 80) {
    return baseInterval * 2;
  }

  if (usagePercent < 95) {
    return baseInterval * 5;
  }

  return baseInterval * 10;
}
