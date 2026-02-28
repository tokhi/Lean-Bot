import type { Candle } from "../types/MarketTypes.js";

/**
 * StalenessEngine V4.2
 * 
 * Determines if a token should be removed from the watchlist.
 * Logic: A token is STALE if price is range-bound, volume is dead, 
 * and volatility has collapsed.
 */
export class StalenessEngine {
  /**
   * @param candles - Historical data
   * @param currentPrice - Current market price
   * @param atr - Current Average True Range (Volatility)
   */
  public static isStale(candles: Candle[], currentPrice: number, atr: number): boolean {
    if (candles.length < 7) return false;

    const recent = candles.slice(-7);
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);

    // 1. Price Range Check: (MaxHigh - MinLow) / Current < 1.5%
    // If a token moves less than 1.5% in 7 minutes, it's sideways.
    const range = (Math.max(...highs) - Math.min(...lows)) / currentPrice;
    const isRangeBound = range < 0.015;

    // 2. Volume Check: Avg Vol Multiplier last 5 < 1.2x
    // If volume hasn't increased, there is no momentum.
    const last5 = candles.slice(-5);
    const prevAvgVol = candles.slice(-10, -5).reduce((s, c) => s + c.volume, 0) / 5;
    const currentAvgVol = last5.reduce((s, c) => s + c.volume, 0) / 5;
    const isVolumeDead = (currentAvgVol / (prevAvgVol || 1)) < 1.2;

    // 3. Volatility Floor: Normalized ATR < 0.5%
    // Ensures we aren't pruning tokens that are getting ready to explode.
    const isVolatilityLow = (atr / currentPrice) < 0.005;

    // Return true only if it's both sideways and quiet
    return isRangeBound && isVolumeDead && isVolatilityLow;
  }
}
