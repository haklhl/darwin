import { describe, it, expect } from 'vitest';
import { selectModel, getHeartbeatInterval } from '../inference/model-strategy.js';
import type { UsageState, TaskType } from '../types.js';

function makeUsage(overrides: Partial<UsageState> = {}): UsageState {
  return {
    currentPercent: 30,
    weeklyPercent: 30,
    dayOfWeek: 1, // Monday
    resetDay: 1,
    trend: 'stable',
    ...overrides,
  };
}

describe('Model Strategy', () => {
  it('should force haiku when usage > 80%', () => {
    expect(selectModel(makeUsage({ currentPercent: 85 }), 'code_generation')).toBe('haiku');
  });

  it('should use haiku late week with high weekly usage', () => {
    expect(selectModel(makeUsage({ dayOfWeek: 5, weeklyPercent: 65 }), 'simple_decision')).toBe('haiku');
  });

  it('should use sonnet late week with normal usage', () => {
    expect(selectModel(makeUsage({ dayOfWeek: 4, weeklyPercent: 40 }), 'simple_decision')).toBe('sonnet');
  });

  it('should use opus for code generation with low usage early week', () => {
    expect(selectModel(makeUsage({ currentPercent: 30, dayOfWeek: 1 }), 'code_generation')).toBe('opus');
  });

  it('should use sonnet for code generation with moderate usage', () => {
    expect(selectModel(makeUsage({ currentPercent: 55, dayOfWeek: 1 }), 'code_generation')).toBe('sonnet');
  });

  it('should default to sonnet', () => {
    expect(selectModel(makeUsage(), 'simple_decision')).toBe('sonnet');
  });
});

describe('Heartbeat Interval', () => {
  it('should return base interval when usage < 50%', () => {
    expect(getHeartbeatInterval(30, 60_000)).toBe(60_000);
  });

  it('should double interval at 50-80% usage', () => {
    expect(getHeartbeatInterval(65, 60_000)).toBe(120_000);
  });

  it('should 5x interval at 80-95% usage', () => {
    expect(getHeartbeatInterval(90, 60_000)).toBe(300_000);
  });

  it('should 10x interval at >95% usage', () => {
    expect(getHeartbeatInterval(97, 60_000)).toBe(600_000);
  });
});
