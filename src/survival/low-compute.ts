// ============================================================
// Darwin - Low Compute Mode Management
// ============================================================

import { logger } from '../observability/logger.js';

interface LowComputeConfig {
  heartbeatMultiplier: number;
  disabledTasks: string[];
}

let lowComputeActive = false;

const NORMAL_CONFIG: LowComputeConfig = {
  heartbeatMultiplier: 1,
  disabledTasks: [],
};

const LOW_COMPUTE_CONFIG: LowComputeConfig = {
  heartbeatMultiplier: 4, // 4x slower heartbeat
  disabledTasks: [
    'defi_strategy_evaluation',
    'chain_monitor_poll',
    'memory_consolidation',
    'soul_reflection',
    'metric_snapshot',
    'self_modification_scan',
  ],
};

/**
 * Enter low-compute mode: reduce heartbeat frequency and disable
 * non-essential tasks to conserve resources.
 */
export function enterLowComputeMode(): void {
  if (lowComputeActive) {
    logger.debug('low-compute', 'Already in low-compute mode');
    return;
  }

  lowComputeActive = true;

  logger.warn('low-compute', 'Entering low-compute mode', {
    heartbeatMultiplier: LOW_COMPUTE_CONFIG.heartbeatMultiplier,
    disabledTasks: LOW_COMPUTE_CONFIG.disabledTasks,
  });
}

/**
 * Exit low-compute mode and restore normal operation parameters.
 */
export function exitLowComputeMode(): void {
  if (!lowComputeActive) {
    logger.debug('low-compute', 'Not in low-compute mode');
    return;
  }

  lowComputeActive = false;

  logger.info('low-compute', 'Exiting low-compute mode, restoring normal operation');
}

/**
 * Check whether low-compute mode is currently active.
 */
export function isInLowComputeMode(): boolean {
  return lowComputeActive;
}

/**
 * Get the current low-compute configuration.
 * Returns the active config (low-compute or normal).
 */
export function getLowComputeConfig(): LowComputeConfig {
  if (lowComputeActive) {
    return { ...LOW_COMPUTE_CONFIG };
  }
  return { ...NORMAL_CONFIG };
}
