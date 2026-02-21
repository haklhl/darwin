// ============================================================
// Darwin - Budget & Rate Management
// ============================================================

import type { ModelTier } from '../types.js';

/**
 * Determine whether requests should be throttled based on current usage.
 * Takes the highest usage percentage across all 3 windows.
 * Throttling kicks in above 70%.
 */
export function shouldThrottle(usagePercent: number): boolean {
  return usagePercent > 70;
}

/**
 * Get the delay in milliseconds to apply before the next request.
 * Higher usage means longer delays to conserve budget.
 */
export function getThrottleDelay(usagePercent: number): number {
  if (usagePercent <= 70) {
    return 0;
  }

  if (usagePercent <= 80) {
    return 2_000;     // Light: 2 seconds
  }

  if (usagePercent <= 90) {
    return 10_000;    // Moderate: 10 seconds
  }

  if (usagePercent <= 95) {
    return 30_000;    // Heavy: 30 seconds
  }

  return 60_000;      // Critical: 60 seconds
}

/**
 * Check whether a given model tier is allowed at the current usage levels.
 * More expensive models are restricted at higher usage.
 *
 * @param model - The model tier to check
 * @param usagePercent - Highest usage percentage across all windows (0-100)
 * @param weeklySonnetPercent - Weekly Sonnet-specific usage (0-100)
 * @returns true if the model can be used
 */
export function canUseModel(model: ModelTier, usagePercent: number, weeklySonnetPercent: number = 0): boolean {
  switch (model) {
    case 'opus':
      // Opus allowed below 50% overall
      return usagePercent < 50;

    case 'sonnet':
      // Sonnet blocked if weekly Sonnet > 80% OR overall > 80%
      return usagePercent < 80 && weeklySonnetPercent < 80;

    case 'haiku':
      // Haiku always allowed (cheapest model)
      return true;

    default:
      return false;
  }
}
