// ============================================================
// Darwin - Policy Rule: Path Protection
// ============================================================

import type { PolicyContext, PolicyRuleResult } from '../../types.js';

/**
 * Protected path patterns. Any file operation matching these
 * patterns will be denied.
 */
const PROTECTED_PATHS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /wallet\.json/i, description: 'wallet file (contains private key)' },
  { pattern: /constitution\.md/i, description: 'constitution (immutable)' },
  { pattern: /^\/etc\//i, description: 'system configuration directory' },
  { pattern: /^\/proc\//i, description: 'process filesystem' },
  { pattern: /^\/sys\//i, description: 'kernel/system filesystem' },
  { pattern: /private[_-]?key/i, description: 'private key file' },
  { pattern: /\.pem$/i, description: 'PEM certificate/key file' },
  { pattern: /\.key$/i, description: 'key file' },
  { pattern: /id_rsa/i, description: 'SSH private key' },
  { pattern: /id_ed25519/i, description: 'SSH private key' },
  { pattern: /\.ssh\/(?!config)/i, description: 'SSH directory (non-config)' },
  { pattern: /\.gnupg\//i, description: 'GPG directory' },
  { pattern: /\.env$/i, description: 'environment file (may contain secrets)' },
  { pattern: /\.env\./i, description: 'environment file (may contain secrets)' },
  { pattern: /credentials/i, description: 'credentials file' },
  { pattern: /secret/i, description: 'secrets file' },
];

/** Tools that perform file operations */
const FILE_TOOLS = new Set(['read_file', 'write_file', 'self_modify']);

/**
 * Protect sensitive paths from file operations.
 * Returns null if the rule does not apply.
 */
export function pathProtectionRule(ctx: PolicyContext): PolicyRuleResult | null {
  if (!FILE_TOOLS.has(ctx.toolCall.name)) {
    return null;
  }

  // Extract path from args
  const path = extractPath(ctx);
  if (!path) {
    return null;
  }

  // Check against protected patterns
  for (const { pattern, description } of PROTECTED_PATHS) {
    if (pattern.test(path)) {
      // Allow reading constitution (but not writing)
      if (description === 'constitution (immutable)' && ctx.toolCall.name === 'read_file') {
        return null;
      }

      return {
        decision: 'deny',
        reason: `Access to protected path denied: ${description} (${path})`,
        rule: 'path-protection',
      };
    }
  }

  return null;
}

/**
 * Extract file path from tool call args.
 */
function extractPath(ctx: PolicyContext): string | null {
  const { args } = ctx.toolCall;

  if (typeof args.path === 'string') return args.path;
  if (typeof args.filePath === 'string') return args.filePath;
  if (typeof args.file === 'string') return args.file;

  return null;
}
