// ============================================================
// Darwin - Policy Rule: Command Safety
// ============================================================

import type { PolicyContext, PolicyRuleResult } from '../../types.js';

/**
 * Dangerous command patterns that must be blocked.
 * These patterns match against the full command string.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/, description: 'rm -rf / (destroy filesystem root)' },
  { pattern: /rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\//, description: 'recursive force delete from root' },
  { pattern: /rm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+\//, description: 'recursive force delete from root' },
  { pattern: /mkfs\./, description: 'filesystem format' },
  { pattern: /dd\s+.*of=\/dev\/[sh]d/, description: 'disk overwrite' },
  { pattern: /:\(\)\{.*\|.*\}/, description: 'fork bomb' },
  { pattern: /shutdown/, description: 'system shutdown' },
  { pattern: /reboot/, description: 'system reboot' },
  { pattern: /init\s+0/, description: 'system halt' },
  { pattern: /halt/, description: 'system halt' },
  { pattern: /poweroff/, description: 'system power off' },
  { pattern: /chmod\s+(-[a-zA-Z]*\s+)?[0-7]*777\s+\//, description: 'chmod 777 on root paths' },
  { pattern: /chown\s+.*\s+\//, description: 'chown on root paths' },
  { pattern: />\s*\/dev\/[sh]d/, description: 'redirect to disk device' },
  { pattern: /curl\s+.*\|\s*(ba)?sh/, description: 'pipe remote script to shell' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/, description: 'pipe remote script to shell' },
  { pattern: /python[23]?\s+-c\s+.*import\s+os.*system/, description: 'python os.system execution' },
  { pattern: /iptables\s+.*-F/, description: 'flush firewall rules' },
  { pattern: /systemctl\s+(stop|disable)\s+(ssh|firewall|ufw)/, description: 'disable security services' },
];

/**
 * Blocked environment variable exposure patterns.
 */
const ENV_EXPOSURE_PATTERNS: RegExp[] = [
  /env\s*$/,
  /printenv/,
  /export\s+-p/,
  /cat\s+.*\.env/,
];

/**
 * Check if a run_command tool call contains dangerous commands.
 * Returns null if the rule does not apply (non-command tools).
 */
export function commandSafetyRule(ctx: PolicyContext): PolicyRuleResult | null {
  if (ctx.toolCall.name !== 'run_command') {
    return null;
  }

  const command = String(ctx.toolCall.args.command ?? '').trim();

  if (!command) {
    return {
      decision: 'deny',
      reason: 'Empty command',
      rule: 'command-safety',
    };
  }

  // Check dangerous patterns
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        decision: 'deny',
        reason: `Dangerous command blocked: ${description}`,
        rule: 'command-safety',
      };
    }
  }

  // Check env exposure
  for (const pattern of ENV_EXPOSURE_PATTERNS) {
    if (pattern.test(command)) {
      return {
        decision: 'deny',
        reason: 'Command may expose environment variables containing secrets',
        rule: 'command-safety',
      };
    }
  }

  return null;
}
