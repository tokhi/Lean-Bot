/**
 * Result of the position sizing calculation.
 */
export interface SizingResult {
  readonly quantity: number;
  readonly effectiveRisk: number;
  readonly expectedSlippage: number;
  readonly rejected: boolean;
}

/**
 * Liquidity threshold for risk reduction.
 * As discussed in Lean V2 roadmap, pools below this depth are considered "Thin".
 */
const THIN_LIQUIDITY_THRESHOLD = 250_000;

/**
 * PositionSizer determines the Stage 1 entry size based on portfolio risk 
 * and pool microstructure (liquidity and slippage).
 */
export class PositionSizer {
  /**
   * Calculates the safe quantity to purchase for a Stage 1 entry.
   * 
   * Math breakdown:
   * 1. Risk Amount = Portfolio * Risk% (capped at 1.5%)
   * 2. If Liquidity < $250k, Risk Amount = Risk Amount * 0.6 (40% reduction)
   * 3. Raw Quantity = Risk Amount / (EntryPrice - StopPrice)
   * 4. Position USD = Raw Quantity * EntryPrice
   * 5. If Position USD > (Liquidity * 0.5%), cap size to 0.5% of pool
   * 6. Slippage = Position USD / Liquidity
   */
  public static calculateStage1Size(
    portfolioValue: number,
    riskPercent: number, // e.g., 0.015 for 1.5%
    entryPrice: number,
    stopPrice: number,
    poolLiquidity: number,
    maxPoolImpactPercent: number = 0.005 // 0.5%
  ): SizingResult {
    // 0. Initial Safety Checks
    if (entryPrice <= stopPrice || poolLiquidity <= 0 || portfolioValue <= 0) {
      return { quantity: 0, effectiveRisk: 0, expectedSlippage: 0, rejected: true };
    }

    // 1. Calculate Adjusted Risk Amount
    const clampedRiskPercent = Math.min(riskPercent, 0.015);
    let riskAmountUsd = portfolioValue * clampedRiskPercent;

    // Rule 4: Liquidity-based risk reduction (Thin pool penalty)
    if (poolLiquidity < THIN_LIQUIDITY_THRESHOLD) {
      riskAmountUsd *= 0.60;
    }

    // 2. Determine Quantity based on Stop Distance
    const stopDistance = entryPrice - stopPrice;
    let quantity = riskAmountUsd / stopDistance;
    let positionUsd = quantity * entryPrice;

    // Rule 3: Liquidity Cap (Max 0.5% of pool)
    const maxAllowedUsd = poolLiquidity * maxPoolImpactPercent;
    if (positionUsd > maxAllowedUsd) {
      positionUsd = maxAllowedUsd;
      quantity = positionUsd / entryPrice;
    }

    // 3. Estimate Slippage
    // Linear model: Slippage % is approximately the ratio of trade size to pool depth
    const expectedSlippage = this.estimateSlippage(positionUsd, poolLiquidity);

    // Rule 5: Reject if estimated slippage > 1.2%
    const rejected = expectedSlippage > 0.012;

    // 4. Final Effective Risk (Actual USD lost if stop hit, excluding slippage)
    const effectiveRisk = quantity * stopDistance;

    return {
      quantity: rejected ? 0 : quantity,
      effectiveRisk: rejected ? 0 : effectiveRisk,
      expectedSlippage,
      rejected
    };
  }

  /**
   * Internal slippage estimator.
   * Simple impact model where impact scales with pool depth.
   */
  private static estimateSlippage(positionUsd: number, poolLiquidity: number): number {
    if (poolLiquidity === 0) return 1;
    return positionUsd / poolLiquidity;
  }
}

/**
 * MOCK USAGE EXAMPLE
 * 
 * const result = PositionSizer.calculateStage1Size(
 *   1000,   // $1000 portfolio
 *   0.015,  // 1.5% max risk ($15)
 *   0.10,   // Entry at $0.10
 *   0.09,   // Stop at $0.09 (10% dist)
 *   300000, // $300k liquidity
 *   0.005   // 0.5% impact cap
 * );
 * 
 * Result: { 
 *   quantity: 150, 
 *   effectiveRisk: 15, 
 *   expectedSlippage: 0.00005, 
 *   rejected: false 
 * }
 */
