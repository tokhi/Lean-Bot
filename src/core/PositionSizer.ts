/**
 * Result of the Stage 1 sizing calculation.
 */
export interface SizingResult {
  readonly quantity: number;
  readonly effectiveRisk: number;
  readonly expectedSlippage: number;
  readonly rejected: boolean;
}

/**
 * PositionSizer V2.1
 * 
 * Logic:
 * 1. Dynamic R: If liquidity is < $300k, use 0.3R (Probe). If > $300k, use 0.5R.
 * 2. Risk Math: Size = TargetRiskUSD / (Entry - Stop).
 * 3. Exposure Cap: Position total USD value cannot exceed 70% of portfolio.
 * 4. Impact Cap: Position total USD value cannot exceed 0.5% of pool liquidity.
 */
export class PositionSizer {
  private static readonly PORTFOLIO_EXPOSURE_CAP = 0.70; 
  private static readonly LIQUIDITY_IMPACT_CAP = 0.005;  
  private static readonly HEALTHY_LIQUIDITY_FLOOR = 300_000;

  public static calculateStage1Size(
    portfolioValue: number,
    baseRiskAmount: number, // The absolute 1.5% 'R' unit (e.g., $15)
    entryPrice: number,
    stopPrice: number,
    poolLiquidity: number
  ): SizingResult {
    // 1. Dynamic R Multiplier (0.3R for thin pools, 0.5R for healthy)
    const rMultiplier = poolLiquidity < this.HEALTHY_LIQUIDITY_FLOOR ? 0.3 : 0.5;
    const targetRiskUsd = baseRiskAmount * rMultiplier;

    // 2. Initial Risk-Based Quantity
    const stopDistance = entryPrice - stopPrice;
    if (stopDistance <= 0 || poolLiquidity <= 0) {
      return { quantity: 0, effectiveRisk: 0, expectedSlippage: 0, rejected: true };
    }
    
    let quantity = targetRiskUsd / stopDistance;
    let positionUsd = quantity * entryPrice;

    // 3. Apply Microstructure and Portfolio Caps
    // Limit A: 70% of Portfolio Total
    const maxExposureUsd = portfolioValue * this.PORTFOLIO_EXPOSURE_CAP;
    
    // Limit B: 0.5% of Pool Liquidity (Anti-Slippage)
    const maxLiquidityUsd = poolLiquidity * this.LIQUIDITY_IMPACT_CAP;

    const finalMaxUsd = Math.min(maxExposureUsd, maxLiquidityUsd);

    if (positionUsd > finalMaxUsd) {
      positionUsd = finalMaxUsd;
      quantity = positionUsd / entryPrice;
    }

    // 4. Final Rejection Logic
    const expectedSlippage = positionUsd / poolLiquidity;
    const rejected = expectedSlippage > 0.012 || poolLiquidity < 150000;

    return {
      quantity: rejected ? 0 : quantity,
      effectiveRisk: quantity * stopDistance,
      expectedSlippage,
      rejected
    };
  }
}
