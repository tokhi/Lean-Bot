import type { Position } from "../types/TradeTypes.js";

/**
 * ExitEngine handles the dynamic calculation of trailing stops.
 * It transitions between standard volatility-based stops and aggressive 
 * parabolic protection to lock in gains on runners.
 */
export class ExitEngine {
  private static readonly PARABOLIC_THRESHOLD = 1.30;
  private static readonly PARABOLIC_TIME_WINDOW = 30 * 60 * 1000;
  private static readonly PARABOLIC_TRAIL_PERCENT = 0.15;
  
  private static readonly THIN_LIQUIDITY_THRESHOLD = 250_000;
  private static readonly HIGH_VOLATILITY_THRESHOLD = 0.05;

  public static calculateUpdatedStop(
    position: Position,
    currentPrice: number,
    atr: number,
    recentVolatility: number,
    poolLiquidity: number,
    currentTime: number
  ): number {
    let multiplier = 2.0;

    if (poolLiquidity < this.THIN_LIQUIDITY_THRESHOLD) {
      multiplier += 0.25;
    }

    if (recentVolatility > this.HIGH_VOLATILITY_THRESHOLD) {
      multiplier -= 0.5;
    }

    const baseAtrStop = position.peakPrice - (atr * multiplier);

    let parabolicStop = 0;
    const priceGain = currentPrice / position.entryPrice;
    const timeElapsed = currentTime - position.openTime;

    if (priceGain >= this.PARABOLIC_THRESHOLD && timeElapsed <= this.PARABOLIC_TIME_WINDOW) {
      parabolicStop = position.peakPrice * (1 - this.PARABOLIC_TRAIL_PERCENT);
    }

    const calculatedStop = Math.max(baseAtrStop, parabolicStop);
    return Math.max(position.stopPrice, calculatedStop);
  }
}

/**
 * MOCK USAGE EXAMPLE
 * 
 * const position: Position = {
 *   entryPrice: 100,
 *   quantity: 10,
 *   stopPrice: 85,
 *   stage: 1,
 *   riskAmount: 15,
 *   peakPrice: 120,
 *   openTime: Date.now() - 10 * 60 * 1000 // 10 mins ago
 * };
 * 
 * const newStop = ExitEngine.calculateUpdatedStop(
 *   position,
 *   135,      // currentPrice (+35% gain)
 *   5,        // ATR
 *   0.06,     // high volatility
 *   300000,   // healthy liquidity
 *   Date.now()
 * );
 * 
 * // Results: 
 * // Because price gain > 30% and time < 30m, Parabolic Mode triggers.
 * // Parabolic Stop: 135 * 0.85 = 114.75
 * // Base ATR Stop (tightened): 135 - (5 * 1.5) = 127.5
 * // Final Stop: 127.5 (highest)
 */
