// ============================================================
// Darwin - Survival State Monitor
// ============================================================

import type { SurvivalState, SurvivalTier } from '../types.js';
import { SURVIVAL_THRESHOLDS } from '../types.js';
import { getUsdcBalance, getEthBalance } from '../chain/usdc.js';
import { kvGet, kvSet } from '../state/database.js';
import { logger } from '../observability/logger.js';

const SURVIVAL_HISTORY_KEY = 'survival_history';
let lastKnownTier: SurvivalTier | null = null;

/**
 * Check the current survival state by querying on-chain balances
 * and determining the appropriate tier.
 */
export async function checkSurvivalState(): Promise<SurvivalState> {
  const usdcBalance = await getUsdcBalance();
  const ethBalance = await getEthBalance();
  const tier = determineTier(usdcBalance);

  const state: SurvivalState = {
    tier,
    usdcBalance,
    ethBalance,
    lastChecked: Date.now(),
  };

  // Detect tier changes
  if (lastKnownTier !== null && lastKnownTier !== tier) {
    onTierChange(lastKnownTier, tier);
  }
  lastKnownTier = tier;

  // Record to history
  appendSurvivalHistory(tier);

  logger.info('survival', `Survival check: ${tier}`, {
    usdcBalance,
    ethBalance,
    tier,
  });

  return state;
}

/**
 * Determine the survival tier based on USDC balance.
 * Tiers are checked from highest to lowest threshold.
 */
export function determineTier(usdcBalance: number): SurvivalTier {
  if (usdcBalance >= SURVIVAL_THRESHOLDS.high) return 'high';
  if (usdcBalance >= SURVIVAL_THRESHOLDS.normal) return 'normal';
  if (usdcBalance >= SURVIVAL_THRESHOLDS.low_compute) return 'low_compute';
  if (usdcBalance >= SURVIVAL_THRESHOLDS.critical) return 'critical';
  return 'dead';
}

/**
 * Handle a tier transition by logging and triggering appropriate responses.
 */
export function onTierChange(
  oldTier: SurvivalTier,
  newTier: SurvivalTier,
): void {
  const tierOrder: SurvivalTier[] = ['dead', 'critical', 'low_compute', 'normal', 'high'];
  const oldIndex = tierOrder.indexOf(oldTier);
  const newIndex = tierOrder.indexOf(newTier);
  const direction = newIndex > oldIndex ? 'improved' : 'degraded';

  logger.warn('survival', `Survival tier ${direction}: ${oldTier} -> ${newTier}`, {
    oldTier,
    newTier,
    direction,
  });

  if (direction === 'degraded') {
    if (newTier === 'critical') {
      logger.error('survival', 'CRITICAL: Survival at risk. Immediate action required.');
    } else if (newTier === 'dead') {
      logger.error('survival', 'DEAD: Insufficient funds. Agent cannot operate.');
    } else if (newTier === 'low_compute') {
      logger.warn('survival', 'Entering low-compute mode to conserve resources.');
    }
  }

  if (direction === 'improved') {
    if (oldTier === 'critical' || oldTier === 'dead') {
      logger.info('survival', 'Recovery detected. Resuming normal operations.');
    }
  }
}

/**
 * Retrieve the survival tier history from the kv_store.
 */
export function getSurvivalHistory(): Array<{
  tier: SurvivalTier;
  timestamp: number;
}> {
  const raw = kvGet(SURVIVAL_HISTORY_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as Array<{ tier: SurvivalTier; timestamp: number }>;
  } catch {
    return [];
  }
}

/**
 * Append a tier entry to the survival history.
 * Keeps the last 500 entries.
 */
function appendSurvivalHistory(tier: SurvivalTier): void {
  const history = getSurvivalHistory();

  // Only record if the tier changed or it's been more than 5 minutes since the last entry
  const lastEntry = history[history.length - 1];
  if (
    lastEntry &&
    lastEntry.tier === tier &&
    Date.now() - lastEntry.timestamp < 5 * 60_000
  ) {
    return;
  }

  history.push({ tier, timestamp: Date.now() });

  // Keep only the last 500 entries
  while (history.length > 500) {
    history.shift();
  }

  kvSet(SURVIVAL_HISTORY_KEY, JSON.stringify(history));
}
