import type { ExecutionResult } from "./interfaces/IExecutionLayer.js";

/**
 * ExecutionAuditor V2.1
 * 
 * Logic:
 * Tracks the "Friction" of the market.
 * Compares Core's theoretical prices vs. Execution's realized prices.
 */
export class ExecutionAuditor {
  private totalSlippagePaid: number = 0;
  private tradeCount: number = 0;

  public auditExecution(intendedPrice: number, result: ExecutionResult): void {
    const leakage = Math.abs(result.filledPrice - intendedPrice) / intendedPrice;
    this.totalSlippagePaid += leakage;
    this.tradeCount++;

    console.log(`[AUDIT] Execution Leakage: ${(leakage * 100).toFixed(4)}% | Total Avg Leakage: ${((this.totalSlippagePaid / this.tradeCount) * 100).toFixed(4)}%`);
  }
}
