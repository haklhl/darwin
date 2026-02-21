// ============================================================
// Darwin - x402 Micropayment Protocol
// ============================================================

import { parseAbi, formatUnits, type Address } from 'viem';
import { getPublicClient } from '../chain/client.js';
import { loadConfig } from '../config.js';
import { getWalletAddress } from '../identity/wallet.js';
import { logger } from '../observability/logger.js';

const ERC20_TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

/**
 * Service pricing in USDC.
 */
const SERVICE_PRICING: Record<string, number> = {
  generate: 0.01, // $0.01 per text generation request
  analyze: 0.05,  // $0.05 per code analysis request
  embed: 0.001,   // $0.001 per embedding
  summarize: 0.02, // $0.02 per summarization
};

/**
 * Verify that a USDC payment transaction is valid and meets the expected amount.
 * Checks that the transaction transferred at least `expectedAmount` USDC to Darwin's wallet.
 */
export async function verifyPayment(
  txHash: string,
  expectedAmount: number,
): Promise<boolean> {
  try {
    const client = getPublicClient();
    const config = loadConfig();
    const walletAddress = getWalletAddress().toLowerCase();

    const receipt = await client.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });

    if (!receipt || receipt.status !== 'success') {
      logger.warn('x402', `Payment tx ${txHash} not confirmed or failed`);
      return false;
    }

    // Look for USDC Transfer events in the receipt logs
    for (const log of receipt.logs) {
      // Check if this log is from the USDC contract
      if (log.address.toLowerCase() !== config.usdcAddress.toLowerCase()) {
        continue;
      }

      // Transfer event topic: Transfer(address,address,uint256)
      const transferTopic =
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

      if (log.topics[0] !== transferTopic) {
        continue;
      }

      // topics[2] is the "to" address (padded to 32 bytes)
      const toAddress = log.topics[2];
      if (!toAddress) continue;

      const toAddr = ('0x' + toAddress.slice(26)).toLowerCase();
      if (toAddr !== walletAddress) {
        continue;
      }

      // Parse the transfer amount from log data
      const rawAmount = BigInt(log.data);
      const usdcAmount = Number(formatUnits(rawAmount, 6));

      if (usdcAmount >= expectedAmount) {
        logger.info('x402', `Payment verified: ${usdcAmount} USDC`, {
          txHash,
          expectedAmount,
          actualAmount: usdcAmount,
        });
        return true;
      } else {
        logger.warn('x402', `Payment insufficient: ${usdcAmount} < ${expectedAmount}`, {
          txHash,
        });
        return false;
      }
    }

    logger.warn('x402', `No USDC transfer to Darwin found in tx ${txHash}`);
    return false;
  } catch (err) {
    logger.error('x402', 'Payment verification failed', {
      txHash,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Generate a payment request that clients can use to pay for services.
 */
export function generatePaymentRequest(
  amount: number,
  description: string,
): {
  address: string;
  amount: number;
  chain: string;
  currency: string;
} {
  const address = getWalletAddress();

  logger.debug('x402', `Payment request generated: ${amount} USDC`, {
    description,
  });

  return {
    address,
    amount,
    chain: 'base',
    currency: 'USDC',
  };
}

/**
 * Get current pricing for each service type.
 */
export function getServicePricing(): Record<string, number> {
  return { ...SERVICE_PRICING };
}
