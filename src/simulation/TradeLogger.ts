import type { TradeResult } from "../types/TradeTypes.js";

/**
 * RobustnessMetrics provides a deep-dive into the strategy performance
 * across different market regimes.
 */
export interface RobustnessMetrics {
  readonly datasetName: string;
  readonly winRate: number;
  readonly profitFactor: number;
  readonly totalNetR: number;
  readonly avgWinnerR: number;
  readonly avgLoserR: number;
  readonly maxDrawdownPercent: number;
  readonly stage2ProgressionRate: number;
  readonly stage3ProgressionRate: number;
}

export class TradeLogger {
  private logs: Map<string, any[]> = new Map();

  public logTrade(datasetName: string, result: any): void {
    const datasetLogs = this.logs.get(datasetName) || [];
    // Ensure realizedSlippage is never NaN
    const sanitizedResult = {
      ...result,
      realizedSlippage: result.realizedSlippage || 0.005, // Default to 50bps if missing
      stageReached: result.stageReached || 1
    };
    datasetLogs.push(sanitizedResult);
    this.logs.set(datasetName, datasetLogs);
  }

  public getRobustnessReport(datasetName: string, startingBalance: number): RobustnessMetrics {
    const trades = this.logs.get(datasetName) || [];
    if (trades.length === 0) {
      return { datasetName, winRate: 0, profitFactor: 0, totalNetR: 0, avgWinnerR: 0, avgLoserR: 0, maxDrawdownPercent: 0, stage2ProgressionRate: 0, stage3ProgressionRate: 0 };
    }

    const wins = trades.filter(t => t.Rmultiple > 0);
    const losses = trades.filter(t => t.Rmultiple <= 0);

    const grossProfitR = wins.reduce((sum, t) => sum + t.Rmultiple, 0);
    const grossLossR = Math.abs(losses.reduce((sum, t) => sum + t.Rmultiple, 0));

    // Calculate Max Drawdown (Portfolio Level)
    let peak = startingBalance;
    let currentBal = startingBalance;
    let maxDD = 0;

    trades.forEach(t => {
      // Assuming 1R = 1.5% of $1000 = $15 for simulation tracking
      const pnlUsd = t.Rmultiple * 15;
      currentBal += pnlUsd;
      if (currentBal > peak) peak = currentBal;
      const dd = (peak - currentBal) / peak;
      if (dd > maxDD) maxDD = dd;
    });

    return {
      datasetName,
      winRate: (wins.length / trades.length) * 100,
      profitFactor: grossLossR === 0 ? grossProfitR : grossProfitR / grossLossR,
      totalNetR: trades.reduce((sum, t) => sum + t.Rmultiple, 0),
      avgWinnerR: wins.length > 0 ? grossProfitR / wins.length : 0,
      avgLoserR: losses.length > 0 ? grossLossR / losses.length : 0,
      maxDrawdownPercent: maxDD * 100,
      stage2ProgressionRate: (trades.filter(t => t.stageReached >= 2).length / trades.length) * 100,
      stage3ProgressionRate: (trades.filter(t => t.stageReached >= 3).length / trades.length) * 100
    };
  }

  public printComparisonTable(reports: RobustnessMetrics[]): void {
    console.log("\n" + "=".repeat(105));
    console.log(
      "DATASET".padEnd(20) + 
      "WIN%".padEnd(10) + 
      "PF".padEnd(10) + 
      "NET R".padEnd(12) + 
      "AVG WIN R".padEnd(12) + 
      "MAX DD%".padEnd(12) + 
      "S2 RATE%".padEnd(10) + 
      "S3 RATE%"
    );
    console.log("-".repeat(105));

    reports.forEach(r => {
      console.log(
        r.datasetName.padEnd(20) + 
        r.winRate.toFixed(1).padEnd(10) + 
        r.profitFactor.toFixed(2).padEnd(10) + 
        r.totalNetR.toFixed(2).padEnd(12) + 
        r.avgWinnerR.toFixed(2).padEnd(12) + 
        r.maxDrawdownPercent.toFixed(2).padEnd(12) + 
        r.stage2ProgressionRate.toFixed(1).padEnd(10) + 
        r.stage3ProgressionRate.toFixed(1)
      );
    });
    console.log("=".repeat(105) + "\n");
  }
  /**
   * Prints advanced metrics for the Mixed Regime validation.
   */
  public printDetailedMetrics(datasetName: string, startingBalance: number): void {
    const trades = this.logs.get(datasetName) || [];
    if (trades.length === 0) return;

    let peakEquity = startingBalance;
    let currentEquity = startingBalance;
    let totalSlippage = 0;
    let maxConsecutiveLosses = 0;
    let currentLossStreak = 0;
    
    const distribution = { stopOut: 0, smallWin: 0, runner: 0, massive: 0 };

    trades.forEach(t => {
      // 1. R Distribution
      if (t.Rmultiple <= 0) distribution.stopOut++;
      else if (t.Rmultiple < 2) distribution.smallWin++;
      else if (t.Rmultiple < 5) distribution.runner++;
      else distribution.massive++;

      // 2. Slippage & Equity
      totalSlippage += t.realizedSlippage;
      currentEquity += (t.Rmultiple * 15); // Using $15 as R unit
      if (currentEquity > peakEquity) peakEquity = currentEquity;

      // 3. Loss Streak
      if (t.Rmultiple <= 0) {
        currentLossStreak++;
        if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
      } else {
        currentLossStreak = 0;
      }
    });

    console.log(`--- DETAILED METRICS: ${datasetName} ---`);
    console.log(`Peak Portfolio Equity:     $${peakEquity.toFixed(2)}`);
    console.log(`Total Slippage Accrued:    ${(totalSlippage * 100).toFixed(4)}%`);
    console.log(`Max Consecutive Losses:    ${maxConsecutiveLosses}`);
    console.log(`R Distribution:`);
    console.log(`  [<= 0R]  (Stops):        ${distribution.stopOut}`);
    console.log(`  [0-2R]   (Small):        ${distribution.smallWin}`);
    console.log(`  [2-5R]   (Runners):      ${distribution.runner}`);
    console.log(`  [> 5R]   (Massive):      ${distribution.massive}`);
    console.log("------------------------------------------\n");
  }
}
