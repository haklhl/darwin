// ============================================================
// Darwin - Working Memory (session-scoped, in-memory)
// ============================================================

import { logger } from '../observability/logger.js';

const MODULE = 'memory-working';
const MAX_ENTRIES = 50;

/**
 * Working memory holds transient key-value pairs for the current session.
 * Entries are not persisted to the database and are lost when the process exits.
 * When the maximum capacity is reached, the oldest entry is evicted.
 */
export class WorkingMemory {
  /** Ordered map preserving insertion order for eviction. */
  private store: Map<string, string> = new Map();

  /**
   * Set a key-value pair. If the key already exists, it is updated in place.
   * If capacity is exceeded, the oldest entry is evicted.
   */
  set(key: string, value: string): void {
    // If key already exists, delete it first so re-insertion moves it to the end
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict oldest entry if at capacity
    if (this.store.size >= MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value as string;
      this.store.delete(oldestKey);
      logger.debug(MODULE, `Evicted oldest working memory entry: "${oldestKey}"`);
    }

    this.store.set(key, value);
  }

  /**
   * Retrieve a value by key. Returns undefined if not found.
   */
  get(key: string): string | undefined {
    return this.store.get(key);
  }

  /**
   * Return a copy of all working memory entries.
   */
  getAll(): Map<string, string> {
    return new Map(this.store);
  }

  /**
   * Remove all entries from working memory.
   */
  clear(): void {
    const count = this.store.size;
    this.store.clear();
    logger.debug(MODULE, `Cleared ${count} working memory entries`);
  }

  /**
   * Return a human-readable text summary of all working memory entries.
   */
  summarize(): string {
    if (this.store.size === 0) {
      return '[Working Memory: empty]';
    }

    const lines: string[] = [`[Working Memory: ${this.store.size} entries]`];
    for (const [key, value] of this.store) {
      const truncated = value.length > 200 ? value.slice(0, 200) + '...' : value;
      lines.push(`- ${key}: ${truncated}`);
    }
    return lines.join('\n');
  }
}
