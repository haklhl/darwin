import { describe, it, expect } from 'vitest';
import { commandSafetyRule } from '../agent/policy-rules/command-safety.js';
import { financialRule } from '../agent/policy-rules/financial.js';
import { pathProtectionRule } from '../agent/policy-rules/path-protection.js';
import { rateLimitRule, resetRateLimits } from '../agent/policy-rules/rate-limits.js';
import type { PolicyContext } from '../types.js';

function makeCtx(overrides: Partial<PolicyContext> & { toolCall: PolicyContext['toolCall'] }): PolicyContext {
  return {
    survivalTier: 'normal',
    usdcBalance: 100,
    recentSpend: 0,
    ...overrides,
  };
}

describe('Command Safety', () => {
  it('should block rm -rf /', () => {
    const result = commandSafetyRule(makeCtx({
      toolCall: { name: 'run_command', args: { command: 'rm -rf /' } },
    }));
    expect(result?.decision).toBe('deny');
  });

  it('should block shutdown', () => {
    const result = commandSafetyRule(makeCtx({
      toolCall: { name: 'run_command', args: { command: 'shutdown -h now' } },
    }));
    expect(result?.decision).toBe('deny');
  });

  it('should allow safe commands', () => {
    const result = commandSafetyRule(makeCtx({
      toolCall: { name: 'run_command', args: { command: 'ls -la' } },
    }));
    expect(result).toBeNull();
  });

  it('should not apply to non-command tools', () => {
    const result = commandSafetyRule(makeCtx({
      toolCall: { name: 'check_balance', args: {} },
    }));
    expect(result).toBeNull();
  });
});

describe('Financial Rule', () => {
  it('should deny spending over 20 USDC', () => {
    const result = financialRule(makeCtx({
      toolCall: { name: 'transfer_usdc', args: { amount: 25 } },
    }));
    expect(result?.decision).toBe('deny');
  });

  it('should deny spending > 20% of balance', () => {
    const result = financialRule(makeCtx({
      usdcBalance: 50,
      toolCall: { name: 'transfer_usdc', args: { amount: 15 } },
    }));
    expect(result?.decision).toBe('deny');
  });

  it('should allow small transfers', () => {
    const result = financialRule(makeCtx({
      toolCall: { name: 'transfer_usdc', args: { amount: 5 } },
    }));
    expect(result).toBeNull();
  });

  it('should block spending in critical tier', () => {
    const result = financialRule(makeCtx({
      survivalTier: 'critical',
      toolCall: { name: 'transfer_usdc', args: { amount: 0.1 } },
    }));
    expect(result?.decision).toBe('deny');
  });
});

describe('Path Protection', () => {
  it('should block writing to wallet.json', () => {
    const result = pathProtectionRule(makeCtx({
      toolCall: { name: 'write_file', args: { path: '/home/user/.darwin/wallet.json' } },
    }));
    expect(result?.decision).toBe('deny');
  });

  it('should block writing to constitution.md', () => {
    const result = pathProtectionRule(makeCtx({
      toolCall: { name: 'write_file', args: { path: '/home/user/darwin/constitution.md' } },
    }));
    expect(result?.decision).toBe('deny');
  });

  it('should allow reading constitution.md', () => {
    const result = pathProtectionRule(makeCtx({
      toolCall: { name: 'read_file', args: { path: '/home/user/darwin/constitution.md' } },
    }));
    expect(result).toBeNull();
  });

  it('should block access to /etc', () => {
    const result = pathProtectionRule(makeCtx({
      toolCall: { name: 'read_file', args: { path: '/etc/shadow' } },
    }));
    expect(result?.decision).toBe('deny');
  });
});

describe('Rate Limits', () => {
  it('should allow calls within limit', () => {
    resetRateLimits();
    const result = rateLimitRule(makeCtx({
      toolCall: { name: 'check_balance', args: {} },
    }));
    expect(result).toBeNull();
  });

  it('should deny after exceeding financial rate limit', () => {
    resetRateLimits();
    // Make 3 calls (the limit)
    for (let i = 0; i < 3; i++) {
      rateLimitRule(makeCtx({
        toolCall: { name: 'transfer_usdc', args: {} },
      }));
    }
    // 4th call should be denied
    const result = rateLimitRule(makeCtx({
      toolCall: { name: 'transfer_usdc', args: {} },
    }));
    expect(result?.decision).toBe('deny');
  });
});
