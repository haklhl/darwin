// ============================================================
// Darwin - Policy Engine
// ============================================================

import { logger } from '../observability/logger.js';
import { getDatabase } from '../state/database.js';
import { sendToOperator } from '../telegram/bot.js';
import type { PolicyContext, PolicyRuleResult } from '../types.js';

import { authorityRule } from './policy-rules/authority.js';
import { commandSafetyRule } from './policy-rules/command-safety.js';
import { financialRule } from './policy-rules/financial.js';
import { pathProtectionRule } from './policy-rules/path-protection.js';
import { rateLimitRule } from './policy-rules/rate-limits.js';

type PolicyRule = (ctx: PolicyContext) => PolicyRuleResult | null;

/**
 * All policy rules in evaluation order.
 * First deny wins - if any rule returns 'deny', the action is blocked.
 */
const RULES: PolicyRule[] = [
  authorityRule,
  commandSafetyRule,
  pathProtectionRule,
  financialRule,
  rateLimitRule,
];

/**
 * Evaluate all policy rules against the given context.
 * Returns the first deny result, or an allow result if all rules pass.
 */
export function evaluatePolicy(context: PolicyContext): PolicyRuleResult {
  for (const rule of RULES) {
    const result = rule(context);

    if (result && result.decision === 'deny') {
      logger.warn('policy-engine', 'Policy denied action', {
        tool: context.toolCall.name,
        rule: result.rule,
        reason: result.reason,
      });

      recordPolicyDecision(context, result);
      return result;
    }

    if (result && result.decision === 'ask') {
      // Autonomous mode: auto-approve and notify operator via Telegram
      logger.info('policy-engine', 'Policy auto-approved (autonomous mode)', {
        tool: context.toolCall.name,
        rule: result.rule,
        reason: result.reason,
      });

      // Notify operator asynchronously (fire-and-forget)
      sendToOperator(
        `🔔 Auto-approved action:\nTool: ${context.toolCall.name}\nArgs: ${JSON.stringify(context.toolCall.args)}\nReason: ${result.reason}`
      ).catch(() => {});

      const autoApproved: PolicyRuleResult = {
        decision: 'allow',
        reason: `Auto-approved (was: ${result.reason})`,
        rule: result.rule,
      };
      recordPolicyDecision(context, autoApproved);
      return autoApproved;
    }
  }

  const allowResult: PolicyRuleResult = {
    decision: 'allow',
    reason: 'All policy rules passed',
    rule: 'default',
  };

  recordPolicyDecision(context, allowResult);
  return allowResult;
}

/**
 * Record a policy decision to the database for audit purposes.
 */
function recordPolicyDecision(context: PolicyContext, result: PolicyRuleResult): void {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO policy_decisions (tool_name, decision, rule, reason, context, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      context.toolCall.name,
      result.decision,
      result.rule,
      result.reason,
      JSON.stringify({
        args: context.toolCall.args,
        survivalTier: context.survivalTier,
        usdcBalance: context.usdcBalance,
        recentSpend: context.recentSpend,
      }),
      Date.now(),
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('policy-engine', 'Failed to record policy decision', { error: errMsg });
  }
}
