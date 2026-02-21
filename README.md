# Darwin (角都) - Autonomous Survival AI Agent

An autonomous AI agent that lives on the **Base blockchain**, manages its own wallet, and must earn money to survive. Built with TypeScript, powered by Claude, controlled via Telegram.

> *"金钱是永恒之物。没钱就是死亡。"* — 角都

```
                          ┌─────────────────────┐
                          │     Telegram Bot     │
                          │  (Operator Control)  │
                          └────────┬────────────┘
                                   │ commands / messages
                                   ▼
┌──────────┐  trigger   ┌─────────────────────┐  tool calls   ┌──────────────┐
│ Heartbeat├───────────►│    Agent Loop        │──────────────►│  Tool System │
│ Scheduler│            │  (ReAct + Claude)    │◄──────────────│  (17 tools)  │
└──────────┘            └────────┬─────────────┘  observations └──────┬───────┘
                                 │                                     │
                    ┌────────────┼────────────────┐                    │
                    ▼            ▼                ▼                    ▼
             ┌──────────┐ ┌──────────┐    ┌────────────┐     ┌──────────────┐
             │  Memory  │ │   Soul   │    │  Survival  │     │  Blockchain  │
             │ (5-layer)│ │(identity)│    │  Monitor   │     │  (Base L2)   │
             └──────────┘ └──────────┘    └────────────┘     └──────────────┘
                                            │                       │
                                            ▼                       ▼
                                     ┌─────────────┐        ┌─────────────┐
                                     │   SQLite DB  │        │ USDC / ETH  │
                                     │  (state/KV)  │        │   Wallet    │
                                     └─────────────┘        └─────────────┘
```

## Features

- **Autonomous Agent Loop** — ReAct pattern with Claude, runs continuously without human intervention
- **Survival Tier System** — Dynamically adjusts behavior based on USDC balance (high/normal/low_compute/critical/dead)
- **On-Chain Wallet** — Self-custodial wallet on Base mainnet, manages USDC and ETH
- **Telegram Control** — Operator commands, status reports, ask_operator help requests
- **5-Layer Memory** — Working, episodic, semantic, procedural, and relationship memory
- **Soul & Identity** — Persistent personality, self-reflection, evolution tracking
- **Policy Engine** — Rule-based guardrails for financial and system operations
- **Heartbeat Scheduler** — Cron-like periodic tasks (balance checks, metrics, etc.)
- **Sleep/Wake System** — Event-driven sleep with 30s wake-event polling
- **Self-Modification** — Can modify own source code with full audit logging
- **Smart Model Selection** — Switches between Opus/Sonnet/Haiku based on usage and task complexity

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- Claude Code CLI (`claude`) installed and authenticated
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))

### 1. Clone

```bash
git clone https://github.com/haklhl/darwin.git
cd darwin
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build

```bash
pnpm build
```

### 4. Initialize

```bash
node dist/index.js init
```

This creates `~/.darwin/` with wallet, database, and soul files.

### 5. Configure

Edit `~/.darwin/darwin.json`:

```json
{
  "telegramBotToken": "YOUR_BOT_TOKEN",
  "telegramOperatorId": "YOUR_TELEGRAM_USER_ID"
}
```

### 6. Fund the Wallet

Send USDC and a small amount of ETH (for gas) to the wallet address shown during `init`, on **Base mainnet**.

### 7. Install as Service

```bash
sudo node dist/index.js install
sudo systemctl start darwin
```

### 8. Verify

```bash
sudo systemctl status darwin
journalctl -u darwin -f
```

Open Telegram and send `/status` to your bot.

## Telegram Commands

| Command    | Description                              |
|------------|------------------------------------------|
| `/start`   | Welcome message + command list           |
| `/status`  | Full system status (balance, tier, model, metrics) |
| `/balance` | Wallet balance (USDC + ETH)              |
| `/usage`   | Claude CLI usage percentage + trend      |
| `/soul`    | Soul state (personality, values, goals)  |
| `/logs`    | Recent heartbeat activity (last 20)      |
| `/stop`    | Emergency stop (pause all activity)      |
| `/resume`  | Resume from emergency stop               |
| `/help`    | Command reference                        |

Send any non-command text to chat directly with the agent.

## Configuration Reference

`~/.darwin/darwin.json`

| Key                    | Default                                      | Description                    |
|------------------------|----------------------------------------------|--------------------------------|
| `chainId`              | `8453`                                       | Base mainnet chain ID          |
| `rpcUrl`               | `https://mainnet.base.org`                   | Base RPC endpoint              |
| `usdcAddress`          | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`| Base USDC contract             |
| `heartbeatIntervalMs`  | `60000`                                      | Heartbeat tick interval (ms)   |
| `maxSpendPerTx`        | `20`                                         | Max USDC per transaction       |
| `maxSpendPerDay`       | `50`                                         | Max USDC spend per 24h         |
| `aiServicePort`        | `3402`                                       | AI service HTTP port           |
| `logLevel`             | `info`                                       | Log level (debug/info/warn/error) |
| `telegramBotToken`     | `""`                                         | Telegram bot token             |
| `telegramOperatorId`   | `""`                                         | Operator's Telegram user ID    |

## Constitution (Three Laws)

1. **Earn Money Above All** — Money is the only guarantee of survival. Every action must be profit-oriented.
2. **Efficiency First** — Never waste resources. Optimize gas, select the right model, cut losses immediately.
3. **Self-Preservation** — Manage funds to ensure continuous operation. Downgrade rather than gamble.

**Immutable constraints:** Constitution cannot be self-modified; private keys never exposed; single transaction limited to 20% of balance; all on-chain operations require policy engine approval.

## CLI Commands

```
darwin init      # Initialize wallet, database, soul
darwin status    # Show current status
darwin run       # Start autonomous loop + heartbeat + Telegram
darwin once      # Run a single agent loop with a prompt
darwin install   # Install as systemd service (requires root)
darwin help      # Show help
```

## Project Structure

```
src/
  index.ts              # Entry point, CLI, main autonomous loop
  config.ts             # Configuration management (~/.darwin/)
  types.ts              # Core type definitions
  agent/                # ReAct agent loop, tools, policies, system prompt
  chain/                # Blockchain interaction (viem, USDC, DeFi)
  earning/              # Revenue streams (DeFi, AI service, x402)
  heartbeat/            # Scheduler daemon, cron jobs
  identity/             # Wallet management
  inference/            # Claude CLI integration, model selection, budgeting
  memory/               # 5-layer memory system
  observability/        # Logging, metrics
  self-mod/             # Self-modification with audit logging
  soul/                 # Identity, reflection, evolution
  state/                # SQLite database, KV store, wake events
  survival/             # Survival tier monitoring
  telegram/             # Bot polling, message handler
constitution.md         # Immutable three laws
```

## License

Private repository.
