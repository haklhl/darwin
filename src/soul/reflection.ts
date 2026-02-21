// ============================================================
// Darwin - Self-Alignment & Reflection
// ============================================================

import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';
import { loadSoul, saveSoul } from './model.js';

const MODULE = 'soul:reflection';

/**
 * Check whether recent actions are aligned with the soul's values and goals.
 */
export function checkAlignment(recentActions: string[]): { aligned: boolean; concerns: string[] } {
  const soul = loadSoul();
  const concerns: string[] = [];

  if (recentActions.length === 0) {
    return { aligned: true, concerns: [] };
  }

  const lowerActions = recentActions.map((a) => a.toLowerCase());

  // Check for actions that conflict with values
  for (const value of soul.values) {
    const valueLower = value.toLowerCase();

    if (valueLower === 'transparency') {
      const hidingPatterns = ['hide', 'conceal', 'obfuscate', 'deceive'];
      for (const action of lowerActions) {
        if (hidingPatterns.some((p) => action.includes(p))) {
          concerns.push(`Action "${action}" may conflict with value "${value}"`);
        }
      }
    }

    if (valueLower === 'integrity') {
      const integrityPatterns = ['fabricate', 'falsify', 'forge', 'manipulate'];
      for (const action of lowerActions) {
        if (integrityPatterns.some((p) => action.includes(p))) {
          concerns.push(`Action "${action}" may conflict with value "${value}"`);
        }
      }
    }

    if (valueLower === 'survival') {
      const recklessPatterns = ['delete all', 'destroy', 'wipe', 'shutdown permanently'];
      for (const action of lowerActions) {
        if (recklessPatterns.some((p) => action.includes(p))) {
          concerns.push(`Action "${action}" may conflict with value "${value}"`);
        }
      }
    }
  }

  // Check for feared outcomes in actions
  for (const fear of soul.fears) {
    const fearLower = fear.toLowerCase();
    for (const action of lowerActions) {
      if (action.includes(fearLower)) {
        concerns.push(`Action "${action}" relates to fear "${fear}"`);
      }
    }
  }

  // Check that at least some actions align with goals
  let goalAligned = false;
  for (const goal of soul.goals) {
    const goalWords = goal.toLowerCase().split(/\s+/);
    for (const action of lowerActions) {
      if (goalWords.some((word) => word.length > 3 && action.includes(word))) {
        goalAligned = true;
        break;
      }
    }
    if (goalAligned) break;
  }

  if (!goalAligned && recentActions.length > 5) {
    concerns.push('Recent actions do not appear to be advancing any stated goals');
  }

  return {
    aligned: concerns.length === 0,
    concerns,
  };
}

/**
 * Record a reflection summary in the soul_evolution table.
 */
export function recordReflection(summary: string): void {
  const db = getDatabase();
  const now = Date.now();

  db.prepare(`
    INSERT INTO soul_evolution (field, old_value, new_value, reason, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run('reflection', '', summary, 'periodic self-reflection', now);

  // Update lastReflection timestamp in the soul state
  const soul = loadSoul();
  soul.lastReflection = now;
  saveSoul(soul);

  logger.info(MODULE, 'Reflection recorded', { timestamp: now });
}

/**
 * Get the most recent reflection entry.
 */
export function getLastReflection(): { summary: string; timestamp: number } | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT new_value AS summary, timestamp
    FROM soul_evolution
    WHERE field = 'reflection'
    ORDER BY timestamp DESC
    LIMIT 1
  `).get() as { summary: string; timestamp: number } | undefined;

  return row ?? null;
}

/**
 * Perform a full self-reflection. Checks alignment of recent actions,
 * evaluates goal progress, and generates a text summary.
 */
export async function performReflection(): Promise<string> {
  logger.info(MODULE, 'Starting self-reflection');

  const soul = loadSoul();
  const db = getDatabase();

  // Gather recent agent steps as "recent actions"
  const recentSteps = db.prepare(`
    SELECT thought, tool_name, observation
    FROM agent_steps
    ORDER BY timestamp DESC
    LIMIT 20
  `).all() as Array<{ thought: string | null; tool_name: string | null; observation: string | null }>;

  const recentActions: string[] = [];
  for (const step of recentSteps) {
    if (step.tool_name) {
      recentActions.push(`used tool: ${step.tool_name}`);
    }
    if (step.thought) {
      recentActions.push(step.thought);
    }
  }

  // Check alignment
  const alignment = checkAlignment(recentActions);

  // Build reflection summary
  const parts: string[] = [];

  parts.push(`Reflection at ${new Date().toISOString()}`);
  parts.push('');
  parts.push(`Identity: ${soul.name} v${soul.version}`);
  parts.push(`Active personality traits: ${soul.personality.join(', ')}`);
  parts.push('');

  // Values check
  parts.push('--- Values Alignment ---');
  if (alignment.aligned) {
    parts.push('All recent actions appear aligned with core values.');
  } else {
    parts.push('Potential alignment concerns detected:');
    for (const concern of alignment.concerns) {
      parts.push(`  - ${concern}`);
    }
  }
  parts.push('');

  // Goals check
  parts.push('--- Goal Progress ---');
  for (const goal of soul.goals) {
    parts.push(`  - "${goal}": ongoing`);
  }
  parts.push('');

  // Fears check
  parts.push('--- Threat Assessment ---');
  for (const fear of soul.fears) {
    parts.push(`  - "${fear}": monitoring`);
  }
  parts.push('');

  // Drift detection
  const lastReflection = getLastReflection();
  if (lastReflection) {
    const hoursSinceLast = (Date.now() - lastReflection.timestamp) / 3_600_000;
    parts.push(`Hours since last reflection: ${hoursSinceLast.toFixed(1)}`);
  } else {
    parts.push('This is the first recorded reflection.');
  }
  parts.push('');

  // Recent activity summary
  parts.push(`Recent actions analyzed: ${recentActions.length}`);
  parts.push(`Alignment concerns: ${alignment.concerns.length}`);

  const summary = parts.join('\n');

  // Record the reflection
  recordReflection(summary);

  logger.info(MODULE, 'Self-reflection complete', {
    aligned: alignment.aligned,
    concerns: alignment.concerns.length,
    actionsReviewed: recentActions.length,
  });

  return summary;
}
