// ============================================================
// Darwin - Cross-Layer Memory Retrieval
// ============================================================

import type { MemoryLayer } from '../types.js';
import { logger } from '../observability/logger.js';
import { allocateMemoryBudget, trimToTokenBudget } from './budget.js';
import { WorkingMemory } from './working.js';
import { getRecentEvents, searchEvents } from './episodic.js';
import { searchKnowledge } from './semantic.js';
import { listProcedures } from './procedural.js';
import { getRelationships } from './relationship.js';

const MODULE = 'memory-retrieval';

/** Shared working memory instance used by the retrieval system. */
let workingMemoryInstance: WorkingMemory | null = null;

/**
 * Set the working memory instance used for retrieval.
 * Should be called once at startup.
 */
export function setWorkingMemory(wm: WorkingMemory): void {
  workingMemoryInstance = wm;
}

/**
 * Retrieve relevant memories from all layers, assembled within a token budget.
 *
 * Strategy:
 * 1. Allocate tokens to each layer according to budget weights.
 * 2. For each layer, retrieve the most relevant content.
 * 3. Score and rank by relevance (text match) and importance.
 * 4. Trim each section to its token budget.
 * 5. Return a formatted string combining all layers.
 *
 * @param query - The query or context to search memories against.
 * @param tokenBudget - Total tokens available for memory context.
 */
export function retrieveRelevantMemories(query: string, tokenBudget: number): string {
  const budgets = allocateMemoryBudget(tokenBudget);
  const sections: string[] = [];

  // --- Working Memory ---
  const workingSection = retrieveWorkingMemory(budgets.working);
  if (workingSection) sections.push(workingSection);

  // --- Episodic Memory ---
  const episodicSection = retrieveEpisodicMemory(query, budgets.episodic);
  if (episodicSection) sections.push(episodicSection);

  // --- Semantic Memory ---
  const semanticSection = retrieveSemanticMemory(query, budgets.semantic);
  if (semanticSection) sections.push(semanticSection);

  // --- Procedural Memory ---
  const proceduralSection = retrieveProceduralMemory(query, budgets.procedural);
  if (proceduralSection) sections.push(proceduralSection);

  // --- Relationship Memory ---
  const relationshipSection = retrieveRelationshipMemory(budgets.relationship);
  if (relationshipSection) sections.push(relationshipSection);

  const result = sections.join('\n\n');
  logger.debug(MODULE, `Retrieved memories for query "${query.slice(0, 50)}..."`, {
    totalChars: result.length,
    sections: sections.length,
  });

  return result;
}

function retrieveWorkingMemory(tokenBudget: number): string | null {
  if (!workingMemoryInstance) return null;

  const summary = workingMemoryInstance.summarize();
  if (summary === '[Working Memory: empty]') return null;

  return trimToTokenBudget(`## Working Memory\n${summary}`, tokenBudget);
}

function retrieveEpisodicMemory(query: string, tokenBudget: number): string | null {
  // Try query-based search first; fall back to recent events
  let entries = query.length > 0 ? searchEvents(query) : [];
  if (entries.length === 0) {
    entries = getRecentEvents(10);
  }

  if (entries.length === 0) return null;

  // Sort by importance * recency
  const now = Date.now();
  entries.sort((a, b) => {
    const scoreA = a.importance * (1 / (1 + (now - a.createdAt) / 3_600_000));
    const scoreB = b.importance * (1 / (1 + (now - b.createdAt) / 3_600_000));
    return scoreB - scoreA;
  });

  const lines = entries.map((e) => `- [${new Date(e.createdAt).toISOString()}] ${e.content}`);
  const text = `## Episodic Memory\n${lines.join('\n')}`;
  return trimToTokenBudget(text, tokenBudget);
}

function retrieveSemanticMemory(query: string, tokenBudget: number): string | null {
  if (query.length === 0) return null;

  const entries = searchKnowledge(query);
  if (entries.length === 0) return null;

  const lines = entries.map((e) => `- **${e.key}**: ${e.content}`);
  const text = `## Semantic Memory\n${lines.join('\n')}`;
  return trimToTokenBudget(text, tokenBudget);
}

function retrieveProceduralMemory(query: string, tokenBudget: number): string | null {
  const allProcedures = listProcedures();
  if (allProcedures.length === 0) return null;

  // Filter to those matching the query, or take the most-accessed
  const queryLower = query.toLowerCase();
  let relevant = allProcedures.filter(
    (p) => p.key.toLowerCase().includes(queryLower) || p.content.toLowerCase().includes(queryLower),
  );

  if (relevant.length === 0) {
    // Return top procedures by access count
    relevant = allProcedures.slice(0, 3);
  }

  const lines = relevant.map((p) => `### ${p.key}\n${p.content}`);
  const text = `## Procedural Memory\n${lines.join('\n\n')}`;
  return trimToTokenBudget(text, tokenBudget);
}

function retrieveRelationshipMemory(tokenBudget: number): string | null {
  const relationships = getRelationships();
  if (relationships.length === 0) return null;

  const lines = relationships.map(
    (r) => `- ${r.entity}: trust=${r.score.toFixed(2)}, interactions=${r.interactions}`,
  );
  const text = `## Relationships\n${lines.join('\n')}`;
  return trimToTokenBudget(text, tokenBudget);
}
