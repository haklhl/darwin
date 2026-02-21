// ============================================================
// Darwin - Tool Definitions and Execution
// ============================================================

import { logger } from '../observability/logger.js';
import { sendToOperator } from '../telegram/bot.js';
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
