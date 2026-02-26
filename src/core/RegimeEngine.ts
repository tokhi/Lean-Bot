/**
 * Market regimes as defined in the system architecture.
 */
export type Regime = "EXPANSION" | "CHOPPY" | "HIBERNATE";

/**
 * RegimeEngine acts as the global safety valve for the bot.
 * It evaluates market breadth and recent performance to decide if the 
 * environment is suitable for momentum trading.
 */
export class RegimeEngine {
  // Thresholds based on Lean V2 roadmap
  private static readonly BREADTH_THRESHOLD = 0;      // Positive breadth required
  private static readonly MAX_ALLOWED_LOSSES = 3;     // Circuit breaker for local failure
  private static readonly EXTREME_VOLATILITY = 0.15;  // 15% price fluctuations considered erratic

  /**
   * Determines the current market regime.
   * 
   * Reasoning:
   * 1. Personal Circuit Breaker: If the bot has taken 3 consecutive losses, the strategy 
   *    is likely out of sync with current price action. Force HIBERNATE.
   * 2. Market Breadth: BreadthScore (Successes - Failures of trending tokens). 
   *    If negative, breakouts are statistically failing across the chain. Force HIBERNATE.
   * 3. Volatility Filter: Even if breadth is okay, extreme volatility leads to "whipsaws" 
   *    where stops are hit before trends can form. Label as CHOPPY.
   * 4. Growth Default: If none of the above are true, we are in an EXPANSION regime.
   */
  public static calculate(
    breadthScore: number,
    recentLosses: number,
    volatilityIndex: number
  ): Regime {
    
    // Rule 1: Safety first - Consecutive loss circuit breaker
    if (recentLosses >= this.MAX_ALLOWED_LOSSES) {
      return "HIBERNATE";
    }

    // Rule 2: Broad market sentiment - Are breakouts working elsewhere?
    if (breadthScore < this.BREADTH_THRESHOLD) {
      return "HIBERNATE";
    }

    // Rule 3: Noise filter - Is the price action too erratic for clean trends?
    if (volatilityIndex >= this.EXTREME_VOLATILITY) {
      return "CHOPPY";
    }

    // Default: High-probability environment
    return "EXPANSION";
  }
}

/**
 * EXAMPLE SCENARIOS
 * 
 * Scenario 1: Healthy Bull Market
 * calculate(5, 0, 0.04) -> "EXPANSION"
 * (Breadth is high, no losses, low volatility)
 * 
 * Scenario 2: Post-Dump Chop
 * calculate(1, 0, 0.20) -> "CHOPPY"
 * (Breadth is slightly positive, but volatility is extreme)
 * 
 * Scenario 3: Toxic Market / Failure Streak
 * calculate(8, 3, 0.05) -> "HIBERNATE"
 * (Market looks good, but the BOT is failing. Trigger circuit breaker.)
 * 
 * Scenario 4: Broad Market Reversal
 * calculate(-3, 0, 0.06) -> "HIBERNATE"
 * (Market breadth is negative; breakouts are becoming fakeouts.)
 */
