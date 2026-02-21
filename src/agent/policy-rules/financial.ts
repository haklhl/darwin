// ============================================================
// Darwin - Policy Rule: Financial Limits
// ============================================================

import type { PolicyContext, PolicyRuleResult } from '../../types.js';

/** Maximum USDC per single transaction */
const MAX_SPEND_PER_TX = 20;

/** Maximum percentage of balance per single transaction */
const MAX_BALANCE_PERCENT_PER_TX = 0.20;

/** Financial tools that involve spending */
const FINANCIAL_TOOLS = new Set(['transfer_usdc', 'execute_defi']);

/**
 * Check financial limits for spending operations.
 * Enforces:
 * - Max spend per transaction (20 USDC)
 * - Max 20% of balance per transaction
 * - Deny if in critical survival tier
 *
 * Returns null if the rule does not apply (non-financial tools).
 */
export function financialRule(ctx: PolicyContext): PolicyRuleResult | null {
  if (!FINANCIAL_TOOLS.has(ctx.toolCall.name)) {
    return null;
  }

  // Extract amount from args
  const amount = extractAmount(ctx);

  if (amount === null) {
    return null; // Cannot determine amount, let other rules handle
  }

  // Block spending in critical tier
  if (ctx.survivalTier === 'critical' || ctx.survivalTier === 'dead') {
    return {
      decision: 'deny',
      reason: `Financial operations blocked in ${ctx.survivalTier} survival tier`,
      rule: 'financial',
    };
  }

  // Check absolute limit
  if (amount > MAX_SPEND_PER_TX) {
    return {
      decision: 'deny',
      reason: `Transaction amount ${amount} USDC exceeds max per-tx limit of ${MAX_SPEND_PER_TX} USDC`,
      rule: 'financial',
    };
  }

  // Check percentage of balance
  if (ctx.usdcBalance > 0) {
    const percentOfBalance = amount / ctx.usdcBalance;
    if (percentOfBalance > MAX_BALANCE_PERCENT_PER_TX) {
      return {
        decision: 'deny',
        reason: `Transaction amount ${amount} USDC is ${(percentOfBalance * 100).toFixed(1)}% of balance, exceeding ${MAX_BALANCE_PERCENT_PER_TX * 100}% limit`,
        rule: 'financial',
      };
    }
  } else if (amount > 0) {
    return {
      decision: 'deny',
      reason: 'Cannot spend with zero USDC balance',
      rule: 'financial',
    };
  }

  return null;
}

/**
 * Extract the spend amount from tool call args.
 */
function extractAmount(ctx: PolicyContext): number | null {
  const { args } = ctx.toolCall;

  // transfer_usdc has direct amount
  if (ctx.toolCall.name === 'transfer_usdc' && typeof args.amount === 'number') {
    return args.amount;
  }

  // execute_defi may have amount in params
  if (ctx.toolCall.name === 'execute_defi') {
    const params = args.params as Record<string, unknown> | undefined;
    if (params && typeof params.amount === 'number') {
      return params.amount;
    }
    if (typeof args.amount === 'number') {
      return args.amount;
    }
  }

  return null;
}
