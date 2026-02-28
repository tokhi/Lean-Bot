import { CONFIG } from "../config.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export class QuoteValidator {
  /**
   * V4.0 Pre-Trade Firewall
   */
  public static validate(params: {
    amountUsd: number;
    poolLiquidity: number;
    liquidity5mChange: number; // Step 4 Requirement
    isRiskActive: boolean;
  }): ValidationResult {
    
    if (!params.isRiskActive) return { valid: false, reason: "PORTFOLIO_RISK_LIMIT_REACHED" };

    // 1. Liquidity Floor/Ceiling
    if (params.poolLiquidity < CONFIG.MIN_LIQUIDITY_USD) return { valid: false, reason: "LIQUIDITY_BELOW_FLOOR" };
    if (params.poolLiquidity > CONFIG.MAX_LIQUIDITY_USD) return { valid: false, reason: "LIQUIDITY_ABOVE_CEILING" };

    // 2. Liquidity Growth (Step 4)
    if (params.liquidity5mChange < CONFIG.MIN_LIQUIDITY_GROWTH_5M) {
        return { 
          valid: false, 
          reason: `STAGNANT_LIQUIDITY: ${(params.liquidity5mChange * 100).toFixed(1)}% < 5%` 
        };
    }

    // 3. Price Impact (Max 5% of Pool - Step 1.4)
    const impact = params.amountUsd / params.poolLiquidity;
    if (impact > 0.05) return { valid: false, reason: `EXCESSIVE_IMPACT: ${(impact * 100).toFixed(1)}% > 5%` };

    return { valid: true };
  }
}
