// ============================================================
// Darwin - DeFi Strategy Execution
// ============================================================

import type { DefiPosition } from '../types.js';
import { logger } from '../observability/logger.js';
import { getDatabase } from '../state/database.js';

export interface DefiStrategy {
  name: string;
  protocol: string;
  type: string;
  execute(): Promise<string>;
  estimate(): Promise<{ apy: number; risk: string }>;
}

// --- Strategy stubs ---

function createAaveUsdcLending(): DefiStrategy {
  return {
    name: 'aave-usdc-lending',
    protocol: 'Aave V3',
    type: 'lending',

    async execute(): Promise<string> {
      logger.info('defi', 'Executing Aave V3 USDC lending strategy', {
        protocol: 'Aave V3',
        action: 'Supply USDC to Aave V3 lending pool on Base',
      });
      // Stub: would call Aave V3 pool contract to supply USDC
      return '0x' + '0'.repeat(64); // placeholder tx hash
    },

    async estimate(): Promise<{ apy: number; risk: string }> {
      return { apy: 3.5, risk: 'low' };
    },
  };
}

function createUniswapV3Lp(): DefiStrategy {
  return {
    name: 'uniswap-v3-usdc-eth',
    protocol: 'Uniswap V3',
    type: 'liquidity',

    async execute(): Promise<string> {
      logger.info('defi', 'Executing Uniswap V3 LP strategy', {
        protocol: 'Uniswap V3',
        action: 'Provide USDC/ETH liquidity on Uniswap V3 Base',
        pair: 'USDC/ETH',
      });
      // Stub: would mint a Uniswap V3 position with a tight range
      return '0x' + '1'.repeat(64); // placeholder tx hash
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

  const txHash = await strategy.execute();
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
