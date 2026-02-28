import { CONFIG } from "../config.js";

export interface SizingResult {
  readonly quantity: number;
  readonly riskUsd: number;
  readonly isRejected: boolean;
  readonly reason?: string | undefined;
  readonly volatilityFactor: number;
}

export class PositionSizer {
  private static readonly PORTFOLIO_EXPOSURE_CAP_PCT = 0.70; 
  private static readonly LIQUIDITY_IMPACT_CAP_PCT = 0.05; 

  /**
   * Calculates position size using SOL-based risk and 5m Volatility.
   */
  public static calculatePosition(
    solPrice: number,
    entryPrice: number,
    stopPrice: number,
    poolLiquidityUsd: number,
    walletBalanceSol: number,
    priceChange5m: number,
    baseRiskSol: number // Changed: Pass specific risk unit (0.15 or 0.20)
  ): SizingResult {
    
    // 1. COMPUTE VOLATILITY FACTOR
    const volatilityFactor = Math.min(Math.max(Math.abs(priceChange5m) / 5, 0.5), 2.0);

    // 2. APPLY VOLATILITY SCALING TO THE SPECIFIC RISK UNIT
    const targetRSol = baseRiskSol * volatilityFactor;

    // 3. CONVERT TO USD FOR TOKEN QUANTITY MATH
    const rUsd = targetRSol * solPrice;
    const stopDistanceUsd = Math.abs(entryPrice - stopPrice);

    if (stopDistanceUsd === 0) {
      return { quantity: 0, riskUsd: 0, isRejected: true, reason: "INVALID_STOP", volatilityFactor: 1 };
    }

    // 4. CALCULATE RAW QUANTITY
    let quantity = rUsd / stopDistanceUsd;
    let positionValueUsd = quantity * entryPrice;

    // 5. ENFORCE HARD PORTFOLIO & LIQUIDITY CAPS
    const maxLiqUsd = poolLiquidityUsd * this.LIQUIDITY_IMPACT_CAP_PCT;
    const maxWalletUsd = (walletBalanceSol * solPrice) * CONFIG.MAX_PORTFOLIO_RISK_PCT;

    let finalMaxUsd = Math.min(maxLiqUsd, maxWalletUsd);

    if (CONFIG.MICRO_LIVE_TEST) {
        finalMaxUsd = Math.min(finalMaxUsd, CONFIG.MAX_MICRO_POSITION_USD);
    }

    if (positionValueUsd > finalMaxUsd) {
      positionValueUsd = finalMaxUsd;
      quantity = positionValueUsd / entryPrice;
    }

    // 6. FINAL REJECTION LOGIC
    const isRejected = targetRSol > walletBalanceSol || poolLiquidityUsd < CONFIG.MIN_LIQUIDITY_USD;

    return { 
        quantity, 
        riskUsd: quantity * stopDistanceUsd, 
        isRejected, 
        volatilityFactor,
        reason: isRejected ? "RISK_EXCEEDS_CAPACITY" : undefined
    };
  }
}
