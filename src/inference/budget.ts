// ============================================================
// Darwin - Budget & Rate Management
// ============================================================

import type { ModelTier } from '../types.js';

/**
 * Determine whether requests should be throttled based on current usage.
 * Throttling kicks in above 70% usage.
 */
export function shouldThrottle(usagePercent: number): boolean {
  return usagePercent > 70;
}

/**
 * Get the delay in milliseconds to apply before the next request.
 * Higher usage means longer delays to conserve budget.
 *
 * @param usagePercent - Current usage percentage (0-100)
 * @returns Delay in milliseconds (0 if no throttling needed)
 */
export function getThrottleDelay(usagePercent: number): number {
  if (usagePercent <= 70) {
    return 0;
  }

  if (usagePercent <= 80) {
    // Light throttle: 2 seconds
    return 2_000;
  }

  if (usagePercent <= 90) {
    // Moderate throttle: 10 seconds
    return 10_000;
  }

  if (usagePercent <= 95) {
    // Heavy throttle: 30 seconds
    return 30_000;
  }

  // Critical: 60 seconds
  return 60_000;
}

/**
 * Check whether a given model tier is allowed at the current usage level.
 * More expensive models are restricted at higher usage.
 *
 * @param model - The model tier to check
 * @param usagePercent - Current usage percentage (0-100)
 * @returns true if the model can be used
 */
export function canUseModel(model: ModelTier, usagePercent: number): boolean {
  switch (model) {
    case 'opus':
      // Opus only allowed below 50% usage
      return usagePercent < 50;

    case 'sonnet':
      // Sonnet allowed below 80% usage
      return usagePercent < 80;

    case 'haiku':
      // Haiku always allowed (cheapest model)
      return true;

    default:
      return false;
  }
}
