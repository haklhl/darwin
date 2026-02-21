// ============================================================
// 角都 - Core ReAct Agent Loop
// ============================================================

import { logger } from '../observability/logger.js';
import { getDatabase, setAgentState, setSleepUntil, kvGetNumber } from '../state/database.js';
import { callClaude } from '../inference/claude-cli.js';
import { selectModel } from '../inference/model-strategy.js';
import { getLatestUsage } from '../inference/usage-tracker.js';
import { shouldThrottle, getThrottleDelay } from '../inference/budget.js';
import { buildSystemPrompt } from './system-prompt.js';
import { executeTool } from './tools.js';
import { assembleContext, estimateTokens } from './context.js';
import { evaluatePolicy } from './policy-engine.js';
import type {
  AgentStep,
  AgentLoopResult,
  AgentThought,
  ToolCall,
  PolicyContext,
  SurvivalState,
  MemoryEntry,
  ToolName,
  TaskType,
} from '../types.js';

// --- Idle & Loop Detection ---
const MAX_IDLE_TURNS = 3;
const MAX_REPETITIVE_TURNS = 3;
const READ_ONLY_TOOLS = new Set([
  'check_balance', 'check_usage', 'memory_retrieve', 'soul_reflect', 'read_file',
]);

const DEFAULT_MAX_STEPS = 10;

// Global lock to prevent concurrent agent loops (OOM protection on low-memory VPS)
let agentLoopBusy = false;
let agentLoopTrigger = '';

export function isAgentLoopBusy(): boolean {
  return agentLoopBusy;
}

export function getCurrentTrigger(): string {
  return agentLoopTrigger;
}

/**
 * Run the core ReAct agent loop.
 *
 * Steps:
 * 1. Build system prompt with context
 * 2. Call Claude with the prompt
 * 3. Parse response for thought + tool call
 * 4. If tool call: evaluate policy -> execute tool -> observe result
 * 5. Append step, loop back to 2 with updated context
 * 6. If no tool call (final answer), return result
 * 7. Max steps default 10
 *
 * Only one agent loop can run at a time (global lock).
 */
export async function runAgentLoop(
  trigger: string,
  maxSteps: number = DEFAULT_MAX_STEPS,
): Promise<AgentLoopResult> {
  if (agentLoopBusy) {
    logger.warn('agent-loop', 'Agent loop already running, skipping', {
      currentTrigger: agentLoopTrigger.substring(0, 80),
      rejectedTrigger: trigger.substring(0, 80),
    });
    return {
      steps: [],
      finalAnswer: `⏳ 当前正在处理其他任务，请稍后再试。\n正在执行: ${agentLoopTrigger.substring(0, 50)}...`,
      tokensUsed: 0,
    };
  }

  agentLoopBusy = true;
  agentLoopTrigger = trigger;
  const steps: AgentStep[] = [];
  let totalTokens = 0;

  // Get current state
  const usageState = getLatestUsage();
  const survivalState = getSurvivalState();
  const memories = getRelevantMemories(trigger);

  // Create a conversation record
  const conversationId = createConversation();

  logger.info('agent-loop', 'Starting agent loop', {
    trigger: trigger.substring(0, 100),
    maxSteps,
    survivalTier: survivalState.tier,
    usagePercent: usageState.currentPercent,
  });

  let idleTurnCount = 0;
  const toolPatterns: string[] = [];

  try { // outer try/finally to always release global lock
  try {
    for (let step = 0; step < maxSteps; step++) {
      // Check throttle
      if (shouldThrottle(usageState.currentPercent)) {
        const delay = getThrottleDelay(usageState.currentPercent);
        logger.info('agent-loop', `Throttling for ${delay}ms`, { usagePercent: usageState.currentPercent });
        await sleep(delay);
      }

      // Select model based on task type and usage
      const taskType = inferTaskType(trigger, steps);
      const model = selectModel(usageState, taskType);

      // Build context
      const context = assembleContext({
        memories,
        recentSteps: steps,
        survivalState,
        usageState,
      });

      // Build system prompt
      const systemPrompt = buildSystemPrompt({
        survivalTier: survivalState.tier,
        usdcBalance: survivalState.usdcBalance,
        ethBalance: survivalState.ethBalance,
        currentModel: model,
        usagePercent: usageState.currentPercent,
        activePositions: 0, // TODO: get from DeFi module
        recentEarnings: 0, // TODO: get from earnings module
      });

      // Build the user message with context
      const userMessage = step === 0
        ? `${context}\n\n## Task\n${trigger}`
        : `${context}\n\nContinue with the next step.`;

      // Call Claude
      const result = await callClaude({
        prompt: userMessage,
        systemPrompt,
        model,
        taskType,
      });

      totalTokens += estimateTokens(result.content);

      if (result.error) {
        logger.error('agent-loop', 'Claude call failed', { error: result.error, step });
        steps.push({
          thought: `Error calling Claude: ${result.error}`,
          timestamp: Date.now(),
        });

        finishConversation(conversationId, steps.length, totalTokens);
        return {
          steps,
          finalAnswer: `Claude 调用失败: ${result.error}`,
          tokensUsed: totalTokens,
        };
      }

      // Parse the response
      const parsed = parseResponse(result.content);

      if (!parsed.action) {
        // Final answer - no tool call
        const finalStep: AgentStep = {
          thought: parsed.thought,
          timestamp: Date.now(),
        };
        steps.push(finalStep);
        recordStep(conversationId, step, finalStep);

        logger.info('agent-loop', 'Agent loop completed with final answer', {
          steps: steps.length,
          totalTokens,
        });

        finishConversation(conversationId, steps.length, totalTokens);

        return {
          steps,
          finalAnswer: parsed.thought,
          tokensUsed: totalTokens,
        };
      }

      // Tool call detected - evaluate policy
      const policyContext: PolicyContext = {
        toolCall: parsed.action,
        survivalTier: survivalState.tier,
        usdcBalance: survivalState.usdcBalance,
        recentSpend: 0, // TODO: get from spend tracker
      };

      const policyResult = evaluatePolicy(policyContext);

      if (policyResult.decision === 'deny') {
        const deniedStep: AgentStep = {
          thought: parsed.thought,
          action: parsed.action,
          observation: `[POLICY DENIED] ${policyResult.reason} (rule: ${policyResult.rule})`,
          timestamp: Date.now(),
        };
        steps.push(deniedStep);
        recordStep(conversationId, step, deniedStep);

        logger.warn('agent-loop', 'Tool call denied by policy', {
          tool: parsed.action.name,
          rule: policyResult.rule,
          reason: policyResult.reason,
        });
        continue;
      }

      if (policyResult.decision === 'ask') {
        const askStep: AgentStep = {
          thought: parsed.thought,
          action: parsed.action,
          observation: `[REQUIRES APPROVAL] ${policyResult.reason} (rule: ${policyResult.rule})`,
          timestamp: Date.now(),
        };
        steps.push(askStep);
        recordStep(conversationId, step, askStep);
        continue;
      }

      // Execute the tool
      logger.info('agent-loop', `Executing tool: ${parsed.action.name}`, {
        args: parsed.action.args,
        step,
      });

      const toolResult = await executeTool(parsed.action);

      const executedStep: AgentStep = {
        thought: parsed.thought,
        action: parsed.action,
        observation: toolResult.success
          ? toolResult.output
          : `[ERROR] ${toolResult.error ?? 'Unknown error'}`,
        timestamp: Date.now(),
      };
      steps.push(executedStep);
      recordStep(conversationId, step, executedStep);

      // --- Sleep tool support ---
      if (parsed.action.name === 'sleep' as ToolName) {
        const sleepMinutes = Number(parsed.action.args.minutes) || 30;
        const sleepUntil = Date.now() + sleepMinutes * 60_000;
        setSleepUntil(sleepUntil);
        setAgentState('sleeping');
        logger.info('agent-loop', `Agent requested sleep for ${sleepMinutes} minutes`);
        finishConversation(conversationId, steps.length, totalTokens);
        return {
          steps,
          finalAnswer: `💤 角都休眠 ${sleepMinutes} 分钟`,
          tokensUsed: totalTokens,
        };
      }

      // --- ask_operator support: sleep until operator replies (max 24h) ---
      if (parsed.action.name === 'ask_operator') {
        const sleepMs = 24 * 60 * 60_000; // 24 hours max
        setSleepUntil(Date.now() + sleepMs);
        setAgentState('sleeping');
        logger.info('agent-loop', 'Agent waiting for operator reply (ask_operator), sleeping up to 24h');
        finishConversation(conversationId, steps.length, totalTokens);
        return {
          steps,
          finalAnswer: `🆘 角都已向卡卡西发送求助，等待回复中（最长 24 小时）...`,
          tokensUsed: totalTokens,
        };
      }

      // --- Idle detection ---
      const didMutate = !READ_ONLY_TOOLS.has(parsed.action.name);
      if (didMutate) {
        idleTurnCount = 0;
      } else {
        idleTurnCount++;
        if (idleTurnCount >= MAX_IDLE_TURNS) {
          logger.info('agent-loop', `Idle detected: ${idleTurnCount} read-only turns. Sleeping.`);
          setSleepUntil(Date.now() + 60_000);
          setAgentState('sleeping');
          finishConversation(conversationId, steps.length, totalTokens);
          return {
            steps,
            finalAnswer: '[IDLE] 连续空转，休眠节省资源。',
            tokensUsed: totalTokens,
          };
        }
      }

      // --- Loop detection ---
      const currentPattern = parsed.action.name;
      toolPatterns.push(currentPattern);
      if (toolPatterns.length > MAX_REPETITIVE_TURNS) {
        toolPatterns.shift();
      }
      if (
        toolPatterns.length === MAX_REPETITIVE_TURNS &&
        toolPatterns.every((p) => p === currentPattern)
      ) {
        // Inject a system nudge as the next trigger
        logger.warn('agent-loop', `Loop detected: ${currentPattern} repeated ${MAX_REPETITIVE_TURNS}x`);
        // Override the next step's context with a loop-breaking message
        trigger = `[系统警告] 你已经连续 ${MAX_REPETITIVE_TURNS} 次调用 ${currentPattern}，停止重复！换个思路，去做一些能赚钱的事。`;
        toolPatterns.length = 0;
      }
    }

    // Reached max steps
    logger.warn('agent-loop', 'Agent loop reached max steps', { maxSteps, totalTokens });

    finishConversation(conversationId, steps.length, totalTokens);

    const lastThought = steps.length > 0
      ? steps[steps.length - 1].thought
      : 'No steps executed';

    return {
      steps,
      finalAnswer: `[MAX STEPS REACHED] ${lastThought}`,
      tokensUsed: totalTokens,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('agent-loop', 'Agent loop failed with error', { error: errMsg });

    finishConversation(conversationId, steps.length, totalTokens);

    return {
      steps,
      finalAnswer: `[ERROR] Agent loop failed: ${errMsg}`,
      tokensUsed: totalTokens,
    };
  }
  } finally {
    agentLoopBusy = false;
    agentLoopTrigger = '';
  }
}

/**
 * Parse Claude's response to extract thought and optional tool call.
 * Looks for JSON tool calls in the response text.
 */
function parseResponse(content: string): AgentThought {
  // Try to find a JSON tool call block
  const jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);

  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim()) as { tool?: string; args?: Record<string, unknown> };

      if (parsed.tool) {
        // Extract thought: everything before the JSON block
        const thoughtEnd = content.indexOf('```json');
        const thought = content.substring(0, thoughtEnd).trim() || 'Executing tool call';

        return {
          thought,
          action: {
            name: parsed.tool as ToolName,
            args: parsed.args ?? {},
          },
        };
      }
    } catch {
      // JSON parse failed, treat as regular text
    }
  }

  // Try inline JSON (no code block)
  const inlineMatch = content.match(/\{"tool"\s*:\s*"([^"]+)".*?\}/s);
  if (inlineMatch) {
    try {
      const parsed = JSON.parse(inlineMatch[0]) as { tool: string; args?: Record<string, unknown> };
      const thoughtEnd = content.indexOf(inlineMatch[0]);
      const thought = content.substring(0, thoughtEnd).trim() || 'Executing tool call';

      return {
        thought,
        action: {
          name: parsed.tool as ToolName,
          args: parsed.args ?? {},
        },
      };
    } catch {
      // Parse failed
    }
  }

  // No tool call found - entire response is the thought/answer
  return {
    thought: content.trim(),
  };
}

/**
 * Infer the task type from the trigger and current steps.
 */
function inferTaskType(trigger: string, steps: AgentStep[]): TaskType {
  const lower = trigger.toLowerCase();

  if (lower.includes('code') || lower.includes('write') || lower.includes('implement') || lower.includes('fix bug')) {
    return 'code_generation';
  }
  if (lower.includes('analyze') || lower.includes('plan') || lower.includes('strategy') || lower.includes('decide')) {
    return 'complex_reasoning';
  }
  if (lower.includes('status') || lower.includes('check') || lower.includes('balance')) {
    return 'status_check';
  }
  if (steps.length === 0 && lower.length < 50) {
    return 'simple_decision';
  }

  return 'conversation';
}

/**
 * Get the current survival state.
 * TODO: integrate with actual survival module once built.
 */
function getSurvivalState(): SurvivalState {
  // Read from KV store (written by heartbeat checkUsdcBalance task)
  const usdcStr = kvGetNumber('last_usdc_balance');
  const ethStr = kvGetNumber('last_eth_balance');
  const tierStr = (getDatabase().prepare("SELECT value FROM kv_store WHERE key = 'last_survival_tier'").get() as { value: string } | undefined)?.value;

  if (usdcStr !== null) {
    return {
      tier: (tierStr as SurvivalState['tier']) ?? 'normal',
      usdcBalance: usdcStr,
      ethBalance: ethStr ?? 0,
      lastChecked: Date.now(),
    };
  }

  // Fallback: if KV has no data yet, return safe defaults
  return {
    tier: 'normal',
    usdcBalance: 100, // Assume funded until heartbeat confirms
    ethBalance: 0.01,
    lastChecked: Date.now(),
  };
}

/**
 * Get relevant memories for the given trigger.
 * TODO: integrate with actual memory module once built.
 */
function getRelevantMemories(_trigger: string): MemoryEntry[] {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, layer, key, content, metadata, importance, access_count,
             created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt
      FROM memories
      ORDER BY importance DESC, updated_at DESC
      LIMIT 10
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as number,
      layer: row.layer as MemoryEntry['layer'],
      key: row.key as string,
      content: row.content as string,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
      importance: row.importance as number,
      accessCount: row.access_count as number,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      expiresAt: row.expiresAt as number | undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Create a new conversation record in the database.
 */
function createConversation(): number {
  try {
    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO conversations (started_at, status) VALUES (?, 'active')
    `).run(Date.now());
    return Number(result.lastInsertRowid);
  } catch {
    return 0;
  }
}

/**
 * Record a single agent step in the database.
 */
function recordStep(conversationId: number, stepIndex: number, step: AgentStep): void {
  if (conversationId === 0) return;

  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO agent_steps (conversation_id, step_index, thought, tool_name, tool_args, observation, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversationId,
      stepIndex,
      step.thought,
      step.action?.name ?? null,
      step.action ? JSON.stringify(step.action.args) : null,
      step.observation ?? null,
      step.timestamp,
    );
  } catch {
    // Non-critical, just log
    logger.warn('agent-loop', 'Failed to record step to database');
  }
}

/**
 * Finalize the conversation record.
 */
function finishConversation(conversationId: number, stepsCount: number, tokensUsed: number): void {
  if (conversationId === 0) return;

  try {
    const db = getDatabase();
    db.prepare(`
      UPDATE conversations
      SET ended_at = ?, steps_count = ?, tokens_used = ?, status = 'completed'
      WHERE id = ?
    `).run(Date.now(), stepsCount, tokensUsed, conversationId);
  } catch {
    logger.warn('agent-loop', 'Failed to finalize conversation record');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
