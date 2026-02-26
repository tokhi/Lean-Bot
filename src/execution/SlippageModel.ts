/**
 * SlippageModel V2.1
 * 
 * Logic:
 * In AMMs (like Raydium/Orca), slippage is a function of trade size vs liquidity.
 * Constant Product Formula approximation:
 * Price Impact ≈ Trade Size / (Pool Liquidity / 2)
 */
export class SlippageModel {
  /**
   * Estimates price impact (slippage) for a given trade.
   * 
   * @param amountUsd The dollar value of the trade.
   * @param poolLiquidityUsd The total liquidity in the pool.
   * @returns number (e.g., 0.01 for 1%)
   */
  public static estimateImpact(amountUsd: number, poolLiquidityUsd: number): number {
    if (poolLiquidityUsd <= 0) return 1.0; // 100% impact if no liquidity

    // We assume the token side of the pool is half of the total liquidity
    const tokenSideLiquidity = poolLiquidityUsd / 2;
    
    // Basic linear impact model
    const impact = amountUsd / tokenSideLiquidity;

    // Add a 10% "Noise Buffer" to account for other concurrent trades
    return impact * 1.1;
  }
}
