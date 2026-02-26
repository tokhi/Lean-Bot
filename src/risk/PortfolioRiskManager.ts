/**
 * PortfolioRiskManager serves as the final safety circuit breaker.
 * It tracks intraday performance and prevents over-exposure or catastrophic
 * daily losses by disabling the trading engine when limits are breached.
 */
export class PortfolioRiskManager {
  private readonly dailyStartBalance: number;
  private currentPnL: number = 0;
  private readonly maxDailyDrawdownLimit: number;

  /**
   * @param initialBalance The portfolio balance at the start of the session.
   * @param drawdownLimitPercent The max % loss allowed (default 0.04 for 4%).
   */
  constructor(initialBalance: number, drawdownLimitPercent: number = 0.04) {
    this.dailyStartBalance = initialBalance;
    this.maxDailyDrawdownLimit = initialBalance * drawdownLimitPercent;
  }

  /**
   * Updates the accumulated daily PnL with the result of a closed trade.
   * @param amount Positive for profit, negative for loss.
   */
  public updatePnL(amount: number): void {
    this.currentPnL += amount;
  }

  /**
   * Enforces the 4% daily drawdown rule.
   * Reasoning:
   * If current realized losses exceed the limit, the strategy is deemed 
   * "out of sync" with the market regime, and new risk is prohibited.
   * 
   * @returns boolean - True if trading is permitted.
   */
  public canTrade(): boolean {
    const isDrawdownBreached = this.currentPnL <= -this.maxDailyDrawdownLimit;
    return !isDrawdownBreached;
  }

  /**
   * Returns the current risk status for logging and engine orchestration.
   */
  public getStatus() {
    return {
      currentPnL: this.currentPnL,
      limit: -this.maxDailyDrawdownLimit,
      drawdownPercent: (this.currentPnL / this.dailyStartBalance) * 100,
      active: this.canTrade()
    };
  }

  /**
   * Resets the PnL tracker (typically called at the start of a new day/session).
   * For simulation, this is called between discrete test days.
   */
  public resetSession(): void {
    this.currentPnL = 0;
  }
}

/**
 * MOCK USAGE EXAMPLE
 * 
 * const riskManager = new PortfolioRiskManager(1000); // $1000 balance, $40 limit
 * 
 * riskManager.updatePnL(-25); // Trade 1 loss
 * console.log(riskManager.canTrade()); // true
 * 
 * riskManager.updatePnL(-20); // Trade 2 loss
 * console.log(riskManager.canTrade()); // false (Total loss $45 > $40)
 * 
 * const status = riskManager.getStatus();
 * // { currentPnL: -45, limit: -40, drawdownPercent: -4.5, active: false }
 */
