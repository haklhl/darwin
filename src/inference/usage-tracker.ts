// ============================================================
// Darwin - Usage Tracking (3-window: session, weekly all, weekly Sonnet)
// ============================================================

import { getDatabase, kvGet, kvSet, kvGetNumber, kvSetNumber } from '../state/database.js';
import { logger } from '../observability/logger.js';
import type { UsageState } from '../types.js';
import type { TokenUsage } from './types.js';

// --- Configuration ---
// Token budgets per window (configurable via KV, these are defaults)
const DEFAULT_SESSION_BUDGET = 500_000;      // tokens per 5h session
const DEFAULT_WEEKLY_ALL_BUDGET = 5_000_000; // tokens per week (all models)
const DEFAULT_WEEKLY_SONNET_BUDGET = 3_000_000; // tokens per week (Sonnet only)

const SESSION_WINDOW_MS = 5 * 60 * 60_000; // 5 hours

// Weekly reset: Saturday 23:00 UTC
const WEEKLY_RESET_DAY = 6;   // Saturday (0=Sun, 6=Sat)
const WEEKLY_RESET_HOUR = 23; // 23:00 UTC

// --- KV Keys ---
const KV_SESSION_START = 'usage_session_start';
const KV_SESSION_TOKENS = 'usage_session_tokens';
const KV_SESSION_RESETS_AT = 'usage_session_resets_at'; // from rate_limit_event
const KV_WEEKLY_RESET = 'usage_weekly_reset_at';
const KV_WEEKLY_ALL_TOKENS = 'usage_weekly_all_tokens';
const KV_WEEKLY_SONNET_TOKENS = 'usage_weekly_sonnet_tokens';
const KV_RATE_LIMIT_STATUS = 'usage_rate_limit_status'; // 'allowed' or 'rejected'

// --- Core Functions ---

/**
 * Record token usage from a single Claude CLI call.
 * Called automatically after each callClaude() invocation.
 */
export function recordCallUsage(model: string, tokens: TokenUsage): void {
  const now = Date.now();

  // Check & reset windows if needed
  maybeResetSession(now);
  maybeResetWeekly(now);

  // Effective tokens = input + output (cache creation counts, cache reads are discounted)
  const effectiveTokens = tokens.inputTokens + tokens.outputTokens + tokens.cacheCreationTokens;

  // Accumulate session tokens
  const sessionTokens = (kvGetNumber(KV_SESSION_TOKENS) ?? 0) + effectiveTokens;
  kvSetNumber(KV_SESSION_TOKENS, sessionTokens);

  // Accumulate weekly all-models tokens
  const weeklyAllTokens = (kvGetNumber(KV_WEEKLY_ALL_TOKENS) ?? 0) + effectiveTokens;
  kvSetNumber(KV_WEEKLY_ALL_TOKENS, weeklyAllTokens);

  // Accumulate weekly Sonnet tokens (only if model is Sonnet)
  if (model === 'sonnet' || model.includes('sonnet')) {
    const weeklySonnetTokens = (kvGetNumber(KV_WEEKLY_SONNET_TOKENS) ?? 0) + effectiveTokens;
    kvSetNumber(KV_WEEKLY_SONNET_TOKENS, weeklySonnetTokens);
  }

  // Also record snapshot for trend analysis
  const maxPercent = Math.max(
    sessionTokens / getSessionBudget() * 100,
    weeklyAllTokens / getWeeklyAllBudget() * 100,
    (kvGetNumber(KV_WEEKLY_SONNET_TOKENS) ?? 0) / getWeeklySonnetBudget() * 100,
  );
  recordUsageSnapshot(Math.min(100, maxPercent), model);

  logger.debug('usage-tracker', 'Usage recorded', {
    model,
    effectiveTokens,
    sessionTokens,
    weeklyAllTokens,
  });
}

/**
 * Get the current usage state with 3 percentages.
 */
export function getLatestUsage(): UsageState {
  const now = Date.now();

  // Check & reset windows
  maybeResetSession(now);
  maybeResetWeekly(now);

  const sessionTokens = kvGetNumber(KV_SESSION_TOKENS) ?? 0;
  const weeklyAllTokens = kvGetNumber(KV_WEEKLY_ALL_TOKENS) ?? 0;
  const weeklySonnetTokens = kvGetNumber(KV_WEEKLY_SONNET_TOKENS) ?? 0;

  const sessionPercent = Math.min(100, sessionTokens / getSessionBudget() * 100);
  const weeklyAllPercent = Math.min(100, weeklyAllTokens / getWeeklyAllBudget() * 100);
  const weeklySonnetPercent = Math.min(100, weeklySonnetTokens / getWeeklySonnetBudget() * 100);

  const trend = getUsageTrend(6);
  const dayOfWeek = new Date(now).getUTCDay();

  // Legacy compat: currentPercent = max of all, weeklyPercent = weeklyAll
  const currentPercent = Math.max(sessionPercent, weeklyAllPercent, weeklySonnetPercent);

  return {
    sessionPercent,
    weeklyAllPercent,
    weeklySonnetPercent,
    sessionTokens,
    weeklyAllTokens,
    weeklySonnetTokens,
    trend,
    currentPercent,
    weeklyPercent: weeklyAllPercent,
    dayOfWeek,
    resetDay: WEEKLY_RESET_DAY,
  };
}

/**
 * Get the session reset time (from rate_limit_event or estimated).
 * Returns epoch ms, or 0 if unknown.
 */
export function getSessionResetsAt(): number {
  const real = kvGetNumber(KV_SESSION_RESETS_AT);
  if (real && real > Date.now()) return real;

  // Fallback estimate
  const sessionStart = kvGetNumber(KV_SESSION_START);
  if (sessionStart) return sessionStart + SESSION_WINDOW_MS;
  return 0;
}

/**
 * Get the rate limit status from the last API call.
 */
export function getRateLimitStatus(): string {
  return kvGet(KV_RATE_LIMIT_STATUS) ?? 'unknown';
}

// --- Rate Limit Info from CLI ---

export interface RateLimitInfo {
  status: string;        // 'allowed' | 'rejected'
  resetsAt: number;      // epoch seconds
  rateLimitType: string; // 'five_hour' etc.
}

/**
 * Update rate limit info from Claude CLI's rate_limit_event.
 * This gives us the real session window reset time.
 */
export function updateRateLimitInfo(info: RateLimitInfo): void {
  if (info.rateLimitType === 'five_hour' && info.resetsAt > 0) {
    const resetsAtMs = info.resetsAt * 1000; // Convert epoch seconds to ms
    kvSetNumber(KV_SESSION_RESETS_AT, resetsAtMs);
    kvSet(KV_RATE_LIMIT_STATUS, info.status);

    logger.debug('usage-tracker', 'Rate limit info updated', {
      type: info.rateLimitType,
      status: info.status,
      resetsAt: new Date(resetsAtMs).toISOString(),
    });

    // If the session was rejected, we hit the limit
    if (info.status === 'rejected') {
      logger.warn('usage-tracker', 'Session rate limit hit! Tokens may be near cap.');
    }
  }
}

// --- Window Reset Logic ---

function maybeResetSession(now: number): void {
  // Use real reset time from rate_limit_event if available
  const realResetAt = kvGetNumber(KV_SESSION_RESETS_AT);
  if (realResetAt && now >= realResetAt) {
    // Session window has reset according to the server
    kvSetNumber(KV_SESSION_START, now);
    kvSetNumber(KV_SESSION_TOKENS, 0);
    kvSetNumber(KV_SESSION_RESETS_AT, 0); // Clear until next rate_limit_event
    logger.debug('usage-tracker', 'Session window reset (server-confirmed)');
    return;
  }

  // Fallback: estimate based on 5h window
  const sessionStart = kvGetNumber(KV_SESSION_START);
  if (!sessionStart || (now - sessionStart) >= SESSION_WINDOW_MS) {
    kvSetNumber(KV_SESSION_START, now);
    kvSetNumber(KV_SESSION_TOKENS, 0);
    logger.debug('usage-tracker', 'Session window reset (estimated)');
  }
}

function maybeResetWeekly(now: number): void {
  const lastReset = kvGetNumber(KV_WEEKLY_RESET);
  const nextReset = lastReset ? lastReset + getNextWeeklyResetMs(lastReset) : getNextWeeklyResetTimestamp(now);

  if (!lastReset || now >= nextReset) {
    kvSetNumber(KV_WEEKLY_RESET, now);
    kvSetNumber(KV_WEEKLY_ALL_TOKENS, 0);
    kvSetNumber(KV_WEEKLY_SONNET_TOKENS, 0);
    logger.info('usage-tracker', 'Weekly usage counters reset (Saturday 23:00 UTC)');
  }
}

/**
 * Calculate milliseconds until the next weekly reset from a given timestamp.
 */
function getNextWeeklyResetMs(fromMs: number): number {
  const from = new Date(fromMs);
  const target = new Date(fromMs);

  // Find next Saturday 23:00 UTC
  target.setUTCHours(WEEKLY_RESET_HOUR, 0, 0, 0);
  const currentDay = from.getUTCDay();
  let daysUntilSat = (WEEKLY_RESET_DAY - currentDay + 7) % 7;
  if (daysUntilSat === 0 && from.getUTCHours() >= WEEKLY_RESET_HOUR) {
    daysUntilSat = 7; // Already past this Saturday's reset
  }
  target.setUTCDate(target.getUTCDate() + daysUntilSat);

  return target.getTime() - from.getTime();
}

/**
 * Get the timestamp of the most recent Saturday 23:00 UTC reset point.
 */
function getNextWeeklyResetTimestamp(now: number): number {
  const d = new Date(now);
  d.setUTCHours(WEEKLY_RESET_HOUR, 0, 0, 0);
  const currentDay = d.getUTCDay();
  let daysUntilSat = (WEEKLY_RESET_DAY - currentDay + 7) % 7;
  if (daysUntilSat === 0 && new Date(now).getUTCHours() >= WEEKLY_RESET_HOUR) {
    daysUntilSat = 7;
  }
  d.setUTCDate(d.getUTCDate() + daysUntilSat);
  return d.getTime();
}

// --- Budget Getters (allow override via KV) ---

function getSessionBudget(): number {
  return kvGetNumber('usage_budget_session') ?? DEFAULT_SESSION_BUDGET;
}

function getWeeklyAllBudget(): number {
  return kvGetNumber('usage_budget_weekly_all') ?? DEFAULT_WEEKLY_ALL_BUDGET;
}

function getWeeklySonnetBudget(): number {
  return kvGetNumber('usage_budget_weekly_sonnet') ?? DEFAULT_WEEKLY_SONNET_BUDGET;
}

// --- Snapshot Recording (for trend analysis) ---

function recordUsageSnapshot(percent: number, model: string): void {
  const db = getDatabase();
  try {
    db.prepare(`
      INSERT INTO usage_snapshots (timestamp, percent, model, raw_output)
      VALUES (?, ?, ?, '')
    `).run(Date.now(), percent, model);
  } catch {
    // Non-critical
  }
}

/**
 * Determine usage trend over the last N hours.
 */
export function getUsageTrend(hours: number): 'rising' | 'stable' | 'falling' {
  const db = getDatabase();
  const since = Date.now() - hours * 3600_000;

  const snapshots = db.prepare(`
    SELECT percent, timestamp FROM usage_snapshots
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `).all(since) as Array<{ percent: number; timestamp: number }>;

  if (snapshots.length < 2) {
    return 'stable';
  }

  const midpoint = Math.floor(snapshots.length / 2);
  const firstHalf = snapshots.slice(0, midpoint);
  const secondHalf = snapshots.slice(midpoint);

  const avgFirst = firstHalf.reduce((sum, s) => sum + s.percent, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((sum, s) => sum + s.percent, 0) / secondHalf.length;

  const diff = avgSecond - avgFirst;

  if (diff > 2) return 'rising';
  if (diff < -2) return 'falling';
  return 'stable';
}
