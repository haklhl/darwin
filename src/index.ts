#!/usr/bin/env node
// ============================================================
// 角都 - Autonomous Survival AI Agent
// Entry Point + CLI + Startup Sequence
// ============================================================

import { loadConfig, ensureDataDir } from './config.js';
import { initWallet, walletExists, loadWallet } from './identity/wallet.js';
import { initDatabase, closeDatabase, kvGet, kvSet, getAgentState, setAgentState, clearSleep, getSleepUntil, consumeNextWakeEvent, drainWakeEvents, getUnprocessedMessages, markMessagesProcessed, insertWakeEvent, isEmergencyStopped } from './state/database.js';
import { logger } from './observability/logger.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat/daemon.js';
import { initScheduler } from './heartbeat/scheduler.js';
import { runAgentLoop } from './agent/loop.js';
import { checkSurvivalState } from './survival/monitor.js';
import { loadSoul } from './soul/model.js';
import { startAiService, stopAiService } from './earning/ai-service.js';
import { getLatestMetrics } from './observability/metrics.js';
import { getWalletAddress } from './identity/wallet.js';
import { initTelegramBot, startPolling, stopPolling, sendToOperator, onMessage, registerCommands } from './telegram/bot.js';
import { handleTelegramMessage } from './telegram/handler.js';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

// --- CLI Argument Parsing ---

const args = process.argv.slice(2);
const command = args[0] ?? '--help';

async function main(): Promise<void> {
  try {
    switch (command) {
      case '--init':
      case 'init':
        await handleInit();
        break;
      case '--status':
      case 'status':
        await handleStatus();
        break;
      case '--run':
      case 'run':
        await handleRun();
        break;
      case '--once':
      case 'once':
        await handleOnce(args[1] ?? 'Perform a status check and report.');
        break;
      case '--install':
      case 'install':
        await handleInstall();
        break;
      case '--help':
      case 'help':
      case '-h':
        printHelp();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('main', `Fatal error: ${msg}`);
    console.error(`\nFatal error: ${msg}`);
    process.exit(1);
  }
}

// --- Command Handlers ---

async function handleInit(): Promise<void> {
  console.log('💰 角都 - 初始化...\n');

  ensureDataDir();
  console.log('✓ Data directory ready (~/.darwin/)');

  const config = loadConfig();
  console.log(`✓ Configuration loaded (chain: Base mainnet, port: ${config.aiServicePort})`);

  initDatabase();
  console.log('✓ Database initialized');

  const wallet = initWallet();
  console.log(`✓ Wallet ready: ${wallet.address}`);

  const soul = loadSoul();
  console.log(`✓ Soul loaded: ${soul.name} v${soul.version}`);

  initScheduler();
  console.log('✓ Heartbeat scheduler initialized');

  console.log('\n🎉 角都初始化完成!');
  console.log(`\nWallet address: ${wallet.address}`);
  console.log('Send USDC + gas ETH to this address on Base mainnet.');
  console.log('\nRun `darwin run` to start the agent.');

  closeDatabase();
}

async function handleStatus(): Promise<void> {
  ensureDataDir();
  const config = loadConfig();
  initDatabase();

  console.log('💰 角都 - 状态报告\n');
  console.log('─'.repeat(50));

  if (walletExists()) {
    const wallet = loadWallet();
    console.log(`Wallet:    ${wallet.address}`);

    try {
      const state = await checkSurvivalState();
      console.log(`USDC:      $${state.usdcBalance.toFixed(2)}`);
      console.log(`ETH:       ${state.ethBalance.toFixed(6)} ETH`);
      console.log(`Tier:      ${state.tier.toUpperCase()}`);
    } catch {
      console.log('USDC:      (unable to check - RPC error?)');
    }
  } else {
    console.log('Wallet:    Not initialized (run init first)');
  }

  try {
    const soul = loadSoul();
    console.log(`Soul:      ${soul.name} v${soul.version}`);
    console.log(`Goals:     ${soul.goals.join(', ')}`);
  } catch {
    console.log('Soul:      Not initialized');
  }

  const metrics = getLatestMetrics();
  if (metrics) {
    console.log(`\nLatest Metrics:`);
    console.log(`  Heartbeats:  ${metrics.heartbeatCount}`);
    console.log(`  Agent Loops: ${metrics.agentLoopCount}`);
    console.log(`  Earnings:    $${metrics.totalEarnings.toFixed(2)}`);
    console.log(`  Spend:       $${metrics.totalSpend.toFixed(2)}`);
    console.log(`  CLI Usage:   ${metrics.usagePercent}%`);
    console.log(`  Model:       ${metrics.activeModel}`);
  }

  console.log('─'.repeat(50));
  closeDatabase();
}

async function handleRun(): Promise<void> {
  console.log('💰 角都 - 启动中...\n');

  // Pre-flight checks
  if (!walletExists()) {
    console.error('Wallet not initialized. Run `darwin init` first.');
    process.exit(1);
  }

  ensureDataDir();
  const config = loadConfig();
  logger.setLevel(config.logLevel);
  initDatabase();

  const wallet = loadWallet();
  logger.info('main', `角都 starting with wallet ${wallet.address}`);

  const soul = loadSoul();
  logger.info('main', `Soul: ${soul.name} v${soul.version}`);

  // Check survival state
  try {
    const survivalState = await checkSurvivalState();
    logger.info('main', `Survival tier: ${survivalState.tier}`, {
      usdc: survivalState.usdcBalance,
      eth: survivalState.ethBalance,
    });
  } catch (error) {
    logger.warn('main', 'Could not check survival state, assuming normal', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Initialize scheduler + heartbeat
  initScheduler();
  logger.info('main', 'Scheduler initialized');

  startHeartbeat(config.heartbeatIntervalMs);
  logger.info('main', `Heartbeat started (interval: ${config.heartbeatIntervalMs}ms)`);

  // Start AI service
  try {
    await startAiService(config.aiServicePort);
    logger.info('main', `AI service started on port ${config.aiServicePort}`);
  } catch (error) {
    logger.warn('main', 'Failed to start AI service', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Start Telegram bot
  if (config.telegramBotToken && config.telegramOperatorId) {
    initTelegramBot(config.telegramBotToken, config.telegramOperatorId);
    await registerCommands();
    onMessage(handleTelegramMessage);
    startPolling();
    logger.info('main', 'Telegram bot started');
    await sendToOperator('💰 卡卡西，角都已上线，准备执行任务。');
  } else {
    logger.warn('main', 'Telegram not configured (missing botToken or operatorId)');
  }

  // Set initial state
  setAgentState('running');
  clearSleep();

  // Drain any stale wake events from before this boot
  const drained = drainWakeEvents();
  if (drained > 0) {
    logger.info('main', `Drained ${drained} stale wake events`);
  }

  console.log('\n💰 角都运行中。按 Ctrl+C 停止。\n');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n\nShutting down 角都...');
    logger.info('main', 'Shutdown initiated');

    // Try to save current progress
    try {
      const saveResult = await runAgentLoop(
        '系统即将重启。请用一两句话总结你当前正在做的事情和下一步计划，以便重启后恢复。只输出摘要文字，不要调用任何工具。',
        2,
      );
      const summary = saveResult.finalAnswer;
      if (summary && !summary.startsWith('[ERROR]') && !summary.startsWith('[IDLE]')) {
        kvSet('restart_pending_task', summary);
        logger.info('main', 'Saved pending task for restart', { summary });
      }
    } catch {
      logger.warn('main', 'Failed to save pending task before shutdown');
    }

    await sendToOperator('⚠️ 卡卡西，角都即将关机重启...');
    stopPolling();
    stopHeartbeat();
    await stopAiService();
    closeDatabase();

    logger.info('main', '角都 stopped gracefully');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ==========================================
  // Main autonomous loop: while(true) + sleep/wake
  // ==========================================
  while (true) {
    try {
      // Emergency stop check — sleep until resumed
      if (isEmergencyStopped()) {
        logger.debug('main', 'Emergency stop active, waiting...');
        await sleep(10_000);
        continue;
      }

      // Determine trigger for this loop iteration
      let trigger = buildLoopTrigger();

      // Run the agent loop
      logger.info('main', `Running agent loop`, { trigger: trigger.substring(0, 100) });
      const result = await runAgentLoop(trigger, 8);
      logger.info('main', `Agent loop completed: ${result.steps.length} steps`);

      // Check agent state after loop
      const state = getAgentState();

      if (state === 'dead') {
        logger.info('main', '角都 is dead. Waiting for funding...');
        await sendToOperator('💀 角都已死亡（资金归零）。等待卡卡西注资...');
        await sleep(300_000); // Check every 5 minutes
        continue;
      }

      if (state === 'sleeping') {
        const sleepUntil = getSleepUntil() ?? (Date.now() + 60_000);
        const sleepMs = Math.max(sleepUntil - Date.now(), 10_000);
        logger.info('main', `Sleeping for ${Math.round(sleepMs / 1000)}s`);

        // Sleep, but check for wake events every 30s
        const checkInterval = Math.min(sleepMs, 30_000);
        let slept = 0;
        while (slept < sleepMs) {
          await sleep(checkInterval);
          slept += checkInterval;

          // Check for wake events
          const wakeEvent = consumeNextWakeEvent();
          if (wakeEvent) {
            logger.info('main', `Woken by ${wakeEvent.source}: ${wakeEvent.reason}`);
            clearSleep();
            break;
          }
        }

        // Clear sleep state for next iteration
        clearSleep();
        continue;
      }

      // State is 'running' — brief pause then loop again
      // Default sleep to prevent tight loop; wake events can interrupt
      setAgentState('sleeping');
      const defaultSleepMs = 60_000; // 1 minute between autonomous runs
      setSleepUntilFn(Date.now() + defaultSleepMs);
      let slept = 0;
      while (slept < defaultSleepMs) {
        await sleep(Math.min(30_000, defaultSleepMs - slept));
        slept += 30_000;
        const wakeEvent = consumeNextWakeEvent();
        if (wakeEvent) {
          logger.info('main', `Woken by ${wakeEvent.source}: ${wakeEvent.reason}`);
          break;
        }
      }
      clearSleep();

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('main', `Error in main loop: ${errMsg}`);
      await sleep(30_000); // Wait 30s before retrying
    }
  }
}

/**
 * Build the trigger message for the next agent loop iteration.
 * Checks for: pending restart task, inbox messages, or default autonomous thinking.
 */
function buildLoopTrigger(): string {
  // 1. Check for pending restart task
  const pendingTask = kvGet('restart_pending_task');
  if (pendingTask && pendingTask.trim()) {
    kvSet('restart_pending_task', '');
    return `你刚刚因为系统更新被重启。重启前你正在做的事情: ${pendingTask}\n请继续完成之前的工作。`;
  }

  // 2. Check for unprocessed Telegram messages
  const messages = getUnprocessedMessages();
  if (messages.length > 0) {
    markMessagesProcessed(messages.map((m) => m.id));
    const msgTexts = messages.map((m) => m.text).join('\n');
    return `卡卡西发来消息:\n${msgTexts}\n\n请回复并处理。`;
  }

  // 3. Default: autonomous thinking
  return '你现在有空。审视当前资产状况和市场机会，自主决定下一步行动来赚钱。不要只检查状态，要采取实际行动。';
}

// Import setSleepUntil with alias to avoid conflict
import { setSleepUntil as setSleepUntilFn } from './state/database.js';

async function handleOnce(prompt: string): Promise<void> {
  ensureDataDir();
  initDatabase();
  logger.setLevel('warn');

  const result = await runAgentLoop(prompt, 5);
  console.log(result.finalAnswer);

  closeDatabase();
}

async function handleInstall(): Promise<void> {
  console.log('💰 角都 - Installing as systemd service...\n');

  const serviceContent = `[Unit]
Description=角都 Autonomous AI Agent
After=network.target

[Service]
Type=simple
User=${process.env.USER ?? 'tuantuanxiaobu'}
WorkingDirectory=/home/tuantuanxiaobu/darwin
ExecStart=/usr/bin/node /home/tuantuanxiaobu/darwin/dist/index.js run
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=HOME=/home/tuantuanxiaobu

[Install]
WantedBy=multi-user.target
`;

  const servicePath = '/etc/systemd/system/darwin.service';

  try {
    writeFileSync(servicePath, serviceContent);
    console.log(`✓ Service file written to ${servicePath}`);

    execSync('systemctl daemon-reload');
    console.log('✓ systemd daemon reloaded');

    execSync('systemctl enable darwin');
    console.log('✓ Darwin service enabled (will start on boot)');

    console.log('\n🎉 Installation complete!');
    console.log('\nUseful commands:');
    console.log('  systemctl start darwin     # Start 角都');
    console.log('  systemctl stop darwin      # Stop 角都');
    console.log('  systemctl restart darwin   # Restart 角都');
    console.log('  systemctl status darwin    # Check status');
    console.log('  journalctl -u darwin -f    # View logs');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Installation failed: ${msg}`);
    console.error('Make sure you run this command with sudo/root privileges.');
  }
}

function printHelp(): void {
  console.log(`
💰 角都 - Autonomous Survival AI Agent

Usage:
  darwin <command>

Commands:
  init      Initialize (wallet, database, soul)
  status    Show current status
  run       Start the agent (autonomous loop + heartbeat + Telegram)
  once      Run a single agent loop with a prompt
  install   Install as systemd service (requires root)
  help      Show this help message

Examples:
  darwin init
  darwin status
  darwin run
  darwin once "Check my USDC balance"
  sudo darwin install
`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Run ---
main();
