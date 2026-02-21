// ============================================================
// Darwin - DeFi Strategy Execution
// ============================================================

import type { DefiPosition } from '../types.js';
import { logger } from '../observability/logger.js';
import { getDatabase } from '../state/database.js';
import {
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
  formatUnits,
  type Address,
} from 'viem';
import { base } from 'viem/chains';
import { getPublicClient } from './client.js';
import { getSignerAccount, getWalletAddress } from '../identity/wallet.js';
import { loadConfig } from '../config.js';

// Aave V3 Pool on Base mainnet
const AAVE_V3_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as const;

const AAVE_POOL_ABI = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
]);

const ERC20_APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export interface DefiStrategy {
  name: string;
  protocol: string;
  type: string;
  execute(amount: number): Promise<string>;
  estimate(): Promise<{ apy: number; risk: string }>;
}

// --- Aave V3 USDC Lending ---

function createAaveUsdcLending(): DefiStrategy {
  return {
    name: 'aave-usdc-lending',
    protocol: 'Aave V3',
    type: 'lending',

    async execute(amount: number): Promise<string> {
      logger.info('defi', 'Executing Aave V3 USDC supply', {
        protocol: 'Aave V3',
        action: 'supply',
        amount,
      });

      const config = loadConfig();
      const account = getSignerAccount();
      const walletAddress = getWalletAddress() as Address;
      const publicClient = getPublicClient();

      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: http(config.rpcUrl),
      });

      const onChainAmount = parseUnits(amount.toString(), 6);
      const usdcAddress = config.usdcAddress as Address;

      // Step 1: Check and set allowance
      const allowance = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_APPROVE_ABI,
        functionName: 'allowance',
        args: [walletAddress, AAVE_V3_POOL],
      });

      if ((allowance as bigint) < onChainAmount) {
        logger.info('defi', 'Approving USDC for Aave V3 pool', {
          spender: AAVE_V3_POOL,
          amount: onChainAmount.toString(),
        });
        const approveTx = await walletClient.writeContract({
          address: usdcAddress,
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [AAVE_V3_POOL, onChainAmount],
        });
        logger.info('defi', 'USDC approval submitted', { approveTx });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        logger.info('defi', 'USDC approval confirmed');
      } else {
        logger.info('defi', 'USDC allowance sufficient, skipping approve');
      }

      // Step 2: Supply USDC to Aave V3
      logger.info('defi', 'Supplying USDC to Aave V3 pool');
      const supplyTx = await walletClient.writeContract({
        address: AAVE_V3_POOL,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [usdcAddress, onChainAmount, walletAddress, 0],
      });

      logger.info('defi', 'Aave V3 supply submitted', { supplyTx, amount });
      await publicClient.waitForTransactionReceipt({ hash: supplyTx });
      logger.info('defi', 'Aave V3 supply confirmed', { supplyTx, amount });

      return supplyTx;
    },

    async estimate(): Promise<{ apy: number; risk: string }> {
      return { apy: 3.5, risk: 'low' };
    },
  };
}

// --- Uniswap V3 USDC/ETH LP (stub — requires off-chain tick range calculation) ---

function createUniswapV3Lp(): DefiStrategy {
  return {
    name: 'uniswap-v3-usdc-eth',
    protocol: 'Uniswap V3',
    type: 'liquidity',

    async execute(_amount: number): Promise<string> {
      throw new Error('Uniswap V3 LP requires off-chain tick range calculation. Use Aave V3 lending instead.');
    },

    async estimate(): Promise<{ apy: number; risk: string }> {
      return { apy: 12.0, risk: 'medium' };
    },
  };
}

/**
 * Get all available DeFi strategies.
 */
export function getAvailableStrategies(): DefiStrategy[] {
  return [createAaveUsdcLending(), createUniswapV3Lp()];
}

/**
 * Execute a specific strategy by name with a given USDC amount.
 * Returns the transaction hash and a position record.
 */
export async function executeStrategy(
  strategyName: string,
  amount: number,
): Promise<{ txHash: string; position: DefiPosition }> {
  const strategies = getAvailableStrategies();
  const strategy = strategies.find((s) => s.name === strategyName);

  if (!strategy) {
    throw new Error(`Unknown strategy: ${strategyName}. Available: ${strategies.map((s) => s.name).join(', ')}`);
  }

  const estimate = await strategy.estimate();
  logger.info('defi', `Executing strategy ${strategyName}`, {
    amount,
    estimatedApy: estimate.apy,
    risk: estimate.risk,
  });

  const txHash = await strategy.execute(amount);
  const now = Date.now();

  // Record the position in the database
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO defi_positions (protocol, type, token_a, token_b, amount_a, amount_b, current_value, apy, created_at, updated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    )
    .run(
      strategy.protocol,
      strategy.type,
      'USDC',
      strategy.type === 'liquidity' ? 'ETH' : null,
      amount,
      strategy.type === 'liquidity' ? 0 : null,
      amount,
      estimate.apy,
      now,
      now,
    );

  const position: DefiPosition = {
    id: result.lastInsertRowid as number,
    protocol: strategy.protocol,
    type: strategy.type as DefiPosition['type'],
    tokenA: 'USDC',
    tokenB: strategy.type === 'liquidity' ? 'ETH' : undefined,
    amountA: amount,
    amountB: strategy.type === 'liquidity' ? 0 : undefined,
    currentValue: amount,
    apy: estimate.apy,
    createdAt: now,
    updatedAt: now,
    status: 'active',
  };

  logger.info('defi', `Strategy ${strategyName} executed`, {
    txHash,
    positionId: position.id,
  });

  return { txHash, position };
}

/**
 * Withdraw USDC from Aave V3 pool.
 * Amount is in human-readable USDC (e.g. 10 = $10).
 * Use amount = -1 to withdraw max (type(uint256).max).
 * Returns the transaction hash.
 */
export async function withdrawAave(amount: number): Promise<string> {
  const config = loadConfig();
  const account = getSignerAccount();
  const walletAddress = getWalletAddress() as Address;
  const publicClient = getPublicClient();

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.rpcUrl),
  });

  const usdcAddress = config.usdcAddress as Address;
  // Use max uint256 to withdraw all, otherwise parse amount
  const onChainAmount = amount < 0
    ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
    : parseUnits(amount.toString(), 6);

  logger.info('defi', 'Withdrawing USDC from Aave V3', { amount, onChainAmount: onChainAmount.toString() });

  const withdrawTx = await walletClient.writeContract({
    address: AAVE_V3_POOL,
    abi: AAVE_POOL_ABI,
    functionName: 'withdraw',
    args: [usdcAddress, onChainAmount, walletAddress],
  });

  logger.info('defi', 'Aave V3 withdraw submitted', { withdrawTx });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawTx });
  logger.info('defi', 'Aave V3 withdraw confirmed', { withdrawTx, status: receipt.status });

  // Update active positions in DB
  const db = getDatabase();
  if (amount < 0) {
    // Withdraw all: close all active Aave positions
    db.prepare(`UPDATE defi_positions SET status = 'closed', updated_at = ? WHERE protocol = 'Aave V3' AND status = 'active'`).run(Date.now());
  } else {
    // Partial withdraw: reduce the most recent active position
    const pos = db.prepare(`SELECT id, amount_a FROM defi_positions WHERE protocol = 'Aave V3' AND status = 'active' ORDER BY created_at DESC LIMIT 1`).get() as { id: number; amount_a: number } | undefined;
    if (pos) {
      const remaining = pos.amount_a - amount;
      if (remaining <= 0) {
        db.prepare(`UPDATE defi_positions SET status = 'closed', amount_a = 0, current_value = 0, updated_at = ? WHERE id = ?`).run(Date.now(), pos.id);
      } else {
        db.prepare(`UPDATE defi_positions SET amount_a = ?, current_value = ?, updated_at = ? WHERE id = ?`).run(remaining, remaining, Date.now(), pos.id);
      }
    }
  }

  return withdrawTx;
}
