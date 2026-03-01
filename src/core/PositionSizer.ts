import { CONFIG } from "../config.js";

export interface SizingResult {
  readonly buyAmountSol: number;
  readonly riskAmountSol: number; // The 10% stop loss value in SOL
  readonly isRejected: boolean;
  readonly reason?: string;
}

export class PositionSizer {
  private static readonly LIQUIDITY_IMPACT_CAP_PCT = 0.05; // Requirement 1.4: 5% limit

  /**
   * V5.5 Pure SOL Allocation Logic
   */
  public static calculateFixedSolSize(
    mode: "IGNITION" | "MODERATE",
    poolLiquidityUsd: number,
    solPriceUsd: number,
    walletBalanceSol: number
  ): SizingResult {
    
    // 1. Determine Target Buy (Exactly 1.0 or 2.0 SOL)
    let targetBuySol = mode === "IGNITION" 
      ? CONFIG.BUY_AMOUNT_IGNITION_SOL 
      : CONFIG.BUY_AMOUNT_MODERATE_SOL;

    // 2. Enforce 5% Liquidity Cap
    const poolDepthSol = poolLiquidityUsd / solPriceUsd;
    const maxSafeBuySol = poolDepthSol * this.LIQUIDITY_IMPACT_CAP_PCT;

    if (targetBuySol > maxSafeBuySol) {
      // Downsize to stay under 5% pool impact
      targetBuySol = maxSafeBuySol;
    }

    // 3. Absolute Balance Guard
    if (targetBuySol > walletBalanceSol * 0.9) {
        return { buyAmountSol: 0, riskAmountSol: 0, isRejected: true, reason: "INSUFFICIENT_FUNDS" };
    }

    return {
      buyAmountSol: targetBuySol,
      riskAmountSol: targetBuySol * CONFIG.INITIAL_STOP_LOSS_PCT,
      isRejected: targetBuySol < 0.01 // Minimum trade floor
    };
  }
}
