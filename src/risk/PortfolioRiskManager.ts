/**
 * PortfolioRiskManager V2.1
 * 
 * Logic:
 * 1. Daily Drawdown: Stops all trading if 4% of starting balance is lost.
 * 2. Portfolio Heat: Limits total active risk (R) across all open positions.
 * 3. Correlation Cap: Limits the number of concurrent trades (Max 2).
 */
export class PortfolioRiskManager {
  private readonly dailyStartBalance: number;
  private currentPnL: number = 0;
  private readonly maxDailyDrawdownLimit: number;
  
  // Rule 5: Portfolio Heat Limit (Total R at risk across all trades)
  private readonly MAX_TOTAL_HEAT_R = 4.0; // Max 4 units of R total exposure
  private readonly MAX_CONCURRENT_TRADES = 2;

  private winCount: number = 0;
  private lossCount: number = 0;


  constructor(initialBalance: number, drawdownLimitPercent: number = 0.04) {
    this.dailyStartBalance = initialBalance;
    this.maxDailyDrawdownLimit = initialBalance * drawdownLimitPercent;
  }

  public updatePnL(amount: number): void {
    this.currentPnL += amount;
    if (amount > 0) this.winCount++;
    else if (amount < 0) this.lossCount++;
  }

  public getHourlySummary() {
    const totalTrades = this.winCount + this.lossCount;
    const winRate = totalTrades > 0 ? (this.winCount / totalTrades) * 100 : 0;
    return {
      totalTrades,
      wins: this.winCount,
      losses: this.lossCount,
      winRate: winRate.toFixed(2) + "%",
      netPnL: "$" + this.currentPnL.toFixed(2)
    };
  }

  /**
   * Evaluates if the portfolio can accept a new trade.
   * 
   * @param currentActiveTrades - Number of positions currently open
   * @param totalActiveRiskR - Sum of R-units at risk across open positions
   */
  public canTrade(currentActiveTrades: number, totalActiveRiskR: number): boolean {
    // 1. Check Daily Drawdown
    const isDrawdownBreached = this.currentPnL <= -this.maxDailyDrawdownLimit;
    if (isDrawdownBreached) return false;

    // 2. Check Correlation Cap (Rule 5)
    if (currentActiveTrades >= this.MAX_CONCURRENT_TRADES) return false;

    // 3. Check Portfolio Heat (Rule 5)
    if (totalActiveRiskR >= this.MAX_TOTAL_HEAT_R) return false;

    return true;
  }

  public getStatus() {
    return {
      currentPnL: this.currentPnL,
      active: this.currentPnL > -this.maxDailyDrawdownLimit
    };
  }
}
