// ============================================================
// Darwin - DB-Backed Cron Scheduler
// ============================================================

import type { ScheduledJob } from '../types.js';
import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';
import { DEFAULT_HEARTBEAT_CONFIG } from './config.js';

// --- Cron parser ---

interface CronMatcher {
  matches(date: Date): boolean;
}

interface CronField {
  type: 'any' | 'value' | 'step';
  value?: number;
  step?: number;
}

function parseField(field: string): CronField {
  if (field === '*') {
    return { type: 'any' };
  }
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) {
      throw new Error(`Invalid cron step value: ${field}`);
    }
    return { type: 'step', step };
  }
  const value = parseInt(field, 10);
  if (isNaN(value)) {
    throw new Error(`Invalid cron field: ${field}`);
  }
  return { type: 'value', value };
}

function fieldMatches(field: CronField, value: number): boolean {
  switch (field.type) {
    case 'any':
      return true;
    case 'value':
      return value === field.value;
    case 'step':
      return value % field.step! === 0;
  }
}

/**
 * Parse a cron expression into a matcher.
 * Supports: *, specific values, and *\/N syntax.
 * Format: minute hour day-of-month month day-of-week
 */
export function parseCronExpression(expr: string): CronMatcher {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${expr}`);
  }

  const [minuteField, hourField, domField, monthField, dowField] = parts.map(parseField);

  return {
    matches(date: Date): boolean {
      return (
        fieldMatches(minuteField, date.getMinutes()) &&
        fieldMatches(hourField, date.getHours()) &&
        fieldMatches(domField, date.getDate()) &&
        fieldMatches(monthField, date.getMonth() + 1) &&
        fieldMatches(dowField, date.getDay())
      );
    },
  };
}

/**
 * Calculate the next time a cron expression will match after a given date.
 * Scans forward minute by minute, up to 8 days ahead.
 */
export function getNextCronTime(expr: string, after: Date): Date {
  const matcher = parseCronExpression(expr);
  const candidate = new Date(after.getTime());

  // Advance to the next whole minute
  candidate.setSeconds(0, 0);
  candidate.setTime(candidate.getTime() + 60_000);

  const maxIterations = 8 * 24 * 60; // 8 days of minutes
  for (let i = 0; i < maxIterations; i++) {
    if (matcher.matches(candidate)) {
      return candidate;
    }
    candidate.setTime(candidate.getTime() + 60_000);
  }

  // Fallback: 1 hour from now
  logger.warn('scheduler', `Could not find next cron time for "${expr}", defaulting to +1h`);
  return new Date(after.getTime() + 3_600_000);
}

// --- Scheduler functions ---

/**
 * Initialize scheduled jobs in DB from the default heartbeat config.
 * Inserts new jobs and updates cron expressions for existing ones.
 */
export function initScheduler(): void {
  const db = getDatabase();

  const upsert = db.prepare(`
    INSERT INTO scheduled_jobs (task_name, cron_expression, next_run_at, enabled)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(task_name) DO UPDATE SET
      cron_expression = excluded.cron_expression,
      enabled = excluded.enabled
  `);

  const now = new Date();

  const insertMany = db.transaction(() => {
    for (const task of DEFAULT_HEARTBEAT_CONFIG.tasks) {
      const nextRun = getNextCronTime(task.cronExpression, now);
      upsert.run(task.name, task.cronExpression, nextRun.getTime(), task.enabled ? 1 : 0);
    }
  });

  insertMany();
  logger.info('scheduler', `Initialized ${DEFAULT_HEARTBEAT_CONFIG.tasks.length} scheduled jobs`);
}

/**
 * Find the next scheduled job that is due for execution.
 */
export function getNextDueJob(): ScheduledJob | null {
  const db = getDatabase();
  const now = Date.now();

  const row = db.prepare(`
    SELECT id, task_name, cron_expression, last_run_at, next_run_at, enabled
    FROM scheduled_jobs
    WHERE enabled = 1 AND next_run_at <= ?
    ORDER BY next_run_at ASC
    LIMIT 1
  `).get(now) as {
    id: number;
    task_name: string;
    cron_expression: string;
    last_run_at: number | null;
    next_run_at: number;
    enabled: number;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    taskName: row.task_name,
    cronExpression: row.cron_expression,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    enabled: row.enabled === 1,
  };
}

/**
 * Mark a job as successfully completed and schedule its next run.
 */
export function markJobComplete(taskName: string): void {
  const db = getDatabase();
  const now = Date.now();

  // Look up the cron expression
  const row = db.prepare('SELECT cron_expression FROM scheduled_jobs WHERE task_name = ?').get(taskName) as {
    cron_expression: string;
  } | undefined;

  if (!row) {
    logger.warn('scheduler', `Cannot mark complete: unknown task "${taskName}"`);
    return;
  }

  const nextRun = getNextCronTime(row.cron_expression, new Date(now));

  db.prepare(`
    UPDATE scheduled_jobs
    SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1, last_error = NULL
    WHERE task_name = ?
  `).run(now, nextRun.getTime(), taskName);

  logger.debug('scheduler', `Job "${taskName}" completed, next run at ${nextRun.toISOString()}`);
}

/**
 * Mark a job as failed with an error message.
 * Still advances next_run_at so it retries on the next cron cycle.
 */
export function markJobFailed(taskName: string, error: string): void {
  const db = getDatabase();
  const now = Date.now();

  const row = db.prepare('SELECT cron_expression FROM scheduled_jobs WHERE task_name = ?').get(taskName) as {
    cron_expression: string;
  } | undefined;

  if (!row) {
    logger.warn('scheduler', `Cannot mark failed: unknown task "${taskName}"`);
    return;
  }

  const nextRun = getNextCronTime(row.cron_expression, new Date(now));

  db.prepare(`
    UPDATE scheduled_jobs
    SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1, last_error = ?
    WHERE task_name = ?
  `).run(now, nextRun.getTime(), error, taskName);

  logger.warn('scheduler', `Job "${taskName}" failed: ${error}`);
}
