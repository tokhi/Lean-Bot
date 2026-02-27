import type { Candle } from "../types/MarketTypes.js";

export interface EntrySignal {
  readonly enter: boolean;
  readonly breakoutLevel: number;
  readonly strengthScore: number;
  readonly reason: string; // Added for "Near-Miss" visibility
}

/**
 * EntryEngine V2.2 (With Near-Miss Logic)
 * 
 * Determines if Stage 1 criteria are met and provides detailed feedback 
 * when a trade is filtered out.
 */
export class EntryEngine {
  private static readonly LOOKBACK_PERIOD = 5;
  private static readonly VOLUME_ACCEL_MULTIPLIER = 3.0;

  public static evaluate(
    recentCandles: Candle[],
    regime: string,
    minLiquidity: number
  ): EntrySignal {
    if (recentCandles.length <= this.LOOKBACK_PERIOD) {
      return { enter: false, breakoutLevel: 0, strengthScore: 0, reason: "INITIALIZING_MEMORY" };
    }

    const currentCandle = recentCandles[recentCandles.length - 1]!;
    const previousCandles = recentCandles.slice(-(this.LOOKBACK_PERIOD + 1), -1);

    // 1. Calculations
    const breakoutLevel = Math.max(...previousCandles.map((c) => c.high));
    const avgVolume = previousCandles.reduce((sum, c) => sum + c.volume, 0) / this.LOOKBACK_PERIOD;
    const volRatio = currentCandle.volume / avgVolume;

    // 2. Logic Gates
    const isExpanding = regime === "EXPANSION";
    const isPriceBreakout = currentCandle.close > breakoutLevel;
    const isVolumeAccelerating = currentCandle.volume > avgVolume * this.VOLUME_ACCEL_MULTIPLIER;
    const hasLiquidity = currentCandle.liquidity >= minLiquidity;

    // 3. Near-Miss Attribution
    let reason = "WAITING_FOR_SIGNAL";
    if (!isExpanding) reason = `REGIME_MISMATCH: ${regime}`;
    else if (!hasLiquidity) reason = `INSUFFICIENT_LIQUIDITY: $${currentCandle.liquidity.toFixed(0)}`;
    else if (isPriceBreakout && !isVolumeAccelerating) {
      reason = `NEAR_MISS: Price Breakout ($${currentCandle.close.toFixed(6)}) but Volume weak (${volRatio.toFixed(1)}x < 3x)`;
    } 
    else if (!isPriceBreakout && isVolumeAccelerating) {
      reason = `NEAR_MISS: Volume Spike (${volRatio.toFixed(1)}x) but no Price Breakout`;
    }

    const enter = isExpanding && isPriceBreakout && isVolumeAccelerating && hasLiquidity;

    // 4. Score
    let strengthScore = 0;
    if (enter) {
      const volPoints = Math.min(5, (volRatio / this.VOLUME_ACCEL_MULTIPLIER) * 2);
      const priceExtension = (currentCandle.close - breakoutLevel) / breakoutLevel;
      const pricePoints = Math.min(5, priceExtension * 100);
      strengthScore = Math.round(volPoints + pricePoints);
      reason = "SIGNAL_CONFIRMED";
    }

    return { enter, breakoutLevel, strengthScore, reason };
  }
}
