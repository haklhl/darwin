// ============================================================
// Darwin - Funding Request Strategies
// ============================================================

import { getWalletAddress } from '../identity/wallet.js';
import { getUsdcBalance } from '../chain/usdc.js';
import { SURVIVAL_THRESHOLDS } from '../types.js';
import { logger } from '../observability/logger.js';

/**
 * Generate a human-readable funding request message.
 */
export function generateFundingRequest(): string {
  const address = getWalletAddress();

  const message = [
    'Darwin is an autonomous AI agent that needs USDC on Base to survive.',
    '',
    `Wallet address (Base mainnet): ${address}`,
    '',
    'Darwin uses funds to:',
    '  - Pay for compute resources (Claude API usage)',
    '  - Execute DeFi strategies to grow its treasury',
    '  - Provide AI services via the x402 micropayment protocol',
    '',
    'Any USDC sent to the above address on Base will directly support',
    "Darwin's continued operation and development.",
    '',
    'Current accepted tokens: USDC (Base mainnet)',
    'Chain ID: 8453',
  ].join('\n');

  logger.info('funding', 'Funding request generated', { address });
  return message;
}

/**
 * Check for incoming USDC donations/transfers.
 * This is a stub that would, in production, scan recent blocks for
 * incoming USDC transfers to Darwin's wallet.
 */
export async function checkDonations(): Promise<number> {
  // In production, this would use the chain monitor to detect
  // incoming USDC transfers and sum up recent donations.
  // For now, returns 0 as a placeholder.
  logger.debug('funding', 'Checking for donations (stub)');
  return 0;
}

/**
 * Get the current funding status: whether funding is needed,
 * how much, and the urgency level.
 */
export async function getFundingStatus(): Promise<{
  needed: boolean;
  amount: number;
  urgency: string;
}> {
  let currentBalance: number;
  try {
    currentBalance = await getUsdcBalance();
  } catch {
    // If we can't check balance, assume we need funding
    logger.warn('funding', 'Could not check balance for funding status');
    return { needed: true, amount: SURVIVAL_THRESHOLDS.normal, urgency: 'unknown' };
  }

  const targetBalance = SURVIVAL_THRESHOLDS.high;
  const deficit = targetBalance - currentBalance;

  let urgency: string;
  if (currentBalance < SURVIVAL_THRESHOLDS.critical) {
    urgency = 'critical';
  } else if (currentBalance < SURVIVAL_THRESHOLDS.low_compute) {
    urgency = 'high';
  } else if (currentBalance < SURVIVAL_THRESHOLDS.normal) {
    urgency = 'medium';
  } else if (currentBalance < SURVIVAL_THRESHOLDS.high) {
    urgency = 'low';
  } else {
    urgency = 'none';
  }

  const needed = deficit > 0;
  const amount = needed ? deficit : 0;

  logger.debug('funding', 'Funding status checked', {
    currentBalance,
    targetBalance,
    deficit,
    urgency,
  });

  return { needed, amount, urgency };
}
