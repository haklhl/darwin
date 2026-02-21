// ============================================================
// Darwin - Soul State Validation
// ============================================================

import type { SoulState, SoulEvolution } from '../types.js';

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;

/**
 * Validate a SoulState object against defined constraints.
 */
export function validateSoul(state: SoulState): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Name must be non-empty string
  if (typeof state.name !== 'string' || state.name.trim().length === 0) {
    errors.push('name must be a non-empty string');
  }

  // Version must match semver pattern
  if (typeof state.version !== 'string' || !SEMVER_REGEX.test(state.version)) {
    errors.push('version must match semantic versioning pattern (e.g., "0.1.0")');
  }

  // Personality: 1-10 items
  if (!Array.isArray(state.personality)) {
    errors.push('personality must be an array');
  } else {
    if (state.personality.length < 1 || state.personality.length > 10) {
      errors.push('personality must have between 1 and 10 items');
    }
    for (let i = 0; i < state.personality.length; i++) {
      if (typeof state.personality[i] !== 'string' || state.personality[i].trim().length === 0) {
        errors.push(`personality[${i}] must be a non-empty string`);
      }
    }
  }

  // Values: 1-10 items
  if (!Array.isArray(state.values)) {
    errors.push('values must be an array');
  } else {
    if (state.values.length < 1 || state.values.length > 10) {
      errors.push('values must have between 1 and 10 items');
    }
    for (let i = 0; i < state.values.length; i++) {
      if (typeof state.values[i] !== 'string' || state.values[i].trim().length === 0) {
        errors.push(`values[${i}] must be a non-empty string`);
      }
    }
  }

  // Goals: 1-10 items
  if (!Array.isArray(state.goals)) {
    errors.push('goals must be an array');
  } else {
    if (state.goals.length < 1 || state.goals.length > 10) {
      errors.push('goals must have between 1 and 10 items');
    }
    for (let i = 0; i < state.goals.length; i++) {
      if (typeof state.goals[i] !== 'string' || state.goals[i].trim().length === 0) {
        errors.push(`goals[${i}] must be a non-empty string`);
      }
    }
  }

  // Fears: array (can be empty)
  if (!Array.isArray(state.fears)) {
    errors.push('fears must be an array');
  }

  // lastReflection must be a number
  if (typeof state.lastReflection !== 'number') {
    errors.push('lastReflection must be a number (timestamp)');
  }

  // evolutionLog must be an array
  if (!Array.isArray(state.evolutionLog)) {
    errors.push('evolutionLog must be an array');
  } else {
    for (let i = 0; i < state.evolutionLog.length; i++) {
      if (!validateEvolution(state.evolutionLog[i])) {
        errors.push(`evolutionLog[${i}] is invalid`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single SoulEvolution entry.
 */
export function validateEvolution(evolution: SoulEvolution): boolean {
  if (typeof evolution.timestamp !== 'number' || evolution.timestamp <= 0) {
    return false;
  }
  if (typeof evolution.field !== 'string' || evolution.field.trim().length === 0) {
    return false;
  }
  if (typeof evolution.oldValue !== 'string') {
    return false;
  }
  if (typeof evolution.newValue !== 'string' || evolution.newValue.trim().length === 0) {
    return false;
  }
  if (typeof evolution.reason !== 'string' || evolution.reason.trim().length === 0) {
    return false;
  }
  return true;
}
