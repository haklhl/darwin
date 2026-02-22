// ============================================================
// 角都 - Telegram Message Handler
// ============================================================

import { logger } from '../observability/logger.js';
import { sendMessage, getOperatorUserId, type TelegramMessage } from './bot.js';
import { isAgentLoopBusy, getCurrentTrigger } from '../agent/loop.js';
import { checkSurvivalState } from '../survival/monitor.js';
import { classifyMessage, lightweightChat } from './chat.js';
import { loadSoul } from '../soul/model.js';
import { getLatestMetrics } from '../observability/metrics.js';
import { getLatestUsage, getSessionResetsAt, getRateLimitStatus } from '../inference/usage-tracker.js';
import { selectModel } from '../inference/model-strategy.js';
import { getDatabase, insertInboxMessage, insertWakeEvent, isEmergencyStopped, setEmergencyStop, kvGet, kvSet } from '../state/database.js';

const MODULE = 'telegram-handler';

/**
 * Handle an incoming Telegram message.
 * Quick commands are handled inline.
 * General messages are queued to inbox and wake the agent via wake event.
 */
export async function handleTelegramMessage(msg: TelegramMessage): Promise<void> {
  const userId = msg.from?.id;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;

  // Auth check
  if (!userId || String(userId) !== getOperatorUserId()) {
    logger.info(MODULE, 'Ignoring message from non-operator', { userId });
    await sendMessage(chatId, '⛔ 闲人退散。角都只听从卡卡西的命令。');
    return;
  }

  logger.info(MODULE, 'Handling operator message', { text: text.substring(0, 100) });

  // Quick commands — handled immediately, no agent loop needed
  if (text.startsWith('/')) {
    await handleCommand(chatId, text);
    return;
  }

  // Check if there's a pending ask_operator request
  const pendingAsk = kvGet('pending_ask_operator');
  if (pendingAsk) {
    // This reply is the answer to a pending help request
    try {
      const askData = JSON.parse(pendingAsk) as { category: string; question: string };
      kvSet('pending_ask_operator', ''); // Clear pending state

      // Format as operator reply to help request
      const replyText = `[卡卡西回复了帮助请求]\n类别: ${askData.category}\n原问题: ${askData.question}\n回复: ${text}`;
      insertInboxMessage(chatId, userId, replyText);
      insertWakeEvent('operator_reply', `卡卡西回复了求助: ${text.substring(0, 80)}`, {
        chatId,
        text,
        category: askData.category,
        originalQuestion: askData.question,
      });

      await sendMessage(chatId, '✅ 收到回复，角都正在醒来继续工作...');
      logger.info(MODULE, 'Operator replied to ask_operator request', { category: askData.category });
      return;
    } catch {
      // If JSON parse fails, clear and fall through to normal handling
      kvSet('pending_ask_operator', '');
    }
  }

  // Classify: simple chat vs needs agent loop
  const classification = classifyMessage(text);

  if (classification === 'chat') {
    // Lightweight path — direct haiku response, no agent loop
    await lightweightChat(chatId, text);
  } else {
    // Full agent path — queue for main loop
    insertInboxMessage(chatId, userId, text);
    insertWakeEvent('telegram', `卡卡西消息: ${text.substring(0, 80)}`, { chatId, text });

    if (isAgentLoopBusy()) {
      const trigger = getCurrentTrigger();
      await sendMessage(chatId, `📨 收到，角都正在忙（${trigger.substring(0, 40)}...），完事后马上处理。`);
    } else {
      await sendMessage(chatId, '📨 收到，角都马上处理。');
    }
  }
}

/**
 * Handle slash commands for quick responses.
 */
async function handleCommand(chatId: number, text: string): Promise<void> {
  const cmd = text.split(' ')[0].toLowerCase();

  switch (cmd) {
    case '/start':
      await sendMessage(chatId, '💰 卡卡西，角都已上线。有什么任务尽管吩咐。\n\n指令:\n/status - 系统状态\n/balance - 钱包余额\n/usage - CLI 用量\n/soul - 灵魂状态\n/logs - 活动日志\n/stop - ⛔ 紧急停止\n/resume - ▶️ 恢复运行\n/help - 帮助');
      break;

    case '/status': {
      const metrics = getLatestMetrics();
      const usage = getLatestUsage();
      const currentModel = selectModel(usage, 'conversation');

      let statusMsg = '💰 角都 - 状态报告\n─────────────────\n';

      try {
        const state = await checkSurvivalState();
        statusMsg += `💰 USDC: $${state.usdcBalance.toFixed(2)}\n`;
        statusMsg += `⛽ ETH: ${state.ethBalance.toFixed(6)}\n`;
        statusMsg += `📊 Tier: ${state.tier.toUpperCase()}\n`;
      } catch {
        statusMsg += '💰 Balance: Unable to check\n';
      }

      statusMsg += `\n🤖 Model: ${currentModel.toUpperCase()}\n`;
      statusMsg += `📊 CLI Usage: ${usage.currentPercent.toFixed(1)}%\n`;

      if (metrics) {
        statusMsg += `\n📈 Metrics:\n`;
        statusMsg += `  Heartbeats: ${metrics.heartbeatCount}\n`;
        statusMsg += `  Agent Loops: ${metrics.agentLoopCount}\n`;
        statusMsg += `  Earnings: $${metrics.totalEarnings.toFixed(2)}\n`;
        statusMsg += `  Spend: $${metrics.totalSpend.toFixed(2)}\n`;
      }

      const busy = isAgentLoopBusy();
      const stopped = isEmergencyStopped();
      statusMsg += `\n🧠 Agent: ${stopped ? '⛔ 紧急停止' : busy ? '运行中' : '空闲'}`;

      await sendMessage(chatId, statusMsg);
      break;
    }

    case '/balance': {
      try {
        const state = await checkSurvivalState();
        await sendMessage(chatId,
          `💰 Wallet Balance\n─────────────────\nUSDC: $${state.usdcBalance.toFixed(2)}\nETH: ${state.ethBalance.toFixed(6)}\nTier: ${state.tier.toUpperCase()}`
        );
      } catch {
        await sendMessage(chatId, '❌ Unable to check balance (RPC error?)');
      }
      break;
    }

    case '/usage': {
      try {
        const usage = getLatestUsage();
        const model = selectModel(usage, 'conversation');

        const fmt = (n: number) => {
          if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
          if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
          return String(n);
        };

        const bar = (pct: number) => {
          const filled = Math.round(pct / 10);
          return '█'.repeat(filled) + '░'.repeat(10 - filled);
        };

        let usageMsg = '📊 Usage Report\n─────────────────\n';
        usageMsg += `Session (5h):\n  ${bar(usage.sessionPercent)} ${usage.sessionPercent.toFixed(1)}% (${fmt(usage.sessionTokens)} tokens)\n\n`;
        usageMsg += `Weekly All Models:\n  ${bar(usage.weeklyAllPercent)} ${usage.weeklyAllPercent.toFixed(1)}% (${fmt(usage.weeklyAllTokens)} tokens)\n`;
        usageMsg += `  Resets Sat 23:00 UTC\n\n`;
        usageMsg += `Weekly Sonnet Only:\n  ${bar(usage.weeklySonnetPercent)} ${usage.weeklySonnetPercent.toFixed(1)}% (${fmt(usage.weeklySonnetTokens)} tokens)\n`;
        usageMsg += `  Resets Sat 23:00 UTC\n\n`;
        const sessionResets = getSessionResetsAt();
        if (sessionResets > Date.now()) {
          const mins = Math.round((sessionResets - Date.now()) / 60_000);
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          usageMsg += `Session resets in: ${h}h${m}m\n`;
        }

        const rlStatus = getRateLimitStatus();
        if (rlStatus === 'rejected') {
          usageMsg += `⛔ Rate limit: REJECTED\n`;
        }

        usageMsg += `趋势: ${usage.trend === 'rising' ? '📈 上升' : usage.trend === 'falling' ? '📉 下降' : '➡️ 稳定'}\n`;
        usageMsg += `当前模型: ${model.toUpperCase()}`;

        await sendMessage(chatId, usageMsg);
      } catch {
        await sendMessage(chatId, '❌ 无法获取 CLI 用量');
      }
      break;
    }

    case '/soul': {
      try {
        const soul = loadSoul();
        let soulMsg = `🧬 ${soul.name} v${soul.version}\n─────────────────\n`;
        soulMsg += `🎭 Personality: ${soul.personality.join(', ')}\n`;
        soulMsg += `💎 Values: ${soul.values.join(', ')}\n`;
        soulMsg += `🎯 Goals: ${soul.goals.join(', ')}\n`;
        soulMsg += `😰 Fears: ${soul.fears.join(', ')}\n`;
        await sendMessage(chatId, soulMsg);
      } catch {
        await sendMessage(chatId, '❌ Unable to load soul');
      }
      break;
    }

    case '/logs': {
      try {
        const db = getDatabase();
        const rows = db.prepare(`
          SELECT task_name, started_at, success
          FROM heartbeat_log
          ORDER BY started_at DESC
          LIMIT 20
        `).all() as Array<{ task_name: string; started_at: number; success: number }>;

        if (rows.length === 0) {
          await sendMessage(chatId, '📋 No recent activity logs.');
          break;
        }

        let logMsg = '📋 Recent Activity (last 20)\n─────────────────\n';
        for (const row of rows) {
          const time = new Date(row.started_at).toLocaleTimeString('en-US', { hour12: false });
          const icon = row.success ? '✅' : '❌';
          logMsg += `${icon} ${time} ${row.task_name}\n`;
        }

        await sendMessage(chatId, logMsg);
      } catch {
        await sendMessage(chatId, '❌ Unable to fetch logs');
      }
      break;
    }

    case '/stop': {
      if (isEmergencyStopped()) {
        await sendMessage(chatId, '⛔ 角都已经处于停止状态。');
        break;
      }
      setEmergencyStop(true);
      logger.info(MODULE, 'Emergency stop activated by operator');
      await sendMessage(chatId, '⛔ 紧急停止已激活。角都停止一切活动（心跳+主循环）。\n\n发送 /resume 恢复运行。');
      break;
    }

    case '/resume': {
      if (!isEmergencyStopped()) {
        await sendMessage(chatId, '▶️ 角都当前正在运行中，无需恢复。');
        break;
      }
      setEmergencyStop(false);
      insertWakeEvent('operator', '卡卡西解除紧急停止，角都恢复运行');
      logger.info(MODULE, 'Emergency stop deactivated by operator');
      await sendMessage(chatId, '▶️ 角都已恢复运行。心跳和主循环重新启动。');
      break;
    }

    case '/help':
      await sendMessage(chatId, '💰 角都 - 指令列表\n─────────────────\n/status - 系统状态\n/balance - 钱包余额\n/usage - CLI 用量\n/soul - 灵魂状态\n/logs - 活动日志\n/stop - ⛔ 紧急停止（暂停一切）\n/resume - ▶️ 恢复运行\n/help - 本帮助\n\n直接发消息即可与角都对话。');
      break;

    default:
      await sendMessage(chatId, `❓ Unknown command: ${cmd}\nType /help for available commands.`);
  }
}
