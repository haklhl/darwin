// ============================================================
// Darwin - Model Selection Strategy (3-window usage aware)
// ============================================================

import type { UsageState, TaskType, ModelTier } from '../types.js';

/**
 * Select the appropriate model tier based on 3-window usage state and task type.
 *
 * Priority logic:
 * 1. If ANY usage window > 90%: haiku only (emergency conservation)
 * 2. If weekly Sonnet > 70%: avoid Sonnet → use haiku (or opus if low weeklyAll)
 * 3. If weekly all-models > 70%: haiku
 * 4. If session > 80%: haiku (wait for session reset)
 * 5. High-value tasks (code/reasoning) + all windows < 40%: opus
 * 6. Default: sonnet
 */
export function selectModel(usage: UsageState, taskType: TaskType): ModelTier {
  // Emergency: any window critically high
  if (usage.sessionPercent > 90 || usage.weeklyAllPercent > 90 || usage.weeklySonnetPercent > 90) {
    return 'haiku';
  }

  // Weekly Sonnet exhausted: avoid Sonnet
  if (usage.weeklySonnetPercent > 70) {
    // Can still use Opus if weeklyAll has room
    if (usage.weeklyAllPercent < 50 && (taskType === 'code_generation' || taskType === 'complex_reasoning')) {
      return 'opus';
    }
    return 'haiku';
  }

  // Weekly all-models high: conserve
  if (usage.weeklyAllPercent > 70) {
    return 'haiku';
  }

  // Session high: throttle back
  if (usage.sessionPercent > 80) {
    return 'haiku';
  }

  // Medium usage zones
  if (usage.weeklyAllPercent > 50 || usage.weeklySonnetPercent > 50) {
    // Be conservative: sonnet for important tasks, haiku otherwise
    if (taskType === 'code_generation' || taskType === 'complex_reasoning' || taskType === 'conversation') {
      return 'sonnet';
    }
    return 'haiku';
  }

  // Low usage: can afford expensive models for high-value tasks
  if (
    (taskType === 'code_generation' || taskType === 'complex_reasoning') &&
    usage.weeklyAllPercent < 40 && usage.sessionPercent < 50
  ) {
    return 'opus';
  }

  // Default: balanced model
  return 'sonnet';
}

/**
 * Calculate the heartbeat interval based on usage.
 * Uses the highest of the 3 usage windows.
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
