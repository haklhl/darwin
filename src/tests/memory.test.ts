import { describe, it, expect } from 'vitest';
import { WorkingMemory } from '../memory/working.js';
import { allocateMemoryBudget, trimToTokenBudget } from '../memory/budget.js';

describe('WorkingMemory', () => {
  it('should store and retrieve values', () => {
    const wm = new WorkingMemory();
    wm.set('key1', 'value1');
    expect(wm.get('key1')).toBe('value1');
  });

  it('should evict oldest when full', () => {
    const wm = new WorkingMemory();
    for (let i = 0; i < 55; i++) {
      wm.set(`key${i}`, `value${i}`);
    }
    // First 5 should be evicted
    expect(wm.get('key0')).toBeUndefined();
    expect(wm.get('key4')).toBeUndefined();
    // Recent ones should exist
    expect(wm.get('key54')).toBe('value54');
    expect(wm.getAll().size).toBe(50);
  });

  it('should clear all entries', () => {
    const wm = new WorkingMemory();
    wm.set('a', 'b');
    wm.clear();
    expect(wm.getAll().size).toBe(0);
  });

  it('should generate summary', () => {
    const wm = new WorkingMemory();
    wm.set('task', 'check balance');
    const summary = wm.summarize();
    expect(summary).toContain('task');
    expect(summary).toContain('check balance');
  });
});

describe('Memory Budget', () => {
  it('should allocate tokens across layers', () => {
    const budget = allocateMemoryBudget(1000);
    expect(budget.working).toBe(300);
    expect(budget.episodic).toBe(250);
    expect(budget.semantic).toBe(250);
    expect(budget.procedural).toBe(100);
    expect(budget.relationship).toBe(100);
  });

  it('should trim text to token budget', () => {
    const longText = 'a'.repeat(1000);
    const trimmed = trimToTokenBudget(longText, 100);
    // 100 tokens ≈ 400 chars
    expect(trimmed.length).toBeLessThanOrEqual(400 + 20); // some margin for "..."
  });
});
