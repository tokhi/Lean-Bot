import { CONFIG } from "../config.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * QuoteValidator V2.1
 * 
 * The "Pre-Trade Firewall". Validates market microstructure and 
 * portfolio health against hardcoded CONFIG guardrails.
 */
export class QuoteValidator {
  /**
   * Validates if a trade is safe to proceed.
   */
  public static validate(params: {
    amountUsd: number;
    poolLiquidity: number;
    slippageEstimate: number;
    isRiskActive: boolean; // From PortfolioRiskManager.canTrade()
  }): ValidationResult {
    
    // 1. Check Portfolio-Level Circuit Breaker (Daily Drawdown)
    if (!params.isRiskActive) {
      return { valid: false, reason: "DAILY_DRAWDOWN_OR_CIRCUIT_BREAKER_ACTIVE" };
    }

    // 2. Check Liquidity Floor (Hard Constraint)
    if (params.poolLiquidity < CONFIG.MIN_LIQUIDITY_USD) {
      return { 
        valid: false, 
        reason: `INSUFFICIENT_LIQUIDITY: Found $${params.poolLiquidity.toLocaleString()}, Need $${CONFIG.MIN_LIQUIDITY_USD.toLocaleString()}` 
      };
    }

    // 3. Check Price Impact (Microstructure Guardrail)
    const priceImpact = params.amountUsd / params.poolLiquidity;
    if (priceImpact > CONFIG.MAX_POOL_IMPACT_PCT) {
      return { 
        valid: false, 
        reason: `PRICE_IMPACT_TOO_HIGH: ${(priceImpact * 100).toFixed(4)}% > ${(CONFIG.MAX_POOL_IMPACT_PCT * 100).toFixed(2)}%` 
      };
    }

    // 4. Check Slippage Tolerance (BPS Conversion)
    const maxSlippageDec = CONFIG.SLIPPAGE_TOLERANCE_BPS / 10000;
    if (params.slippageEstimate > maxSlippageDec) {
      return { 
        valid: false, 
        reason: `EXCESSIVE_SLIPPAGE: ${(params.slippageEstimate * 100).toFixed(2)}% > ${(maxSlippageDec * 100).toFixed(2)}%` 
      };
    }

    return { valid: true };
  }
}
