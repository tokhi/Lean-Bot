import type { Candle } from "../types/MarketTypes.js";

/**
 * StalenessEngine V4.5
 * 
 * Logic:
 * 1. DOWNTREND (Aggressive): If price drops > 3% from local high, prune instantly.
 * 2. STAGNATION (Dead Money): If price is sideways AND volume is declining.
 */
export class StalenessEngine {
  public static isStale(history: Candle[], currentPrice: number, atr: number): boolean {
    if (history.length < 7) return false;

    const recent = history.slice(-7);
    const highestHigh = Math.max(...recent.map(c => c.high));
    
    // --- 1. DOWNTREND CHECK (The "Trash" Filter) ---
    // If we are more than 3% away from the local peak, the "Spike" has failed.
    const dropFromPeak = (highestHigh - currentPrice) / highestHigh;
    if (dropFromPeak > 0.03) return true;

    // --- 2. VOLATILITY COMPRESSION (Normalized ATR) ---
    // ATR / Price gives us the percentage of the "wiggle".
    const volPercent = atr / currentPrice;
    const isSideways = volPercent < 0.008; // Less than 0.8% average movement

    // --- 3. VOLUME DECAY ---
    // Average volume of the last 3 candles vs average of the 7-candle window.
    const avgVolWindow = recent.reduce((s, c) => s + c.volume, 0) / 7;
    const avgVolRecent = recent.slice(-3).reduce((s, c) => s + c.volume, 0) / 3;
    const isVolumeFading = avgVolRecent < avgVolWindow;

    // --- 4. THE DECISION ---
    // We only prune "Sideways" if the volume is also "Fading".
    // If it's sideways but volume is GROWING, we keep it (Accumulation).
    if (isSideways && isVolumeFading) return true;

    return false;
  }
}
