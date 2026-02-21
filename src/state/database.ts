// ============================================================
// Darwin - Database Helper Functions
// ============================================================

import Database from 'better-sqlite3';
import { getDbPath } from '../config.js';
import { applySchema } from './schema.js';
import { logger } from '../observability/logger.js';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  logger.info('database', `Opening database at ${dbPath}`);

  db = new Database(dbPath);
  applySchema(db);

  logger.info('database', 'Database initialized with schema');
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('database', 'Database closed');
  }
}

// --- Helper functions ---

export function kvGet(key: string): string | null {
  const row = getDatabase().prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(key: string, value: string): void {
  getDatabase().prepare(`
    INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, Date.now());
}

export function kvGetNumber(key: string): number | null {
  const val = kvGet(key);
  return val !== null ? Number(val) : null;
}

export function kvSetNumber(key: string, value: number): void {
  kvSet(key, String(value));
}

// --- Emergency Stop ---

export function isEmergencyStopped(): boolean {
  return kvGet('emergency_stop') === '1';
}

export function setEmergencyStop(stopped: boolean): void {
  kvSet('emergency_stop', stopped ? '1' : '0');
}

export function recordSpend(category: string, amount: number, description: string, txHash?: string): void {
  getDatabase().prepare(`
    INSERT INTO spend_tracking (category, amount, currency, tx_hash, description, timestamp)
    VALUES (?, ?, 'USDC', ?, ?, ?)
  `).run(category, amount, txHash ?? null, description, Date.now());
}

export function getRecentSpend(hours: number = 24): number {
  const since = Date.now() - hours * 3600_000;
  const row = getDatabase().prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM spend_tracking WHERE timestamp > ?
  `).get(since) as { total: number };
  return row.total;
}

export function recordEarning(
  source: string,
  amount: number,
  description: string,
  txHash?: string,
): void {
  getDatabase().prepare(`
    INSERT INTO earnings_log (source, amount, currency, tx_hash, description, timestamp)
    VALUES (?, ?, 'USDC', ?, ?, ?)
  `).run(source, amount, txHash ?? null, description, Date.now());
}

export function getTotalEarnings(): number {
  const row = getDatabase().prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM earnings_log
  `).get() as { total: number };
  return row.total;
}

export function getTotalSpend(): number {
  const row = getDatabase().prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM spend_tracking
  `).get() as { total: number };
  return row.total;
}

// --- Wake Events ---

export interface WakeEventRow {
  id: number;
  source: string;
  reason: string;
  payload: string;
  consumedAt: number | null;
  createdAt: number;
}

export function insertWakeEvent(source: string, reason: string, payload?: object): void {
  getDatabase().prepare(
    'INSERT INTO wake_events (source, reason, payload, created_at) VALUES (?, ?, ?, ?)',
  ).run(source, reason, JSON.stringify(payload ?? {}), Date.now());
}

export function consumeNextWakeEvent(): WakeEventRow | undefined {
  const row = getDatabase().prepare(`
    UPDATE wake_events
    SET consumed_at = ?
    WHERE id = (SELECT id FROM wake_events WHERE consumed_at IS NULL ORDER BY id ASC LIMIT 1)
    RETURNING *
  `).get(Date.now()) as Record<string, unknown> | undefined;

  if (!row) return undefined;
  return {
    id: row.id as number,
    source: row.source as string,
    reason: row.reason as string,
    payload: (row.payload as string) ?? '{}',
    consumedAt: row.consumed_at as number | null,
    createdAt: row.created_at as number,
  };
}

export function drainWakeEvents(): number {
  let count = 0;
  while (consumeNextWakeEvent()) count++;
  return count;
}

// --- Agent State ---

export type AgentState = 'running' | 'sleeping' | 'dead';

export function getAgentState(): AgentState {
  return (kvGet('agent_state') as AgentState) ?? 'running';
}

export function setAgentState(state: AgentState): void {
  kvSet('agent_state', state);
}

export function getSleepUntil(): number | null {
  return kvGetNumber('sleep_until');
}

export function setSleepUntil(timestamp: number): void {
  kvSetNumber('sleep_until', timestamp);
}

export function clearSleep(): void {
  kvSet('sleep_until', '0');
  setAgentState('running');
}

// --- Telegram Inbox ---

export function insertInboxMessage(chatId: number, userId: number, text: string): void {
  getDatabase().prepare(
    'INSERT INTO telegram_inbox (chat_id, user_id, text, processed, created_at) VALUES (?, ?, ?, 0, ?)',
  ).run(chatId, userId, text, Date.now());
}

export function getUnprocessedMessages(): Array<{ id: number; chatId: number; userId: number; text: string; createdAt: number }> {
  const rows = getDatabase().prepare(
    'SELECT id, chat_id, user_id, text, created_at FROM telegram_inbox WHERE processed = 0 ORDER BY created_at ASC LIMIT 10',
  ).all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as number,
    chatId: r.chat_id as number,
    userId: r.user_id as number,
    text: r.text as string,
    createdAt: r.created_at as number,
  }));
}

export function markMessagesProcessed(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  getDatabase().prepare(
    `UPDATE telegram_inbox SET processed = 1 WHERE id IN (${placeholders})`,
  ).run(...ids);
}
