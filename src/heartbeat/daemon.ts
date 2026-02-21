// ============================================================
// 角都 - Heartbeat Daemon (recursive setTimeout loop)
// ============================================================

import { kvSet, kvGetNumber, kvSetNumber, insertWakeEvent, isEmergencyStopped } from '../state/database.js';
import { logger } from '../observability/logger.js';
import { DEFAULT_HEARTBEAT_CONFIG } from './config.js';
import { getNextDueJob, markJobComplete, markJobFailed, initScheduler } from './scheduler.js';
import { getTaskHandler } from './tasks.js';

const MODULE = 'heartbeat';

let running = false;
let timerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Execute all currently due jobs, one at a time.
 * If a task returns shouldWake=true, insert a wake event.
 */
async function executeDueJobs(): Promise<void> {
  let job = getNextDueJob();

  while (job) {
    const handler = getTaskHandler(job.taskName);
    if (!handler) {
      markJobFailed(job.taskName, `No handler registered for task "${job.taskName}"`);
      job = getNextDueJob();
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await handler();
      markJobComplete(job.taskName);
      const durationMs = Date.now() - startedAt;
      logger.debug(MODULE, `Task "${job.taskName}" completed in ${durationMs}ms`);

      // If task wants to wake the agent, insert a wake event
      if (result.shouldWake) {
        const reason = result.message ?? `Heartbeat task '${job.taskName}' requested wake`;
        insertWakeEvent('heartbeat', reason, { taskName: job.taskName });
        logger.info(MODULE, `Wake event inserted by ${job.taskName}: ${reason}`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      markJobFailed(job.taskName, errorMsg);
      logger.error(MODULE, `Task "${job.taskName}" failed: ${errorMsg}`);
    }

    job = getNextDueJob();
  }
}

/**
 * Single heartbeat tick.
 */
async function tick(): Promise<void> {
  try {
    if (isEmergencyStopped()) {
      logger.debug(MODULE, 'Skipping tick — emergency stop active');
      return;
    }

    await executeDueJobs();

    const count = (kvGetNumber('heartbeat_tick_count') ?? 0) + 1;
    kvSetNumber('heartbeat_tick_count', count);
    kvSet('heartbeat_last_tick', String(Date.now()));
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(MODULE, `Heartbeat tick error: ${errorMsg}`);
  }
}

/**
 * Schedule the next heartbeat tick.
 */
function scheduleNext(intervalMs: number): void {
  if (!running) return;

  timerId = setTimeout(async () => {
    await tick();
    scheduleNext(intervalMs);
  }, intervalMs);
}

/**
 * Start the heartbeat daemon loop.
 */
export function startHeartbeat(intervalMs?: number): void {
  if (running) {
    logger.warn(MODULE, 'Heartbeat is already running');
    return;
  }

  const interval = intervalMs ?? DEFAULT_HEARTBEAT_CONFIG.baseIntervalMs;

  initScheduler();

  running = true;
  kvSet('heartbeat_started_at', String(Date.now()));
  logger.info(MODULE, `Heartbeat daemon started with ${interval}ms interval`);

  void tick().then(() => {
    scheduleNext(interval);
  });
}

/**
 * Stop the heartbeat daemon loop.
 */
export function stopHeartbeat(): void {
  if (!running) {
    logger.warn(MODULE, 'Heartbeat is not running');
    return;
  }

  running = false;
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }

  kvSet('heartbeat_stopped_at', String(Date.now()));
  logger.info(MODULE, 'Heartbeat daemon stopped');
}

export function isHeartbeatRunning(): boolean {
  return running;
}
