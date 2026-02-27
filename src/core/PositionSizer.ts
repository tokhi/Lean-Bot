import { CONFIG } from "../config.js";

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
 * PositionSizer V2.2 (Micro-Live Awareness)
 * 
 * Logic:
 * 1. Micro-Live Override: If MICRO_LIVE_TEST is true, caps risk at $5 
 *    and total exposure at $25 regardless of portfolio size.
 * 2. Dynamic R: 0.3R for thin pools (<$300k), 0.5R for healthy pools.
 * 3. Exposure Cap: Position value < 70% of portfolio (Standard) or $25 (Micro).
 * 4. Micro-Safety: Disables logic for Stage 3 progression.
 */
export class PositionSizer {
  private static readonly PORTFOLIO_EXPOSURE_CAP_PCT = 0.70; 
  private static readonly LIQUIDITY_IMPACT_CAP_PCT = 0.005;  
  private static readonly HEALTHY_LIQUIDITY_FLOOR = 300_000;

  public static calculateStage1Size(
    portfolioValue: number,
    baseRiskAmount: number, // The absolute 1.5% 'R' unit (e.g., $15)
    entryPrice: number,
    stopPrice: number,
    poolLiquidity: number
  ): SizingResult {
    
    // 1. Determine Target Risk USD
    const rMultiplier = poolLiquidity < this.HEALTHY_LIQUIDITY_FLOOR ? 0.3 : 0.5;
    let targetRiskUsd = baseRiskAmount * rMultiplier;

    // --- PHASE 3.1a MICRO LIVE OVERRIDE ---
    if (CONFIG.MICRO_LIVE_TEST) {
      if (targetRiskUsd > CONFIG.MAX_MICRO_RISK_USD) {
        console.log(`[MICRO MODE] Risk capped: $${targetRiskUsd.toFixed(2)} -> $${CONFIG.MAX_MICRO_RISK_USD.toFixed(2)}`);
        targetRiskUsd = CONFIG.MAX_MICRO_RISK_USD;
      }
    }

    // 2. Initial Risk-Based Quantity
    const stopDistance = entryPrice - stopPrice;
    if (stopDistance <= 0 || poolLiquidity <= 0) {
      return { quantity: 0, effectiveRisk: 0, expectedSlippage: 0, rejected: true };
    }
    
    let quantity = targetRiskUsd / stopDistance;
    let positionUsd = quantity * entryPrice;

    // 3. Apply Hard Caps (Portfolio, Liquidity, and Micro-Live Position Cap)
    const standardExposureCapUsd = portfolioValue * this.PORTFOLIO_EXPOSURE_CAP_PCT;
    const liquidityImpactCapUsd = poolLiquidity * this.LIQUIDITY_IMPACT_CAP_PCT;
    
    let finalMaxUsd = Math.min(standardExposureCapUsd, liquidityImpactCapUsd);

    // --- PHASE 3.1a MICRO LIVE POSITION CAP ---
    if (CONFIG.MICRO_LIVE_TEST) {
      finalMaxUsd = Math.min(finalMaxUsd, CONFIG.MAX_MICRO_POSITION_USD);
    }

    if (positionUsd > finalMaxUsd) {
      positionUsd = finalMaxUsd;
      quantity = positionUsd / entryPrice;
    }

    // 4. Final Rejection Logic
    const expectedSlippage = positionUsd / poolLiquidity;
    const rejected = expectedSlippage > 0.012 || poolLiquidity < CONFIG.MIN_LIQUIDITY_USD;

    return {
      quantity: rejected ? 0 : quantity,
      effectiveRisk: quantity * stopDistance,
      expectedSlippage,
      rejected
    };
  }
}
