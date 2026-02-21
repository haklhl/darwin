import { describe, it, expect } from 'vitest';
import { determineTier } from '../survival/monitor.js';

describe('Survival Tier', () => {
  it('should be high when balance >= 50', () => {
    expect(determineTier(100)).toBe('high');
    expect(determineTier(50)).toBe('high');
  });

  it('should be normal when 10 <= balance < 50', () => {
    expect(determineTier(49.99)).toBe('normal');
    expect(determineTier(10)).toBe('normal');
  });

  it('should be low_compute when 2 <= balance < 10', () => {
    expect(determineTier(9.99)).toBe('low_compute');
    expect(determineTier(2)).toBe('low_compute');
  });

  it('should be critical when 0.5 <= balance < 2', () => {
    expect(determineTier(1.99)).toBe('critical');
    expect(determineTier(0.5)).toBe('critical');
  });

  it('should be dead when balance < 0.5', () => {
    expect(determineTier(0.49)).toBe('dead');
    expect(determineTier(0)).toBe('dead');
  });
});
