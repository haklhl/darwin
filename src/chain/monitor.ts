// ============================================================
// Darwin - Chain Event Monitor
// ============================================================

import { logger } from '../observability/logger.js';
import { getPublicClient } from './client.js';
import { getWalletAddress } from '../identity/wallet.js';
import { loadConfig } from '../config.js';
import type { Address } from 'viem';

interface TransactionRecord {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastCheckedBlock: bigint = 0n;
const recentTransactions: TransactionRecord[] = [];
const pendingTxHashes: Set<string> = new Set();

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_RECENT_TRANSACTIONS = 100;

/**
 * Start polling for chain events relevant to Darwin's wallet.
 */
export function startChainMonitor(): void {
  if (pollInterval) {
    logger.warn('chain-monitor', 'Chain monitor already running');
    return;
  }

  logger.info('chain-monitor', 'Starting chain monitor', {
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  // Perform an initial poll immediately
  void pollForEvents();

  pollInterval = setInterval(() => {
    void pollForEvents();
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the chain monitor.
 */
export function stopChainMonitor(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('chain-monitor', 'Chain monitor stopped');
  }
}

/**
 * Poll for new blocks and check for relevant transactions.
 */
async function pollForEvents(): Promise<void> {
  try {
    const client = getPublicClient();
    const currentBlock = await client.getBlockNumber();

    if (lastCheckedBlock === 0n) {
      // First run: just record the current block and start from here
      lastCheckedBlock = currentBlock;
      logger.debug('chain-monitor', `Initialized at block ${currentBlock}`);
      return;
    }

    if (currentBlock <= lastCheckedBlock) {
      return; // No new blocks
    }

    const walletAddress = getWalletAddress().toLowerCase();
    const config = loadConfig();
    const usdcAddress = config.usdcAddress.toLowerCase();

    // Check blocks in batches (limit to 10 blocks at a time to avoid overloading)
    const fromBlock = lastCheckedBlock + 1n;
    const toBlock =
      currentBlock - fromBlock > 10n ? fromBlock + 10n : currentBlock;

    logger.debug('chain-monitor', `Scanning blocks ${fromBlock} to ${toBlock}`);

    // Look for ERC20 Transfer events to our address (USDC incoming)
    try {
      const logs = await client.getLogs({
        address: config.usdcAddress,
        event: {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { type: 'address', name: 'from', indexed: true },
            { type: 'address', name: 'to', indexed: true },
            { type: 'uint256', name: 'value', indexed: false },
          ],
        },
        args: {
          to: walletAddress as Address,
        },
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        const record: TransactionRecord = {
          hash: log.transactionHash ?? '',
          from: (log.args as { from?: string }).from ?? 'unknown',
          to: walletAddress,
          value: String((log.args as { value?: bigint }).value ?? 0n),
          timestamp: Date.now(),
        };

        recentTransactions.unshift(record);
        logger.info('chain-monitor', 'Incoming USDC transfer detected', {
          hash: record.hash,
          from: record.from,
          value: record.value,
        });
      }
    } catch (err) {
      logger.debug('chain-monitor', 'Error fetching logs (non-critical)', {
        error: String(err),
      });
    }

    // Trim recent transactions list
    while (recentTransactions.length > MAX_RECENT_TRANSACTIONS) {
      recentTransactions.pop();
    }

    lastCheckedBlock = toBlock;
  } catch (err) {
    logger.error('chain-monitor', 'Poll error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Check the status of pending transactions.
 */
export async function checkPendingTransactions(): Promise<void> {
  if (pendingTxHashes.size === 0) return;

  const client = getPublicClient();

  for (const hash of pendingTxHashes) {
    try {
      const receipt = await client.getTransactionReceipt({
        hash: hash as `0x${string}`,
      });

      if (receipt) {
        const status = receipt.status === 'success' ? 'confirmed' : 'failed';
        logger.info('chain-monitor', `Transaction ${hash} ${status}`, {
          blockNumber: String(receipt.blockNumber),
          gasUsed: String(receipt.gasUsed),
        });
        pendingTxHashes.delete(hash);
      }
    } catch {
      // Transaction not yet mined, leave it in the set
      logger.debug('chain-monitor', `Transaction ${hash} still pending`);
    }
  }
}

/**
 * Add a transaction hash to the pending tracking set.
 */
export function trackTransaction(hash: string): void {
  pendingTxHashes.add(hash);
  logger.debug('chain-monitor', `Tracking transaction ${hash}`);
}

/**
 * Get recent transactions observed by the monitor.
 */
export async function getRecentTransactions(
  limit: number = 20,
): Promise<TransactionRecord[]> {
  return recentTransactions.slice(0, limit);
}
