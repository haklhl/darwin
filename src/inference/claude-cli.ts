// ============================================================
// Darwin - Claude CLI Subprocess Interface
// ============================================================

import { spawn } from 'child_process';
import { logger } from '../observability/logger.js';
import { recordCallUsage } from './usage-tracker.js';
import type { InferenceRequest, InferenceResult, UsageInfo, TokenUsage } from './types.js';

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
    let tokenUsage: TokenUsage | undefined;
    try {
      const parsed = JSON.parse(result) as Record<string, unknown>;
      content = (parsed.result ?? parsed.content ?? parsed.response ?? result) as string;

      // Extract token usage from CLI JSON response
      const usage = parsed.usage as Record<string, unknown> | undefined;
      if (usage) {
        tokenUsage = {
          inputTokens: (usage.input_tokens as number) ?? 0,
          outputTokens: (usage.output_tokens as number) ?? 0,
          cacheCreationTokens: (usage.cache_creation_input_tokens as number) ?? 0,
          cacheReadTokens: (usage.cache_read_input_tokens as number) ?? 0,
        };

        // Record usage for tracking (determine actual model from modelUsage or request)
        const modelUsage = parsed.modelUsage as Record<string, unknown> | undefined;
        let actualModel = request.model ?? 'sonnet';
        if (modelUsage) {
          const modelKeys = Object.keys(modelUsage);
          if (modelKeys.length > 0) {
            const key = modelKeys[0];
            if (key.includes('opus')) actualModel = 'opus';
            else if (key.includes('haiku')) actualModel = 'haiku';
            else actualModel = 'sonnet';
          }
        }

        recordCallUsage(actualModel, tokenUsage);
      }
    } catch {
      // If not valid JSON, use raw output
      content = result;
    }

    logger.info('claude-cli', 'Claude response received', {
      model: request.model ?? 'default',
      durationMs,
      responseLength: content.length,
      tokens: tokenUsage ? tokenUsage.inputTokens + tokenUsage.outputTokens : undefined,
    });

    return {
      content,
      model: request.model ?? 'sonnet',
      durationMs,
      tokenUsage,
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
 * Get CLI usage based on tracked token consumption.
 * Returns the highest usage percentage across all 3 windows.
 */
export async function checkUsage(): Promise<UsageInfo> {
  try {
    const { getLatestUsage } = await import('./usage-tracker.js');
    const usage = getLatestUsage();
    const maxPercent = Math.max(usage.sessionPercent, usage.weeklyAllPercent, usage.weeklySonnetPercent);

    const rawOutput = [
      `Session (5h): ${formatTokens(usage.sessionTokens)} (${usage.sessionPercent.toFixed(1)}%)`,
      `Weekly All: ${formatTokens(usage.weeklyAllTokens)} (${usage.weeklyAllPercent.toFixed(1)}%)`,
      `Weekly Sonnet: ${formatTokens(usage.weeklySonnetTokens)} (${usage.weeklySonnetPercent.toFixed(1)}%)`,
    ].join(' | ');

    logger.info('claude-cli', 'Usage check', { session: usage.sessionPercent, weeklyAll: usage.weeklyAllPercent, weeklySonnet: usage.weeklySonnetPercent });

    return {
      percentUsed: maxPercent,
      rawOutput,
      timestamp: Date.now(),
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('claude-cli', 'Usage check failed', { error: errMsg });

    return {
      percentUsed: -1,
      rawOutput: errMsg,
      timestamp: Date.now(),
    };
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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
