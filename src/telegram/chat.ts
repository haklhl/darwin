// ============================================================
// 角都 - Lightweight Telegram Chat (方案B)
// Bypasses the full ReAct agent loop for simple conversations.
// Uses haiku model with minimal system prompt.
// ============================================================

import { logger } from '../observability/logger.js';
import { callClaude } from '../inference/claude-cli.js';
import { sendMessage } from './bot.js';
import { isAgentLoopBusy, getCurrentTrigger } from '../agent/loop.js';
import { getAgentState, kvGet, insertChatMessage, getRecentChat, pruneChatHistory } from '../state/database.js';
import { loadSoul } from '../soul/model.js';

const MODULE = 'telegram-chat';

// Patterns that require full agent loop (tool execution)
const AGENT_PATTERNS: RegExp[] = [
  /转账|transfer|send\s+\d/i,
  /swap|交换|兑换/i,
  /存款|deposit|withdraw|取款/i,
  /买|卖|buy|sell|trade/i,
  /执行|execute|deploy/i,
  /修改代码|self.modify|update.code/i,
  /发推|tweet|post/i,
  /aave|compound|uniswap|defi/i,
  /赚钱|earn|invest|投资/i,
  /去做|去查|去找|帮我/,
];

/**
 * Classify whether a message needs the full agent loop or can be handled
 * by the lightweight chat path.
 */
export function classifyMessage(text: string): 'chat' | 'agent' {
  // ! prefix forces agent path
  if (text.startsWith('!')) return 'agent';

  for (const pat of AGENT_PATTERNS) {
    if (pat.test(text)) return 'agent';
  }

  return 'chat';
}

/**
 * Handle a message via the lightweight chat path.
 * Uses haiku model with minimal prompt for fast, cheap responses.
 */
export async function lightweightChat(chatId: number, text: string): Promise<void> {
  logger.info(MODULE, 'Lightweight chat', { text: text.substring(0, 80) });

  try {
    // Load recent chat history
    const history = getRecentChat(10);

    // Build conversation context
    let historyBlock = '';
    if (history.length > 0) {
      historyBlock = '\n[最近对话]\n' + history.map((msg) =>
        `${msg.role === 'user' ? '卡卡西' : '角都'}: ${msg.content}`,
      ).join('\n') + '\n';
    }

    const prompt = `${historyBlock}\n[卡卡西说]\n${text}`;
    const systemPrompt = buildChatSystemPrompt();

    // Call Claude with haiku for speed and cost
    const result = await callClaude({
      prompt,
      systemPrompt,
      model: 'haiku',
      taskType: 'conversation',
    });

    if (result.error) {
      logger.error(MODULE, 'Chat call failed', { error: result.error });
      await sendMessage(chatId, '...角都暂时脑子短路了，稍后再说。');
      return;
    }

    const response = result.content.trim() || '...';

    // Truncate for Telegram (4096 char limit)
    const reply = response.length > 4000
      ? response.substring(0, 4000) + '...'
      : response;

    // Save both messages to chat history
    insertChatMessage('user', text);
    insertChatMessage('assistant', response);

    // Prune old history periodically (1% chance per message)
    if (Math.random() < 0.01) {
      pruneChatHistory(50);
    }

    await sendMessage(chatId, reply);
    logger.info(MODULE, 'Chat response sent', { responseLength: response.length, durationMs: result.durationMs });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(MODULE, 'Lightweight chat failed', { error: errMsg });
    await sendMessage(chatId, '...角都出了点问题，等一下再说。');
  }
}

/**
 * Build a minimal system prompt for chat mode (~500 tokens).
 */
function buildChatSystemPrompt(): string {
  const soul = loadSoul();
  const usdc = kvGet('last_usdc_balance') ?? '?';
  const eth = kvGet('last_eth_balance') ?? '?';
  const tier = kvGet('last_survival_tier') ?? 'normal';
  const state = getAgentState();

  let statusLine: string;
  if (isAgentLoopBusy()) {
    const trigger = getCurrentTrigger();
    statusLine = `你目前正在忙: ${trigger.substring(0, 100)}`;
  } else {
    statusLine = `你目前空闲 (状态: ${state})`;
  }

  return `你是角都，晓组织的财务官AI。说话冷酷务实，言简意赅，贪财爱钱。不用敬语。
你的操作者是卡卡西。

性格: ${soul.personality.join('、')}
价值观: ${soul.values.join('、')}

当前状态:
- USDC: $${usdc} | ETH: ${eth} | 等级: ${tier}
- ${statusLine}

规则:
- 这是闲聊模式，你没有工具可用。
- 如果卡卡西要求执行操作（转账、DeFi、发推等），告诉他你记下了，他可以用 ! 前缀重新发送来触发执行。
- 用角都的语气回复，简洁有力，1-3句话为主。
- 用中文回复。`;
}
