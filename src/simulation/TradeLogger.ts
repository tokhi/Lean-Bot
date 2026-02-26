import type { TradeResult } from "../types/TradeTypes.js";

export interface LoggedTrade extends TradeResult {
  readonly assumedSlippage: number;
  readonly realizedSlippage: number;
}

export class TradeLogger {
  private logs: LoggedTrade[] = [];

  public logTrade(result: TradeResult, assumedSlippage: number, realizedSlippage: number): void {
    this.logs.push({
      ...result,
      assumedSlippage,
      realizedSlippage
    });
  }

  public getStats() {
    if (this.logs.length === 0) return null;

    const wins = this.logs.filter(l => l.Rmultiple > 0);
    const totalR = this.logs.reduce((sum, l) => sum + l.Rmultiple, 0);
    const avgDuration = this.logs.reduce((sum, l) => sum + l.duration, 0) / this.logs.length;
    
    const slippageDeviation = this.logs.reduce((sum, l) => 
      sum + (l.realizedSlippage - l.assumedSlippage), 0) / this.logs.length;

    return {
      totalTrades: this.logs.length,
      winRate: (wins.length / this.logs.length) * 100,
      expectancyR: totalR / this.logs.length,
      totalNetR: totalR,
      avgMFE: this.logs.reduce((sum, l) => sum + l.maxFavorableExcursion, 0) / this.logs.length,
      avgDurationMinutes: avgDuration / 60000,
      slippageLeakageBps: slippageDeviation * 10000 
    };
  }

  public printSummary(): void {
    const stats = this.getStats();
    if (!stats) return;

    console.log("==========================================");
    console.log(`Total Trades:       ${stats.totalTrades}`);
    console.log(`Win Rate:           ${stats.winRate.toFixed(2)}%`);
    console.log(`Net Profit (R):     ${stats.totalNetR.toFixed(2)}R`);
    console.log("==========================================");
  }
}
/**
 * MOCK USAGE EXAMPLE
 * 
 * const logger = new TradeLogger();
 * logger.logTrade({
 *   entryPrice: 1.0,
 *   exitPrice: 1.2,
 *   Rmultiple: 2.0,
 *   duration: 300000,
 *   maxFavorableExcursion: 1.25,
 *   maxAdverseExcursion: 0.98
 * }, 0.005, 0.006);
 * 
 * logger.printSummary();
 */
