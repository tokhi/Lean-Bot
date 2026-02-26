import type { Position } from "../types/TradeTypes.js";

/**
 * ExitEngine handles the dynamic calculation of trailing stops.
 * It transitions between standard volatility-based stops and aggressive 
 * parabolic protection to lock in gains on runners.
 */

export class ExitEngine {
  private static readonly VELOCITY_THRESHOLD = 0.10; // 10% gain
  private static readonly VELOCITY_WINDOW = 20 * 60 * 1000; // 20 minutes

  public static calculateUpdatedStop(
    position: Position,
    currentPrice: number,
    atr: number,
    recentVolatility: number,
    poolLiquidity: number,
    currentTime: number
  ): number {
    // 1. VELOCITY RULE (Time-Based Exit)
    // If trade hasn't reached 10% gain in 20 mins, move stop to currentPrice (Immediate Exit)
    const priceGain = currentPrice / position.entryPrice - 1;
    const timeElapsed = currentTime - position.openTime;

    if (timeElapsed > this.VELOCITY_WINDOW && priceGain < this.VELOCITY_THRESHOLD) {
      // Exit because the trade has lost "Momentum Velocity"
      return currentPrice;
    }

    // 2. ATR Stop: 2.0x ATR below the PEAK
    const baseAtrStop = position.peakPrice - (atr * 2.0);

    // 3. Parabolic Stop: 15% below the PEAK
    let parabolicStop = 0;
     // Trigger if gain > 30%
    if (priceGain >= 0.30) {
      parabolicStop = position.peakPrice * 0.85; 
    }

    // Return tightest (highest) stop, ensuring it only moves up
    const calculatedStop = Math.max(baseAtrStop, parabolicStop);
    return Math.max(position.stopPrice, calculatedStop);
  }
}
