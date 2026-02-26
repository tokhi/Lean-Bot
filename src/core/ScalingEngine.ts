import type { Position } from "../types/TradeTypes.js";

/**
 * ScalingEngine V2.1 (Slippage-Adjusted)
 * 
 * Logic:
 * We only add capital if the "Slippage-Adjusted" Risk Credit is positive.
 * This accounts for the 'Exit Tax'—the reality that exiting a large 
 * Stage 3 position will move the price against us.
 */
export class ScalingEngine {
  private static readonly MAX_TOTAL_RISK_PCT = 0.015; // 1.5% Portfolio Cap
  private static readonly LIQUIDITY_IMPACT_CAP = 0.005; // 0.5% Pool Cap
  
  // Rule: Assume 1.5% slippage on exit for all RC calculations (The Exit Tax)
  private static readonly EXIT_SLIPPAGE_BUFFER = 0.015; 

  public static evaluate(
    position: Position,
    currentPrice: number,
    portfolioValue: number,
    poolLiquidity: number
  ) {
    if (position.stage >= 3) return { addQuantity: 0, newStage: position.stage };

    // 1. Calculate Unrealized Profit
    const unrealizedProfitUsd = (currentPrice - position.entryPrice) * position.quantity;
    
    // Rule: Only scale if market has proven trend (Unrealized > 1R)
    if (unrealizedProfitUsd < position.riskAmount) {
      return { addQuantity: 0, newStage: position.stage };
    }

    // 2. SLIPPAGE-ADJUSTED RISK CREDIT (The "Exit Tax" Math)
    const effectiveStopPrice = position.stopPrice * (1 - this.EXIT_SLIPPAGE_BUFFER);
    const slippageAdjustedRC = (effectiveStopPrice - position.entryPrice) * position.quantity;

    // 3. Risk Capacity Calculation
    const portfolioRiskCapUsd = portfolioValue * this.MAX_TOTAL_RISK_PCT;
    const availableRiskUsd = portfolioRiskCapUsd + slippageAdjustedRC;

    if (availableRiskUsd <= 0) {
      return { addQuantity: 0, newStage: position.stage };
    }

    // 4. Asymmetric Scaling Multipliers
    const targetAdditionR = position.stage === 1 ? 0.75 : 1.25;
    const targetAddRiskUsd = position.riskAmount * targetAdditionR;
    const allowedAddRiskUsd = Math.min(targetAddRiskUsd, availableRiskUsd);

    // 5. Calculate Quantity
    const stopDistance = currentPrice - position.stopPrice;
    if (stopDistance <= 0) return { addQuantity: 0, newStage: position.stage };

    let addQuantity = allowedAddRiskUsd / stopDistance;

    // 6. Liquidity Cap (Never more than 0.5% of pool)
    const totalNewUsd = (position.quantity + addQuantity) * currentPrice;
    const maxPoolUsd = poolLiquidity * this.LIQUIDITY_IMPACT_CAP;

    if (totalNewUsd > maxPoolUsd) {
      const allowedTotalUsd = maxPoolUsd;
      const allowedAddUsd = allowedTotalUsd - (position.quantity * currentPrice);
      addQuantity = Math.max(0, allowedAddUsd / currentPrice);
    }

    return {
      addQuantity,
      newStage: (position.stage + 1) as 2 | 3
    };
  }
  /**
   * Atomic Partitioning Logic
   * Calculates the number of sequential blocks needed to exit a position 
   * without exceeding a specific slippage threshold per block.
   */
  public static calculateExitPartitions(
    totalPositionUsd: number,
    poolLiquidity: number,
    maxImpactPerBlock: number = 0.003 // 0.3% impact limit
  ): number {
    const impactLimitUsd = poolLiquidity * maxImpactPerBlock;
    
    // Divide total size by what the pool can handle in one block
    const partitions = Math.ceil(totalPositionUsd / impactLimitUsd);
    
    // Ensure at least 1, max 5 (to prevent excessive latency)
    return Math.max(1, Math.min(partitions, 5));
  }
}
