import { describe, it, expect } from 'vitest';
import { getDefaultSoul } from '../soul/model.js';
import { validateSoul, validateEvolution } from '../soul/validator.js';
import type { SoulEvolution } from '../types.js';

describe('Soul', () => {
  it('should produce a valid default soul', () => {
    const soul = getDefaultSoul();
    expect(soul.name).toBe('Darwin');
    expect(soul.version).toBe('0.1.0');
    expect(soul.personality.length).toBeGreaterThan(0);
    expect(soul.values.length).toBeGreaterThan(0);
    expect(soul.goals.length).toBeGreaterThan(0);
  });

  it('should validate default soul', () => {
    const soul = getDefaultSoul();
    const result = validateSoul(soul);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid soul', () => {
    const soul = getDefaultSoul();
    soul.name = '';
    const result = validateSoul(soul);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should validate evolution entries', () => {
    const evo: SoulEvolution = {
      timestamp: Date.now(),
      field: 'personality',
      oldValue: 'cautious',
      newValue: 'bold',
      reason: 'Gained confidence from successful trades',
    };
    expect(validateEvolution(evo)).toBe(true);
  });

  it('should reject invalid evolution', () => {
    const evo: SoulEvolution = {
      timestamp: 0,
      field: '',
      oldValue: '',
      newValue: '',
      reason: '',
    };
    expect(validateEvolution(evo)).toBe(false);
  });
});
