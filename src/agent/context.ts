// ============================================================
// Darwin - Context Assembly with Token Budget
// ============================================================

import type { AgentStep, SurvivalState, UsageState, MemoryEntry } from '../types.js';

interface AssembleContextOpts {
  memories: MemoryEntry[];
  recentSteps: AgentStep[];
  survivalState: SurvivalState;
  usageState: UsageState;
}

// Rough token estimation: 1 token ≈ 4 characters
const CHARS_PER_TOKEN = 4;

// Maximum context budget in tokens
const MAX_CONTEXT_TOKENS = 8000;

/**
 * Estimate the number of tokens in a given text.
 * Uses a simple character-based heuristic (1 token ~ 4 chars).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Assemble context for the agent loop, respecting a token budget.
 * Priority order:
 * 1. System state (survival + usage) - always included
 * 2. Recent steps (conversation history) - most recent first
 * 3. Memories - by importance, then recency
 */
export function assembleContext(opts: AssembleContextOpts): string {
  const { memories, recentSteps, survivalState, usageState } = opts;

  let remainingTokens = MAX_CONTEXT_TOKENS;
  const sections: string[] = [];

  // 1. System State (highest priority, always included)
  const stateSection = buildStateSection(survivalState, usageState);
  const stateTokens = estimateTokens(stateSection);
  sections.push(stateSection);
  remainingTokens -= stateTokens;

  // 2. Recent Steps (conversation history, most recent first)
  if (recentSteps.length > 0 && remainingTokens > 200) {
    const stepsSection = buildStepsSection(recentSteps, remainingTokens);
    const stepsTokens = estimateTokens(stepsSection);
    sections.push(stepsSection);
    remainingTokens -= stepsTokens;
  }

  // 3. Memories (by importance)
  if (memories.length > 0 && remainingTokens > 100) {
    const memoriesSection = buildMemoriesSection(memories, remainingTokens);
    if (memoriesSection) {
      sections.push(memoriesSection);
    }
  }

  return sections.join('\n\n');
}

function buildStateSection(survival: SurvivalState, usage: UsageState): string {
  return `## Current State
- Survival Tier: ${survival.tier}
- USDC Balance: ${survival.usdcBalance.toFixed(2)}
- ETH Balance: ${survival.ethBalance.toFixed(6)}
- Last Checked: ${new Date(survival.lastChecked).toISOString()}
- Usage: ${usage.currentPercent.toFixed(1)}% (trend: ${usage.trend})
- Day of Week: ${usage.dayOfWeek} (reset day: ${usage.resetDay})`;
}

function buildStepsSection(steps: AgentStep[], maxTokens: number): string {
  const lines: string[] = ['## Recent Steps'];
  let usedTokens = estimateTokens('## Recent Steps\n');

  // Work backwards from most recent
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const stepLines: string[] = [];

    stepLines.push(`### Step ${i + 1}`);
    stepLines.push(`Thought: ${step.thought}`);

    if (step.action) {
      stepLines.push(`Action: ${step.action.name}(${JSON.stringify(step.action.args)})`);
    }

    if (step.observation) {
      // Truncate long observations
      const obs = step.observation.length > 500
        ? step.observation.substring(0, 500) + '...[truncated]'
        : step.observation;
      stepLines.push(`Observation: ${obs}`);
    }

    const stepText = stepLines.join('\n');
    const stepTokens = estimateTokens(stepText);

    if (usedTokens + stepTokens > maxTokens) {
      break;
    }

    // Insert at beginning (after header) so oldest steps come first
    lines.splice(1, 0, stepText);
    usedTokens += stepTokens;
  }

  return lines.join('\n');
}

function buildMemoriesSection(memories: MemoryEntry[], maxTokens: number): string | null {
  // Sort by importance descending, then by most recent
  const sorted = [...memories].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return b.updatedAt - a.updatedAt;
  });

  const lines: string[] = ['## Relevant Memories'];
  let usedTokens = estimateTokens('## Relevant Memories\n');

  for (const mem of sorted) {
    const entry = `- [${mem.layer}/${mem.key}] ${mem.content}`;
    const entryTokens = estimateTokens(entry);

    if (usedTokens + entryTokens > maxTokens) {
      break;
    }

    lines.push(entry);
    usedTokens += entryTokens;
  }

  if (lines.length <= 1) {
    return null;
  }

  return lines.join('\n');
}
