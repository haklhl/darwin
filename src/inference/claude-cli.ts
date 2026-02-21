// ============================================================
// Darwin - Claude CLI Subprocess Interface
// ============================================================

import { spawn } from 'child_process';
import { logger } from '../observability/logger.js';
import type { InferenceRequest, InferenceResult, UsageInfo } from './types.js';

const MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Call Claude CLI as a subprocess with the given request.
 * Uses `claude --print --output-format json` and passes prompt via stdin.
 */
export async function callClaude(request: InferenceRequest): Promise<InferenceResult> {
  const startTime = Date.now();

  const args: string[] = ['--print', '--output-format', 'json'];

  if (request.model) {
    const mapped = MODEL_MAP[request.model];
    if (mapped) {
      args.push('--model', mapped);
    }
  }

  if (request.systemPrompt) {
    args.push('--system-prompt', request.systemPrompt);
  }

  if (request.maxTokens) {
    args.push('--max-tokens', String(request.maxTokens));
  }

  logger.debug('claude-cli', 'Spawning claude subprocess', {
    model: request.model ?? 'default',
    promptLength: request.prompt.length,
    args,
  });

  try {
    const result = await spawnClaude(args, request.prompt, DEFAULT_TIMEOUT_MS);
    const durationMs = Date.now() - startTime;

    // Attempt to parse JSON response
    let content: string;
    try {
      const parsed = JSON.parse(result) as { result?: string; content?: string; response?: string };
      content = parsed.result ?? parsed.content ?? parsed.response ?? result;
    } catch {
      // If not valid JSON, use raw output
      content = result;
    }

    logger.info('claude-cli', 'Claude response received', {
      model: request.model ?? 'default',
      durationMs,
      responseLength: content.length,
    });

    return {
      content,
      model: request.model ?? 'sonnet',
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);

    logger.error('claude-cli', 'Claude call failed', { error: errMsg, durationMs });

    return {
      content: '',
      model: request.model ?? 'sonnet',
      durationMs,
      error: errMsg,
    };
  }
}

/**
 * Get CLI usage estimate based on internal tracking.
 * Claude CLI has no external usage-check command, so we estimate
 * from our own call counts and the known weekly Pro limit (~45h compute).
 */
export async function checkUsage(): Promise<UsageInfo> {
  try {
    const db = (await import('../state/database.js')).getDatabase();

    // Count agent loop runs in the current week
    const now = Date.now();
    const dayOfWeek = new Date().getDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = now - daysSinceMonday * 86_400_000;

    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM heartbeat_log
      WHERE task_name = 'agent_loop' AND started_at > ?
    `).get(weekStart) as { cnt: number } | undefined;

    const loopCount = row?.cnt ?? 0;

    // Rough estimate: each agent loop ~2-5 min compute, Pro plan ~45h/week = 2700 min
    // Conservative: assume 3 min avg per loop
    const estimatedMinutes = loopCount * 3;
    const weeklyLimitMinutes = 2700;
    const percentUsed = Math.min(100, (estimatedMinutes / weeklyLimitMinutes) * 100);

    logger.info('claude-cli', 'Usage estimate computed', { loopCount, percentUsed: percentUsed.toFixed(1) });

    return {
      percentUsed,
      rawOutput: `Estimated: ${loopCount} loops this week, ~${estimatedMinutes} min / ${weeklyLimitMinutes} min (${percentUsed.toFixed(1)}%)`,
      timestamp: now,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('claude-cli', 'Usage estimate failed', { error: errMsg });

    return {
      percentUsed: -1,
      rawOutput: errMsg,
      timestamp: Date.now(),
    };
  }
}

/**
 * Spawn the claude CLI process and return stdout as a string.
 */
function spawnClaude(args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const claudePath = process.env.CLAUDE_PATH ?? '/home/tuantuanxiaobu/.local/bin/claude';
    const proc = spawn(claudePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/home/tuantuanxiaobu/.local/bin:/usr/local/bin:/usr/bin` },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });

    // Write prompt to stdin and close
    if (stdin) {
      proc.stdin.write(stdin);
    }
    proc.stdin.end();
  });
}
