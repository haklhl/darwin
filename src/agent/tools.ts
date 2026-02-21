// ============================================================
// Darwin - Tool Definitions and Execution
// ============================================================

import { logger } from '../observability/logger.js';
import { sendToOperator } from '../telegram/bot.js';
import { kvSet } from '../state/database.js';
import { getUsdcBalance, getEthBalance } from '../chain/usdc.js';
import { getWalletAddress } from '../identity/wallet.js';
import { getLatestUsage, getSessionResetsAt, getRateLimitStatus } from '../inference/usage-tracker.js';
import { selectModel } from '../inference/model-strategy.js';
import type { ToolCall, ToolResult, ToolName } from '../types.js';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required: boolean;
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: ToolParameter[];
  category: 'financial' | 'filesystem' | 'system' | 'memory' | 'network' | 'identity';
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const toolHandlers: Record<string, ToolHandler> = {};

// --- Tool Definitions ---

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'check_balance',
    description: 'Check USDC and ETH balances for the Darwin wallet',
    parameters: [],
    category: 'financial',
  },
  {
    name: 'transfer_usdc',
    description: 'Transfer USDC to a specified address',
    parameters: [
      { name: 'to', type: 'string', description: 'Recipient address (0x...)', required: true },
      { name: 'amount', type: 'number', description: 'Amount of USDC to transfer', required: true },
      { name: 'reason', type: 'string', description: 'Reason for transfer', required: true },
    ],
    category: 'financial',
  },
  {
    name: 'execute_defi',
    description: 'Execute a DeFi operation (swap, provide liquidity, stake, etc.)',
    parameters: [
      { name: 'protocol', type: 'string', description: 'Protocol name (e.g., uniswap, aave)', required: true },
      { name: 'action', type: 'string', description: 'Action type (swap, deposit, withdraw, stake)', required: true },
      { name: 'params', type: 'object', description: 'Action-specific parameters', required: true },
    ],
    category: 'financial',
  },
  {
    name: 'read_file',
    description: 'Read a file from the filesystem',
    parameters: [
      { name: 'path', type: 'string', description: 'File path to read', required: true },
    ],
    category: 'filesystem',
  },
  {
    name: 'write_file',
    description: 'Write content to a file on the filesystem',
    parameters: [
      { name: 'path', type: 'string', description: 'File path to write', required: true },
      { name: 'content', type: 'string', description: 'Content to write', required: true },
    ],
    category: 'filesystem',
  },
  {
    name: 'run_command',
    description: 'Run a shell command and return output',
    parameters: [
      { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
      { name: 'timeout', type: 'number', description: 'Timeout in milliseconds (default 30000)', required: false },
    ],
    category: 'system',
  },
  {
    name: 'search_web',
    description: 'Search the web for information',
    parameters: [
      { name: 'query', type: 'string', description: 'Search query', required: true },
      { name: 'maxResults', type: 'number', description: 'Maximum number of results (default 5)', required: false },
    ],
    category: 'network',
  },
  {
    name: 'memory_store',
    description: 'Store information in long-term memory',
    parameters: [
      { name: 'layer', type: 'string', description: 'Memory layer (working, episodic, semantic, procedural, relationship)', required: true },
      { name: 'key', type: 'string', description: 'Memory key for retrieval', required: true },
      { name: 'content', type: 'string', description: 'Content to store', required: true },
      { name: 'importance', type: 'number', description: 'Importance score 0-1 (default 0.5)', required: false },
    ],
    category: 'memory',
  },
  {
    name: 'memory_retrieve',
    description: 'Retrieve information from long-term memory',
    parameters: [
      { name: 'query', type: 'string', description: 'Search query for memory', required: true },
      { name: 'layer', type: 'string', description: 'Specific layer to search (optional)', required: false },
      { name: 'limit', type: 'number', description: 'Maximum entries to return (default 5)', required: false },
    ],
    category: 'memory',
  },
  {
    name: 'soul_reflect',
    description: 'Perform a self-reflection on goals, values, and current state',
    parameters: [
      { name: 'topic', type: 'string', description: 'Topic to reflect on', required: true },
    ],
    category: 'identity',
  },
  {
    name: 'start_service',
    description: 'Start an AI service endpoint for earning income',
    parameters: [
      { name: 'serviceName', type: 'string', description: 'Name of the service to start', required: true },
      { name: 'port', type: 'number', description: 'Port to listen on', required: false },
    ],
    category: 'system',
  },
  {
    name: 'stop_service',
    description: 'Stop a running AI service endpoint',
    parameters: [
      { name: 'serviceName', type: 'string', description: 'Name of the service to stop', required: true },
    ],
    category: 'system',
  },
  {
    name: 'check_usage',
    description: 'Check current Claude API usage percentage',
    parameters: [],
    category: 'system',
  },
  {
    name: 'send_message',
    description: 'Send a message to the operator via Telegram',
    parameters: [
      { name: 'message', type: 'string', description: 'Message content to send', required: true },
    ],
    category: 'network',
  },
  {
    name: 'self_modify',
    description: 'Modify own source code (requires audit logging)',
    parameters: [
      { name: 'filePath', type: 'string', description: 'Path to the file to modify', required: true },
      { name: 'diff', type: 'string', description: 'The modification to apply (unified diff format)', required: true },
      { name: 'reason', type: 'string', description: 'Reason for the modification', required: true },
    ],
    category: 'system',
  },
  {
    name: 'ask_operator',
    description: 'Ask the operator (卡卡西) for help and wait for a reply. Use when you are blocked by something that requires human intervention (API keys, captchas, account registration, decisions). The agent will sleep until the operator replies.',
    parameters: [
      { name: 'category', type: 'string', description: 'Category of help needed (api_key, captcha, registration, decision, other)', required: true },
      { name: 'question', type: 'string', description: 'The specific question or request for the operator', required: true },
      { name: 'context', type: 'string', description: 'Background context explaining why you need help and what you were trying to do', required: true },
      { name: 'urgency', type: 'string', description: 'Urgency level: high (blocking critical task), normal (blocking non-critical), low (nice to have)', required: false },
    ],
    category: 'network',
  },
];

// --- Stub Handlers ---
// These will be replaced with real implementations as modules are built.

function stubHandler(toolName: ToolName): ToolHandler {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    logger.info('tools', `Stub handler called for ${toolName}`, { args });
    return {
      name: toolName,
      success: true,
      output: `[STUB] ${toolName} executed with args: ${JSON.stringify(args)}`,
    };
  };
}

// Register stub handlers for all tools
for (const def of TOOL_DEFINITIONS) {
  toolHandlers[def.name] = stubHandler(def.name);
}

// Register real handler for send_message (Telegram)
toolHandlers['send_message'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const message = String(args.message ?? '');
  if (!message) {
    return { name: 'send_message', success: false, output: '', error: 'No message provided' };
  }
  const sent = await sendToOperator(message);
  return {
    name: 'send_message',
    success: sent,
    output: sent ? 'Message sent to operator via Telegram' : 'Failed to send message',
  };
};

// Register real handler for check_balance (on-chain RPC)
toolHandlers['check_balance'] = async (_args: Record<string, unknown>): Promise<ToolResult> => {
  try {
    const address = getWalletAddress();
    const [usdcBalance, ethBalance] = await Promise.all([
      getUsdcBalance(),
      getEthBalance(),
    ]);

    const output = [
      `Wallet: ${address}`,
      `Chain: Base (chainId 8453)`,
      `USDC: $${usdcBalance.toFixed(2)}`,
      `ETH: ${ethBalance.toFixed(6)}`,
    ].join('\n');

    logger.info('tools', 'check_balance: real balance fetched', { usdcBalance, ethBalance });

    return { name: 'check_balance', success: true, output };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('tools', 'check_balance failed', { error: errMsg });
    return { name: 'check_balance', success: false, output: '', error: `Balance check failed: ${errMsg}` };
  }
};

// Register real handler for check_usage (token usage tracker)
toolHandlers['check_usage'] = async (_args: Record<string, unknown>): Promise<ToolResult> => {
  try {
    const usage = getLatestUsage();
    const model = selectModel(usage, 'conversation');
    const sessionResets = getSessionResetsAt();
    const rlStatus = getRateLimitStatus();

    const fmt = (n: number) => {
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return String(n);
    };

    const lines = [
      `Session (5h): ${usage.sessionPercent.toFixed(1)}% (${fmt(usage.sessionTokens)} tokens)`,
      `Weekly All Models: ${usage.weeklyAllPercent.toFixed(1)}% (${fmt(usage.weeklyAllTokens)} tokens)`,
      `Weekly Sonnet: ${usage.weeklySonnetPercent.toFixed(1)}% (${fmt(usage.weeklySonnetTokens)} tokens)`,
      `Trend: ${usage.trend}`,
      `Current Model: ${model}`,
      `Rate Limit: ${rlStatus}`,
    ];

    if (sessionResets > Date.now()) {
      const mins = Math.round((sessionResets - Date.now()) / 60_000);
      lines.push(`Session resets in: ${Math.floor(mins / 60)}h${mins % 60}m`);
    }

    return { name: 'check_usage', success: true, output: lines.join('\n') };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { name: 'check_usage', success: false, output: '', error: `Usage check failed: ${errMsg}` };
  }
};

// Register real handler for ask_operator (Telegram + sleep/wait)
toolHandlers['ask_operator'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const category = String(args.category ?? 'other');
  const question = String(args.question ?? '');
  const context = String(args.context ?? '');
  const urgency = String(args.urgency ?? 'normal');

  if (!question) {
    return { name: 'ask_operator', success: false, output: '', error: 'No question provided' };
  }

  const urgencyIcon = urgency === 'high' ? '🔴' : urgency === 'low' ? '🟢' : '🟡';

  const telegramMsg = [
    `🆘 角都求助 ${urgencyIcon}`,
    `─────────────────`,
    `类别: ${category}`,
    `紧急度: ${urgency}`,
    ``,
    `❓ ${question}`,
    ``,
    `📋 背景: ${context}`,
    ``,
    `💡 请直接回复此消息，角都收到后会自动继续工作。`,
  ].join('\n');

  const sent = await sendToOperator(telegramMsg);
  if (!sent) {
    return { name: 'ask_operator', success: false, output: '', error: 'Failed to send help request via Telegram' };
  }

  // Store pending state for handler to detect operator reply
  const pendingData = JSON.stringify({
    category,
    question,
    context,
    urgency,
    askedAt: Date.now(),
  });
  kvSet('pending_ask_operator', pendingData);

  logger.info('tools', 'ask_operator: help request sent, agent will sleep', { category, urgency });

  return {
    name: 'ask_operator',
    success: true,
    output: `Help request sent to 卡卡西. Agent will now sleep and wait for reply (max 24h).`,
  };
};

/**
 * Register a real handler for a tool, replacing the stub.
 */
export function registerToolHandler(name: ToolName, handler: ToolHandler): void {
  toolHandlers[name] = handler;
  logger.debug('tools', `Registered handler for tool: ${name}`);
}

/**
 * Get all tool definitions for inclusion in the system prompt.
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [...TOOL_DEFINITIONS];
}

/**
 * Get a specific tool definition by name.
 */
export function getToolDefinition(name: ToolName): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

/**
 * Execute a tool call by dispatching to the registered handler.
 */
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const handler = toolHandlers[call.name];

  if (!handler) {
    logger.error('tools', `No handler registered for tool: ${call.name}`);
    return {
      name: call.name,
      success: false,
      output: '',
      error: `Unknown tool: ${call.name}`,
    };
  }

  const startTime = Date.now();

  try {
    const result = await handler(call.args);
    const durationMs = Date.now() - startTime;

    logger.info('tools', `Tool ${call.name} completed`, {
      success: result.success,
      durationMs,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);

    logger.error('tools', `Tool ${call.name} threw an error`, {
      error: errMsg,
      durationMs,
    });

    return {
      name: call.name,
      success: false,
      output: '',
      error: errMsg,
    };
  }
}

/**
 * Get the category for a tool (used by policy engine for rate limiting).
 */
export function getToolCategory(name: ToolName): string {
  const def = TOOL_DEFINITIONS.find((t) => t.name === name);
  return def?.category ?? 'unknown';
}
