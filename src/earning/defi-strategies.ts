// ============================================================
// Darwin - DeFi Strategy Engine
// ============================================================

import type { DefiPosition, SurvivalTier } from '../types.js';
import { getAvailableStrategies, executeStrategy } from '../chain/defi.js';
import { getDatabase } from '../state/database.js';
import { recordEarningEvent } from './earnings-tracker.js';
import { logger } from '../observability/logger.js';

interface StrategyRecommendation {
  strategy: string;
  reason: string;
  expectedApy: number;
}

/**
 * DeFi Strategy Engine that evaluates and executes DeFi strategies
 * based on the current survival tier and balance.
 */
export class DefiStrategyEngine {
  private currentTier: SurvivalTier = 'normal';

  /**
   * Update the survival tier for strategy selection.
   */
  setTier(tier: SurvivalTier): void {
    this.currentTier = tier;
  }

  /**
   * Evaluate available strategies and rank them by suitability
   * given the current balance and survival tier.
   */
  async evaluateStrategies(
    balance: number,
  ): Promise<StrategyRecommendation[]> {
    const strategies = getAvailableStrategies();
    const recommendations: StrategyRecommendation[] = [];

    for (const strategy of strategies) {
      const estimate = await strategy.estimate();

      // Filter strategies based on survival tier risk tolerance
      if (!this.isStrategyAllowed(strategy.type, estimate.risk)) {
        logger.debug('defi-engine', `Strategy ${strategy.name} skipped (too risky for tier ${this.currentTier})`);
        continue;
      }

      // Don't recommend strategies if balance is too low to meaningfully participate
      const minAmount = this.getMinimumAmount();
      if (balance < minAmount) {
        logger.debug('defi-engine', `Strategy ${strategy.name} skipped (balance ${balance} below minimum ${minAmount})`);
        continue;
      }

      recommendations.push({
        strategy: strategy.name,
        reason: this.getRecommendationReason(strategy, estimate, balance),
        expectedApy: estimate.apy,
      });
    }

    // Sort by expected APY descending
    recommendations.sort((a, b) => b.expectedApy - a.expectedApy);

    logger.info('defi-engine', `Evaluated ${strategies.length} strategies, ${recommendations.length} recommended`, {
      tier: this.currentTier,
      balance,
    });

    return recommendations;
  }

  /**
   * Execute the top recommended strategy with the given balance.
   */
  async executeTopStrategy(balance: number): Promise<void> {
    const recommendations = await this.evaluateStrategies(balance);

    if (recommendations.length === 0) {
      logger.warn('defi-engine', 'No suitable strategies available', {
        tier: this.currentTier,
        balance,
      });
      return;
    }

    const top = recommendations[0];
    const allocAmount = this.calculateAllocation(balance);

    logger.info('defi-engine', `Executing top strategy: ${top.strategy}`, {
      amount: allocAmount,
      expectedApy: top.expectedApy,
      reason: top.reason,
    });

    try {
      const { txHash, position } = await executeStrategy(top.strategy, allocAmount);

      logger.info('defi-engine', `Strategy executed successfully`, {
        txHash,
        positionId: position.id,
        expectedApy: top.expectedApy,
      });
    } catch (err) {
      logger.error('defi-engine', 'Strategy execution failed', {
        strategy: top.strategy,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get all active DeFi positions from the database.
   */
  getActivePositions(): DefiPosition[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT id, protocol, type, token_a, token_b, amount_a, amount_b,
                entry_price, current_value, apy, created_at, updated_at, status
         FROM defi_positions WHERE status = 'active' ORDER BY created_at DESC`,
      )
      .all() as Array<{
      id: number;
      protocol: string;
      type: string;
      token_a: string;
      token_b: string | null;
      amount_a: number;
      amount_b: number | null;
      entry_price: number | null;
      current_value: number;
      apy: number | null;
      created_at: number;
      updated_at: number;
      status: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      protocol: row.protocol,
      type: row.type as DefiPosition['type'],
      tokenA: row.token_a,
      tokenB: row.token_b ?? undefined,
      amountA: row.amount_a,
      amountB: row.amount_b ?? undefined,
      entryPrice: row.entry_price ?? undefined,
      currentValue: row.current_value,
      apy: row.apy ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status as DefiPosition['status'],
    }));
  }

  /**
   * Close a DeFi position by ID.
   */
  async closePosition(positionId: number): Promise<void> {
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM defi_positions WHERE id = ? AND status = ?')
      .get(positionId, 'active') as {
      id: number;
      protocol: string;
      current_value: number;
      amount_a: number;
    } | undefined;

    if (!row) {
      throw new Error(`No active position found with ID ${positionId}`);
    }

    // In production, this would call the protocol's withdraw function
    logger.info('defi-engine', `Closing position ${positionId}`, {
      protocol: row.protocol,
      currentValue: row.current_value,
    });

    const profit = row.current_value - row.amount_a;

    db.prepare(
      'UPDATE defi_positions SET status = ?, updated_at = ? WHERE id = ?',
    ).run('closed', Date.now(), positionId);

    // Record any profit as earnings
    if (profit > 0) {
      recordEarningEvent(
        'defi_yield',
        profit,
        `Closed ${row.protocol} position #${positionId} with ${profit.toFixed(4)} USDC profit`,
      );
    }

    logger.info('defi-engine', `Position ${positionId} closed`, {
      profit,
    });
  }

  // --- Private helpers ---

  /**
   * Determine if a strategy type + risk level is allowed for the current tier.
   */
  private isStrategyAllowed(type: string, risk: string): boolean {
    switch (this.currentTier) {
      case 'high':
        // Aggressive: allow everything
        return true;

      case 'normal':
        // Balanced: lending + conservative LP, no high risk
        return risk !== 'high';

      case 'low_compute':
      case 'critical':
        // Safest only: USDC lending
        return type === 'lending' && (risk === 'low' || risk === 'very_low');

      case 'dead':
        // No DeFi activity
        return false;

      default:
        return false;
    }
  }

  /**
   * Minimum balance required to deploy a strategy.
   */
  private getMinimumAmount(): number {
    switch (this.currentTier) {
      case 'high':
        return 5;
      case 'normal':
        return 10;
      case 'low_compute':
        return 20;
      case 'critical':
        return 50;
      default:
        return Infinity;
    }
  }

  /**
   * Calculate how much of the balance to allocate to a strategy.
   */
  private calculateAllocation(balance: number): number {
    switch (this.currentTier) {
      case 'high':
        return balance * 0.5; // 50% of balance
      case 'normal':
        return balance * 0.3; // 30% of balance
      case 'low_compute':
        return balance * 0.1; // 10% of balance
      case 'critical':
        return balance * 0.05; // 5% of balance
      default:
        return 0;
    }
  }

  /**
   * Generate a human-readable reason for recommending a strategy.
   */
  private getRecommendationReason(
    strategy: { name: string; protocol: string; type: string },
    estimate: { apy: number; risk: string },
    balance: number,
  ): string {
    const alloc = this.calculateAllocation(balance);
    return (
      `${strategy.protocol} ${strategy.type} at ~${estimate.apy}% APY ` +
      `(risk: ${estimate.risk}). Allocate ${alloc.toFixed(2)} USDC ` +
      `(${((alloc / balance) * 100).toFixed(0)}% of balance) under ${this.currentTier} tier.`
    );
  }
}
