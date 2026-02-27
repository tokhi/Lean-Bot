import type { Candle } from "../types/MarketTypes.js";

/**
 * Result of the entry evaluation.
 */
export interface EntrySignal {
  readonly enter: boolean;
  readonly breakoutLevel: number;
  readonly strengthScore: number; // 0 - 10 scale
  readonly reason: string;        // Contextual reason for decision
}

export class EntryEngine {
  private static readonly LOOKBACK_PERIOD = 5; 
  private static readonly VOLUME_ACCEL_MULTIPLIER = 3.0;

  /**
   * Deterministically evaluates if current market state warrants a Stage 1 entry.
   * 
   * Logic Flow:
   * 1. Windowing: Analyzes current candle vs average of previous 5.
   * 2. Breakout: Close must exceed the highest 'High' of the lookback period.
   * 3. Volume: Current volume must be 3x the lookback average.
   * 4. Near-Miss: Logs specific reasons for rejection to calibrate thresholds.
   */
  public static evaluate(
    recentCandles: Candle[],
    regime: string,
    minLiquidity: number
  ): EntrySignal {
    // 1. Data Integrity Guard
    if (recentCandles.length <= this.LOOKBACK_PERIOD) {
      return { 
        enter: false, 
        breakoutLevel: 0, 
        strengthScore: 0, 
        reason: "INITIALIZING_MEMORY" 
      };
    }

    const currentCandle = recentCandles[recentCandles.length - 1]!;
    const previousCandles = recentCandles.slice(-(this.LOOKBACK_PERIOD + 1), -1);

    // 2. Math - Calculate Thresholds
    const breakoutLevel = Math.max(...previousCandles.map((c) => c.high));
    const avgVolume = previousCandles.reduce((sum, c) => sum + c.volume, 0) / this.LOOKBACK_PERIOD;
    const volRatio = currentCandle.volume / (avgVolume || 1);

    // 3. Logic Gates
    const isExpanding = regime === "EXPANSION";
    const isPriceBreakout = currentCandle.close > breakoutLevel;
    const isVolumeAccelerating = volRatio >= this.VOLUME_ACCEL_MULTIPLIER;
    const hasLiquidity = currentCandle.liquidity >= minLiquidity;

    // 4. Decision and Near-Miss Attribution
    let reason = "WAITING_FOR_SIGNAL";
    let enter = false;

    if (!isExpanding) {
      reason = `REGIME_FILTER: Market is ${regime}`;
    } 
    else if (!hasLiquidity) {
      reason = `LIQUIDITY_FILTER: $${(currentCandle.liquidity / 1000).toFixed(0)}k < $${(minLiquidity / 1000).toFixed(0)}k`;
    } 
    else if (isPriceBreakout && !isVolumeAccelerating) {
      reason = `FILTERED: Breakout confirmed but Volume Multiplier too low (${volRatio.toFixed(2)}x / 3.0x required)`;
    } 
    else if (!isPriceBreakout && isVolumeAccelerating) {
      reason = `FILTERED: Volume surging (${volRatio.toFixed(2)}x) but price below local high ($${breakoutLevel.toFixed(6)})`;
    } 
    else if (isPriceBreakout && isVolumeAccelerating) {
      reason = "SIGNAL_CONFIRMED";
      enter = true;
    }

    // 5. Strength Scoring (Heuristic for logging)
    let strengthScore = 0;
    if (enter) {
      // 50% from Volume intensity
      const volPoints = Math.min(5, (volRatio / this.VOLUME_ACCEL_MULTIPLIER) * 2);
      // 50% from Breakout extension
      const priceExtension = (currentCandle.close - breakoutLevel) / breakoutLevel;
      const pricePoints = Math.min(5, priceExtension * 100); 
      
      strengthScore = Math.round(volPoints + pricePoints);
    }

    return {
      enter,
      breakoutLevel,
      strengthScore: Math.min(10, strengthScore),
      reason
    };
  }
}
