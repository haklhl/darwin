// ============================================================
// Darwin - SQLite Schema + Migrations
// ============================================================

import type Database from 'better-sqlite3';

export function applySchema(db: Database.Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Agent conversation history
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      steps_count INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );

    -- Agent steps within conversations
    CREATE TABLE IF NOT EXISTS agent_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER REFERENCES conversations(id),
      step_index INTEGER NOT NULL,
      thought TEXT,
      tool_name TEXT,
      tool_args TEXT,
      observation TEXT,
      timestamp INTEGER NOT NULL
    );

    -- Heartbeat scheduled jobs
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_name TEXT NOT NULL UNIQUE,
      cron_expression TEXT NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER NOT NULL,
      enabled INTEGER DEFAULT 1,
      run_count INTEGER DEFAULT 0,
      last_error TEXT
    );

    -- Heartbeat execution log
    CREATE TABLE IF NOT EXISTS heartbeat_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      success INTEGER,
      error TEXT,
      duration_ms INTEGER
    );

    -- Memory entries (5-layer memory system)
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      layer TEXT NOT NULL CHECK(layer IN ('working', 'episodic', 'semantic', 'procedural', 'relationship')),
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      importance REAL DEFAULT 0.5,
      access_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER,
      embedding_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

    -- Spend tracking
    CREATE TABLE IF NOT EXISTS spend_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USDC',
      tx_hash TEXT,
      description TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spend_timestamp ON spend_tracking(timestamp);

    -- DeFi positions
    CREATE TABLE IF NOT EXISTS defi_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocol TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('liquidity', 'lending', 'staking')),
      token_a TEXT NOT NULL,
      token_b TEXT,
      amount_a REAL NOT NULL,
      amount_b REAL,
      entry_price REAL,
      current_value REAL NOT NULL,
      apy REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed'))
    );

    -- AI service request log
    CREATE TABLE IF NOT EXISTS service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_type TEXT NOT NULL,
      client_address TEXT,
      payment_amount REAL,
      payment_tx TEXT,
      request_data TEXT,
      response_data TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    -- Earnings log
    CREATE TABLE IF NOT EXISTS earnings_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL CHECK(source IN ('defi_yield', 'defi_trade', 'ai_service', 'x402', 'donation')),
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USDC',
      tx_hash TEXT,
      description TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_earnings_timestamp ON earnings_log(timestamp);

    -- Usage snapshots (Claude CLI usage tracking)
    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      percent REAL NOT NULL,
      model TEXT,
      raw_output TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_snapshots(timestamp);

    -- Soul evolution log
    CREATE TABLE IF NOT EXISTS soul_evolution (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT NOT NULL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- Self-modification audit log
    CREATE TABLE IF NOT EXISTS self_mod_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      diff TEXT NOT NULL,
      reason TEXT NOT NULL,
      approved INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL
    );

    -- Policy decisions log
    CREATE TABLE IF NOT EXISTS policy_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('allow', 'deny', 'ask')),
      rule TEXT NOT NULL,
      reason TEXT,
      context TEXT,
      timestamp INTEGER NOT NULL
    );

    -- Metric snapshots
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      usdc_balance REAL,
      eth_balance REAL,
      survival_tier TEXT,
      heartbeat_count INTEGER,
      agent_loop_count INTEGER,
      total_earnings REAL,
      total_spend REAL,
      memory_entries INTEGER,
      usage_percent REAL,
      active_model TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metric_snapshots(timestamp);

    -- Key-value store for misc state
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Relationship trust scores
    CREATE TABLE IF NOT EXISTS trust_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL UNIQUE,
      score REAL DEFAULT 0.5,
      interactions INTEGER DEFAULT 0,
      last_interaction INTEGER,
      notes TEXT
    );
  `);

  // Record migration v1
  const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
  if (!existing) {
    db.prepare('INSERT INTO schema_migrations (version) VALUES (1)').run();
  }

  // Migration v2: Wake events + Telegram inbox
  applyMigrationV2(db);

  // Migration v3: Chat history for lightweight Telegram chat
  applyMigrationV3(db);
}

function applyMigrationV2(db: Database.Database): void {
  const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = 2').get();
  if (existing) return;

  db.exec(`
    -- Wake events for autonomous wake/sleep cycle
    CREATE TABLE IF NOT EXISTS wake_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wake_unconsumed
      ON wake_events(created_at) WHERE consumed_at IS NULL;

    -- Telegram inbox for async message processing
    CREATE TABLE IF NOT EXISTS telegram_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      processed INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
      ON telegram_inbox(created_at) WHERE processed = 0;
  `);

  db.prepare('INSERT INTO schema_migrations (version) VALUES (2)').run();
}

function applyMigrationV3(db: Database.Database): void {
  const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = 3').get();
  if (existing) return;

  db.exec(`
    -- Chat history for lightweight Telegram chat (方案B)
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_history_time ON chat_history(created_at DESC);
  `);

  db.prepare('INSERT INTO schema_migrations (version) VALUES (3)').run();
}
