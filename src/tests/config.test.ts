import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

describe('Config', () => {
  it('should load default config', () => {
    const config = loadConfig();
    expect(config.chainId).toBe(8453);
    expect(config.rpcUrl).toBe('https://mainnet.base.org');
    expect(config.usdcAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(config.heartbeatIntervalMs).toBe(60_000);
    expect(config.maxSpendPerTx).toBe(20);
    expect(config.aiServicePort).toBe(3402);
  });
});
