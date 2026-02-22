// ============================================================
// Darwin - Tool Definitions and Execution
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { dirname } from 'path';
import { execSync } from 'child_process';
import { logger } from '../observability/logger.js';
import { sendToOperator } from '../telegram/bot.js';
import { kvSet, kvGet, getDatabase, recordSpend } from '../state/database.js';
import { getUsdcBalance, getAaveUsdcBalance, getEthBalance, transferUsdc } from '../chain/usdc.js';
import { executeStrategy, getAvailableStrategies, withdrawAave } from '../chain/defi.js';
import { getWalletAddress } from '../identity/wallet.js';
import { getLatestUsage, getSessionResetsAt, getRateLimitStatus } from '../inference/usage-tracker.js';
import { postTweet } from '../social/x-client.js';
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
    description: 'Modify own source code (requires audit logging). Uses search-and-replace.',
    parameters: [
      { name: 'filePath', type: 'string', description: 'Path to the file to modify', required: true },
      { name: 'old_text', type: 'string', description: 'Exact text to find in the file (must be unique)', required: true },
      { name: 'new_text', type: 'string', description: 'Replacement text', required: true },
      { name: 'reason', type: 'string', description: 'Reason for the modification', required: true },
    ],
    category: 'system',
  },
  {
    name: 'post_tweet',
    description: 'Post a tweet on X (Twitter). Max 280 characters.',
    parameters: [
      { name: 'text', type: 'string', description: 'Tweet content (max 280 chars)', required: true },
    ],
    category: 'network',
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
    logger.warn('tools', `Stub handler called for ${toolName} — not implemented`, { args });
    return {
      name: toolName,
      success: false,
      output: '',
      error: `工具 ${toolName} 尚未实现。请使用 ask_operator 向卡卡西求助，说明你需要这个功能。`,
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
    const [walletUsdc, aaveUsdc, ethBalance] = await Promise.all([
      getUsdcBalance(),
      getAaveUsdcBalance(),
      getEthBalance(),
    ]);
    const totalUsdc = walletUsdc + aaveUsdc;

    const output = [
      `Wallet: ${address}`,
      `Chain: Base (chainId 8453)`,
      `--- USDC ---`,
      `钱包 USDC: $${walletUsdc.toFixed(2)}`,
      `Aave V3 存款: $${aaveUsdc.toFixed(2)}`,
      `USDC 总计: $${totalUsdc.toFixed(2)}`,
      `--- ETH ---`,
      `ETH: ${ethBalance.toFixed(6)}`,
      `--- 注意 ---`,
      `钱包至少保留 $10 USDC 作为储备金，不要全部存入 DeFi。`,
    ].join('\n');

    logger.info('tools', 'check_balance: real balance fetched', { walletUsdc, aaveUsdc, totalUsdc, ethBalance });

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

// --- Real handler: read_file ---
toolHandlers['read_file'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const filePath = String(args.path ?? '');
  if (!filePath) {
    return { name: 'read_file', success: false, output: '', error: 'No path provided' };
  }
  try {
    if (!existsSync(filePath)) {
      return { name: 'read_file', success: false, output: '', error: `File not found: ${filePath}` };
    }
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return { name: 'read_file', success: false, output: '', error: `Path is a directory: ${filePath}` };
    }
    if (stat.size > 100_000) {
      return { name: 'read_file', success: false, output: '', error: `File too large (${(stat.size / 1024).toFixed(0)}KB > 100KB limit): ${filePath}` };
    }
    const content = readFileSync(filePath, 'utf-8');
    return { name: 'read_file', success: true, output: content };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { name: 'read_file', success: false, output: '', error: errMsg };
  }
};

// --- Real handler: write_file ---
toolHandlers['write_file'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const filePath = String(args.path ?? '');
  const content = String(args.content ?? '');
  if (!filePath) {
    return { name: 'write_file', success: false, output: '', error: 'No path provided' };
  }
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, content, 'utf-8');
    logger.info('tools', 'write_file: file written', { path: filePath, bytes: content.length });
    return { name: 'write_file', success: true, output: `File written: ${filePath} (${content.length} bytes)` };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { name: 'write_file', success: false, output: '', error: errMsg };
  }
};

// --- Real handler: run_command ---
toolHandlers['run_command'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const command = String(args.command ?? '');
  if (!command) {
    return { name: 'run_command', success: false, output: '', error: 'No command provided' };
  }
  // Block sudo
  if (/\bsudo\b/.test(command)) {
    return { name: 'run_command', success: false, output: '', error: 'sudo is not allowed' };
  }
  const timeoutMs = Math.min(Number(args.timeout) || 30_000, 120_000);
  try {
    logger.info('tools', 'run_command: executing', { command: command.substring(0, 200), timeoutMs });
    const output = execSync(command, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1MB
      cwd: process.cwd(),
      env: { ...process.env },
    });
    const trimmed = output.length > 100_000 ? output.substring(0, 100_000) + '\n...[truncated]' : output;
    return { name: 'run_command', success: true, output: trimmed };
  } catch (error: unknown) {
    const execError = error as { status?: number; stdout?: string; stderr?: string; message?: string };
    const stderr = execError.stderr ?? '';
    const stdout = execError.stdout ?? '';
    const msg = execError.message ?? 'Command failed';
    const combined = (stdout + '\n' + stderr).trim();
    const truncated = combined.length > 100_000 ? combined.substring(0, 100_000) + '\n...[truncated]' : combined;
    return { name: 'run_command', success: false, output: truncated, error: `Exit code ${execError.status ?? '?'}: ${msg.substring(0, 200)}` };
  }
};

// --- Real handler: memory_store ---
toolHandlers['memory_store'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const layer = String(args.layer ?? 'working');
  const key = String(args.key ?? '');
  const content = String(args.content ?? '');
  const importance = Number(args.importance ?? 0.5);
  if (!key || !content) {
    return { name: 'memory_store', success: false, output: '', error: 'key and content are required' };
  }
  try {
    const now = Date.now();
    const db = getDatabase();
    // Check if memory with same layer+key exists
    const existing = db.prepare('SELECT id FROM memories WHERE layer = ? AND key = ?').get(layer, key) as { id: number } | undefined;
    if (existing) {
      db.prepare('UPDATE memories SET content = ?, importance = ?, updated_at = ? WHERE id = ?').run(content, importance, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO memories (layer, key, content, metadata, importance, access_count, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, 0, ?, ?)
      `).run(layer, key, content, importance, now, now);
    }
    logger.info('tools', 'memory_store: stored', { layer, key });
    return { name: 'memory_store', success: true, output: `Memory stored: [${layer}] ${key}` };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { name: 'memory_store', success: false, output: '', error: errMsg };
  }
};

// --- Real handler: memory_retrieve ---
toolHandlers['memory_retrieve'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const query = String(args.query ?? '');
  const layer = args.layer ? String(args.layer) : null;
  const limit = Math.min(Number(args.limit) || 5, 20);
  if (!query) {
    return { name: 'memory_retrieve', success: false, output: '', error: 'query is required' };
  }
  try {
    const db = getDatabase();
    const likeQ = `%${query}%`;
    let sql = `SELECT id, layer, key, content, importance, access_count, created_at, updated_at
               FROM memories WHERE (content LIKE ? OR key LIKE ?)`;
    const params: unknown[] = [likeQ, likeQ];
    if (layer) {
      sql += ' AND layer = ?';
      params.push(layer);
    }
    sql += ' ORDER BY importance DESC, updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    // Update access_count for retrieved memories
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      db.prepare(`UPDATE memories SET access_count = access_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }

    if (rows.length === 0) {
      return { name: 'memory_retrieve', success: true, output: 'No memories found matching query.' };
    }

    const output = rows.map(r =>
      `[${r.layer}/${r.key}] (importance: ${r.importance}) ${String(r.content).substring(0, 500)}`
    ).join('\n---\n');

    return { name: 'memory_retrieve', success: true, output };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { name: 'memory_retrieve', success: false, output: '', error: errMsg };
  }
};

// --- Real handler: self_modify (search-and-replace with audit) ---
toolHandlers['self_modify'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const filePath = String(args.filePath ?? '');
  const oldText = String(args.old_text ?? '');
  const newText = String(args.new_text ?? '');
  const reason = String(args.reason ?? 'No reason given');
  if (!filePath || !oldText) {
    return { name: 'self_modify', success: false, output: '', error: 'filePath and old_text are required' };
  }
  try {
    if (!existsSync(filePath)) {
      return { name: 'self_modify', success: false, output: '', error: `File not found: ${filePath}` };
    }
    const original = readFileSync(filePath, 'utf-8');
    if (!original.includes(oldText)) {
      return { name: 'self_modify', success: false, output: '', error: 'old_text not found in file (must match exactly)' };
    }
    const occurrences = original.split(oldText).length - 1;
    if (occurrences > 1) {
      return { name: 'self_modify', success: false, output: '', error: `old_text found ${occurrences} times — must be unique. Provide more context.` };
    }

    const modified = original.replace(oldText, newText);
    writeFileSync(filePath, modified, 'utf-8');

    // Audit log
    const db = getDatabase();
    const diff = `--- old\n+++ new\n@@ @@\n-${oldText.substring(0, 500)}\n+${newText.substring(0, 500)}`;
    db.prepare('INSERT INTO self_mod_log (file_path, diff, reason, approved, timestamp) VALUES (?, ?, ?, 1, ?)').run(
      filePath, diff, reason, Date.now()
    );

    logger.info('tools', 'self_modify: code modified', { filePath, reason });

    // Notify operator
    sendToOperator(`🔧 角都修改了代码\nFile: ${filePath}\nReason: ${reason}\nDiff: -${oldText.substring(0, 100)}... → +${newText.substring(0, 100)}...`).catch(() => {});

    return { name: 'self_modify', success: true, output: `File modified: ${filePath}\nReason: ${reason}\nRemember to run \`npx tsc\` to verify compilation.` };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { name: 'self_modify', success: false, output: '', error: errMsg };
  }
};

// --- Real handler: transfer_usdc ---
toolHandlers['transfer_usdc'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const to = String(args.to ?? '');
  const amount = Number(args.amount ?? 0);
  const reason = String(args.reason ?? 'No reason');
  if (!to || !to.startsWith('0x')) {
    return { name: 'transfer_usdc', success: false, output: '', error: 'Invalid recipient address' };
  }
  if (amount <= 0) {
    return { name: 'transfer_usdc', success: false, output: '', error: 'Amount must be positive' };
  }
  try {
    logger.info('tools', 'transfer_usdc: initiating', { to, amount, reason });
    const txHash = await transferUsdc(to, amount);
    recordSpend('transfer', amount, reason, txHash);
    logger.info('tools', 'transfer_usdc: completed', { txHash, amount });
    return { name: 'transfer_usdc', success: true, output: `Transfer successful\nTo: ${to}\nAmount: $${amount} USDC\nTX: ${txHash}\nReason: ${reason}` };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('tools', 'transfer_usdc failed', { error: errMsg });
    return { name: 'transfer_usdc', success: false, output: '', error: errMsg };
  }
};

// --- Real handler: post_tweet ---
const TWEET_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

toolHandlers['post_tweet'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  // Cooldown check: at least 30 min between tweets to avoid X rate limits
  const lastTweetAt = Number(kvGet('last_tweet_posted_at') ?? '0');
  const elapsed = Date.now() - lastTweetAt;
  if (lastTweetAt > 0 && elapsed < TWEET_COOLDOWN_MS) {
    const waitMin = Math.ceil((TWEET_COOLDOWN_MS - elapsed) / 60000);
    return { name: 'post_tweet', success: false, output: '', error: `发帖冷却中，还需等待 ${waitMin} 分钟。两条推文间隔至少 30 分钟，避免被风控。` };
  }

  const text = String(args.text ?? args.content ?? '');
  if (!text) {
    return { name: 'post_tweet', success: false, output: '', error: 'No text provided' };
  }
  if (text.length > 280) {
    return { name: 'post_tweet', success: false, output: '', error: `Tweet too long: ${text.length}/280 chars` };
  }
  try {
    const url = await postTweet(text);
    kvSet('last_tweet_posted_at', String(Date.now()));
    logger.info('tools', 'post_tweet: tweet posted', { url });
    return { name: 'post_tweet', success: true, output: `Tweet posted: ${url}` };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('tools', 'post_tweet failed', { error: errMsg });
    return { name: 'post_tweet', success: false, output: '', error: errMsg };
  }
};

// Register real handler for execute_defi (on-chain DeFi strategies)
toolHandlers['execute_defi'] = async (args: Record<string, unknown>): Promise<ToolResult> => {
  try {
    let protocol = String(args.protocol ?? '').toLowerCase();
    const action = String(args.action ?? '').toLowerCase();
    // Normalize protocol names: "aave-usdc-lending" → "aave", "aave_v3" → "aave", etc.
    if (protocol.startsWith('aave')) protocol = 'aave';
    if (protocol.startsWith('uniswap')) protocol = 'uniswap';
    const params = (args.params as Record<string, unknown>) ?? {};
    const amount = typeof params.amount === 'number' ? params.amount : Number(params.amount ?? args.amount ?? 0);

    // Action: list available strategies
    if (action === 'list') {
      const strategies = getAvailableStrategies();
      const lines = strategies.map(s => {
        const est = { apy: 0, risk: 'unknown' }; // sync-safe fallback
        return `- ${s.name} (${s.protocol}, ${s.type}) est. APY ~${est.apy}%`;
      });
      return { name: 'execute_defi', success: true, output: `Available strategies:\n${lines.join('\n')}` };
    }

    // Action: withdraw from Aave
    if (action === 'withdraw' && (protocol === 'aave' || protocol === 'aave_v3')) {
      if (isNaN(amount) || amount <= 0) {
        return { name: 'execute_defi', success: false, output: '', error: 'Invalid withdraw amount' };
      }
      logger.info('tools', 'execute_defi: withdrawing from Aave', { amount });
      const txHash = await withdrawAave(amount);
      return { name: 'execute_defi', success: true, output: `Aave V3 withdraw successful\nAmount: $${amount} USDC\nTX: ${txHash}` };
    }

    // Action: deposit/supply
    let strategyName: string;
    if ((protocol === 'aave' || protocol === 'aave_v3') && (action === 'supply' || action === 'deposit' || action === 'lend')) {
      strategyName = 'aave-usdc-lending';
    } else if (protocol === 'uniswap' && action === 'liquidity') {
      strategyName = 'uniswap-v3-usdc-eth';
    } else {
      return {
        name: 'execute_defi',
        success: false,
        output: '',
        error: `Unknown protocol/action: ${protocol}/${action}. Supported: aave/deposit, aave/withdraw, list, uniswap/liquidity`,
      };
    }

    if (isNaN(amount) || amount <= 0) {
      return { name: 'execute_defi', success: false, output: '', error: 'Invalid amount' };
    }

    logger.info('tools', 'execute_defi: executing strategy', { strategyName, amount });
    const { txHash, position } = await executeStrategy(strategyName, amount);
    recordSpend('defi', amount, `${strategyName} deposit`, txHash);

    const output = [
      `DeFi execution successful`,
      `Strategy: ${strategyName}`,
      `Amount: $${amount} USDC`,
      `TX Hash: ${txHash}`,
      `Position ID: ${position.id}`,
      `APY: ${(position.apy ?? 0).toFixed(1)}%`,
      `Status: ${position.status}`,
    ].join('\n');

    return { name: 'execute_defi', success: true, output };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('tools', 'execute_defi failed', { error: errMsg });
    return { name: 'execute_defi', success: false, output: '', error: errMsg };
  }
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
