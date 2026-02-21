// ============================================================
// Darwin - Telegram Bot (Pure HTTP, no dependencies)
// ============================================================

import { logger } from '../observability/logger.js';

const MODULE = 'telegram-bot';
const API_BASE = 'https://api.telegram.org/bot';

let botToken = '';
let operatorUserId = '';
let pollingActive = false;
let pollingOffset = 0;
let pollingAbortController: AbortController | null = null;

type MessageCallback = (msg: TelegramMessage) => void;
const messageCallbacks: MessageCallback[] = [];

// --- Telegram Types ---

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

// --- Init ---

export function initTelegramBot(token: string, operatorId: string): void {
  botToken = token;
  operatorUserId = operatorId;
  logger.info(MODULE, 'Telegram bot initialized', { operatorId });
}

export function getOperatorUserId(): string {
  return operatorUserId;
}

// --- Send Message ---

export async function sendMessage(chatId: string | number, text: string, parseMode?: string): Promise<boolean> {
  if (!botToken) {
    logger.warn(MODULE, 'Bot token not set, cannot send message');
    return false;
  }

  // Telegram message limit is 4096 chars
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: chunk,
      };
      if (parseMode) {
        body.parse_mode = parseMode;
      }

      const res = await fetch(`${API_BASE}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as TelegramApiResponse;

      if (!data.ok) {
        logger.error(MODULE, 'Failed to send message', { error: data.description });
        return false;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(MODULE, 'Error sending message', { error: msg });
      return false;
    }
  }

  return true;
}

/** Send "typing..." chat action indicator. */
export async function sendChatAction(chatId: string | number, action: string = 'typing'): Promise<void> {
  if (!botToken) return;
  try {
    await fetch(`${API_BASE}${botToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // Non-critical, silently ignore
  }
}

/** Keep sending "typing..." every 4 seconds until cancelled. Returns a stop function. */
export function startTypingIndicator(chatId: string | number): () => void {
  sendChatAction(chatId, 'typing');
  const interval = setInterval(() => {
    sendChatAction(chatId, 'typing');
  }, 4000);
  return () => clearInterval(interval);
}

/** Register bot commands menu in Telegram. */
export async function registerCommands(): Promise<void> {
  if (!botToken) return;
  const commands = [
    { command: 'start', description: '开始 / 欢迎信息' },
    { command: 'status', description: '系统状态概览' },
    { command: 'balance', description: '查看钱包余额' },
    { command: 'usage', description: '查看 CLI 用量' },
    { command: 'soul', description: '查看灵魂状态' },
    { command: 'logs', description: '最近活动日志' },
    { command: 'stop', description: '⛔ 紧急停止' },
    { command: 'resume', description: '▶️ 恢复运行' },
    { command: 'help', description: '帮助信息' },
  ];
  try {
    const res = await fetch(`${API_BASE}${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    const data = (await res.json()) as TelegramApiResponse;
    if (data.ok) {
      logger.info(MODULE, 'Bot commands registered');
    } else {
      logger.error(MODULE, 'Failed to register commands', { error: data.description });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(MODULE, 'Error registering commands', { error: msg });
  }
}

/** Send message to the operator. */
export async function sendToOperator(text: string, parseMode?: string): Promise<boolean> {
  if (!operatorUserId) {
    logger.warn(MODULE, 'Operator user ID not set');
    return false;
  }
  return sendMessage(operatorUserId, text, parseMode);
}

// --- Long Polling ---

export function startPolling(): void {
  if (pollingActive) {
    logger.warn(MODULE, 'Polling already active');
    return;
  }

  pollingActive = true;
  logger.info(MODULE, 'Starting long polling');
  pollLoop();
}

export function stopPolling(): void {
  pollingActive = false;
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
  logger.info(MODULE, 'Polling stopped');
}

async function pollLoop(): Promise<void> {
  while (pollingActive) {
    try {
      pollingAbortController = new AbortController();
      const url = `${API_BASE}${botToken}/getUpdates?offset=${pollingOffset}&timeout=30&allowed_updates=["message"]`;

      const res = await fetch(url, {
        signal: pollingAbortController.signal,
      });

      const data = (await res.json()) as TelegramApiResponse<TelegramUpdate[]>;

      if (data.ok && data.result && data.result.length > 0) {
        for (const update of data.result) {
          pollingOffset = update.update_id + 1;

          if (update.message) {
            logger.debug(MODULE, 'Received message', {
              from: update.message.from?.id,
              text: update.message.text?.substring(0, 50),
            });

            for (const cb of messageCallbacks) {
              try {
                cb(update.message);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(MODULE, 'Error in message callback', { error: msg });
              }
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        break;
      }
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(MODULE, 'Polling error, retrying in 5s', { error: msg });
      await sleep(5000);
    }
  }
}

// --- Callbacks ---

export function onMessage(callback: MessageCallback): void {
  messageCallbacks.push(callback);
}

// --- Helpers ---

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at newline
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
