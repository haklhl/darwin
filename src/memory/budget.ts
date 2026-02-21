// ============================================================
// Darwin - Token Budget Allocation for Memory Retrieval
// ============================================================

import type { MemoryLayer } from '../types.js';

/**
 * Budget allocation percentages for each memory layer.
 */
const LAYER_WEIGHTS: Record<MemoryLayer, number> = {
  working: 0.30,
  episodic: 0.25,
  semantic: 0.25,
  procedural: 0.10,
  relationship: 0.10,
};

/**
 * Allocate a total token budget across memory layers according to fixed weights.
 * @param totalTokens - The total number of tokens available for memory context.
 * @returns A record mapping each memory layer to its allocated token count.
 */
export function allocateMemoryBudget(totalTokens: number): Record<MemoryLayer, number> {
  const budget: Record<MemoryLayer, number> = {
    working: 0,
    episodic: 0,
    semantic: 0,
    procedural: 0,
    relationship: 0,
  };

  for (const layer of Object.keys(LAYER_WEIGHTS) as MemoryLayer[]) {
    budget[layer] = Math.floor(totalTokens * LAYER_WEIGHTS[layer]);
  }

  return budget;
}

/**
 * Approximate character-to-token ratio (1 token ~ 4 characters).
 */
const CHARS_PER_TOKEN = 4;

/**
 * Truncate text to fit within a token budget.
 * Uses the approximation of 1 token = 4 characters.
 * @param text - The text to truncate.
 * @param maxTokens - The maximum number of tokens allowed.
 * @returns The (possibly truncated) text.
 */
export function trimToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  if (text.length <= maxChars) {
    return text;
  }

  // Truncate and add an ellipsis indicator
  return text.slice(0, maxChars - 3) + '...';
}
