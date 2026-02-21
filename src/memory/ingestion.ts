// ============================================================
// Darwin - Memory Ingestion (auto-extract and categorize)
// ============================================================

import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';
import { recordEvent } from './episodic.js';
import { storeKnowledge } from './semantic.js';
import { storeProcedure } from './procedural.js';

const MODULE = 'memory-ingestion';

/**
 * Heuristic patterns for classifying content into memory layers.
 */
const ERROR_PATTERNS = [
  /error/i,
  /fail(ed|ure)?/i,
  /exception/i,
  /crash/i,
  /timeout/i,
  /rejected/i,
  /panic/i,
];

const FACT_PATTERNS = [
  /\bis\b/i,
  /\bare\b/i,
  /\bwas\b/i,
  /\bequals?\b/i,
  /\bcontains?\b/i,
  /\baddress\b/i,
  /\bversion\b/i,
  /\bbalance\b/i,
  /\bprice\b/i,
  /\bconfig(uration)?\b/i,
];

const PROCEDURE_PATTERNS = [
  /step\s*\d/i,
  /\bfirst\b.*\bthen\b/i,
  /\bhow\s+to\b/i,
  /\binstructions?\b/i,
  /\bprocedure\b/i,
  /\brecipe\b/i,
  /1\.\s/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Ingest information from an agent step, automatically categorizing it
 * into the appropriate memory layer(s).
 *
 * Heuristics:
 * - Errors and failures -> episodic memory (high importance)
 * - Facts and data -> semantic memory
 * - Step-by-step instructions -> procedural memory
 * - General observations -> episodic memory (normal importance)
 *
 * @param thought - The agent's reasoning/thought for this step.
 * @param observation - The observation/result from tool execution.
 */
export function ingestFromAgentStep(thought: string, observation: string): void {
  const combined = `${thought} ${observation}`;

  let stored = false;

  // Check for errors -> episodic with high importance
  if (matchesAny(combined, ERROR_PATTERNS)) {
    recordEvent('error', `Thought: ${thought}\nObservation: ${observation}`, 0.8);
    stored = true;
    logger.debug(MODULE, 'Ingested error event into episodic memory');
  }

  // Check for procedural content
  if (matchesAny(combined, PROCEDURE_PATTERNS)) {
    const procedureName = `procedure:${Date.now()}`;
    storeProcedure(procedureName, observation || thought, { source: 'agent_step' });
    stored = true;
    logger.debug(MODULE, 'Ingested procedure into procedural memory');
  }

  // Check for factual content -> semantic
  if (matchesAny(combined, FACT_PATTERNS)) {
    const key = `fact:${Date.now()}`;
    storeKnowledge(key, observation || thought, 0.5);
    stored = true;
    logger.debug(MODULE, 'Ingested fact into semantic memory');
  }

  // If nothing specific matched, record as a general episodic event
  if (!stored) {
    recordEvent('observation', `Thought: ${thought}\nObservation: ${observation}`, 0.3);
    logger.debug(MODULE, 'Ingested general observation into episodic memory');
  }
}

/**
 * Delete all expired memory entries across all layers.
 * @returns The number of entries deleted.
 */
export function pruneExpiredMemories(): number {
  const db = getDatabase();
  const now = Date.now();

  const result = db.prepare(`
    DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);

  const count = result.changes;
  if (count > 0) {
    logger.info(MODULE, `Pruned ${count} expired memory entries`);
  }

  return count;
}
