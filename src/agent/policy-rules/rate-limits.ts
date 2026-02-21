// ============================================================
// Darwin - Policy Rule: Rate Limits
// ============================================================

import type { PolicyContext, PolicyRuleResult } from '../../types.js';

/** Rate limit window in milliseconds (1 minute) */
const WINDOW_MS = 60_000;

/** Default max calls per minute for most tools */
const DEFAULT_RATE_LIMIT = 10;

/** Max calls per minute for financial tools */
const FINANCIAL_RATE_LIMIT = 3;

/** Financial tools with stricter rate limits */
const FINANCIAL_TOOLS = new Set(['transfer_usdc', 'execute_defi']);

/**
 * In-memory rate tracking.
 * Maps tool name -> array of timestamps of recent calls.
 */
const callLog: Map<string, number[]> = new Map();

/**
 * Check rate limits for tool calls.
 * - Financial tools: max 3 per minute
 * - All other tools: max 10 per minute
 *
 * Returns null if the rate limit has not been exceeded.
 */
export function rateLimitRule(ctx: PolicyContext): PolicyRuleResult | null {
  const toolName = ctx.toolCall.name;
  const now = Date.now();
  const maxRate = FINANCIAL_TOOLS.has(toolName) ? FINANCIAL_RATE_LIMIT : DEFAULT_RATE_LIMIT;

  // Get or create call log for this tool
  let timestamps = callLog.get(toolName);
  if (!timestamps) {
    timestamps = [];
    callLog.set(toolName, timestamps);
  }

  // Remove entries outside the window
  const windowStart = now - WINDOW_MS;
  const filtered = timestamps.filter((t) => t > windowStart);
  callLog.set(toolName, filtered);

  // Check if we're over the limit
  if (filtered.length >= maxRate) {
    const category = FINANCIAL_TOOLS.has(toolName) ? 'financial' : 'general';
    return {
      decision: 'deny',
      reason: `Rate limit exceeded for ${toolName}: ${filtered.length}/${maxRate} calls per minute (${category})`,
      rule: 'rate-limits',
    };
  }

  // Record this call
  filtered.push(now);

  return null;
}

/**
 * Reset rate limit tracking (useful for testing).
 */
export function resetRateLimits(): void {
  callLog.clear();
}
