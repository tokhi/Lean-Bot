// 1. Verbatim module syntax requires 'import type'
import type { Candle } from "../types/MarketTypes.js";

export interface EntrySignal {
  readonly enter: boolean;
  readonly breakoutLevel: number;
  readonly strengthScore: number; 
}

export class EntryEngine {
  private static readonly LOOKBACK_PERIOD = 5;
  private static readonly VOLUME_ACCEL_MULTIPLIER = 3.0;

  public static evaluate(
    recentCandles: Candle[],
    regime: "EXPANSION" | "CHOPPY" | "HIBERNATE",
    minLiquidity: number
  ): EntrySignal {
    if (recentCandles.length <= this.LOOKBACK_PERIOD) {
      return { enter: false, breakoutLevel: 0, strengthScore: 0 };
    }

    // 2. Handle noUncheckedIndexedAccess: currentCandle is Candle | undefined
    const currentCandle = recentCandles[recentCandles.length - 1];
    if (!currentCandle) {
      return { enter: false, breakoutLevel: 0, strengthScore: 0 };
    }

    const previousCandles = recentCandles.slice(
      -(this.LOOKBACK_PERIOD + 1),
      -1
    );

    const isExpanding = regime === "EXPANSION";

    const breakoutLevel = Math.max(...previousCandles.map((c) => c.high));
    const isPriceBreakout = currentCandle.close > breakoutLevel;

    const avgVolume =
      previousCandles.reduce((sum, c) => sum + c.volume, 0) /
      this.LOOKBACK_PERIOD;
    
    const isVolumeAccelerating =
      currentCandle.volume > avgVolume * this.VOLUME_ACCEL_MULTIPLIER;

    const hasLiquidity = currentCandle.liquidity >= minLiquidity;

    const enter =
      isExpanding && isPriceBreakout && isVolumeAccelerating && hasLiquidity;

    let strengthScore = 0;
    if (enter) {
      const volRatio = currentCandle.volume / avgVolume;
      const volPoints = Math.min(5, (volRatio / this.VOLUME_ACCEL_MULTIPLIER) * 2);

      const priceExtension = (currentCandle.close - breakoutLevel) / breakoutLevel;
      const pricePoints = Math.min(5, priceExtension * 100);

      strengthScore = Math.round(volPoints + pricePoints);
    }

    return {
      enter,
      breakoutLevel,
      strengthScore: Math.min(10, strengthScore),
    };
  }
}

/**
 * MOCK USAGE EXAMPLE
 * 
 * const mockCandles: Candle[] = [
 *   { timestamp: 1, open: 10, high: 12, low: 9, close: 11, volume: 100, liquidity: 300000 },
 *   { timestamp: 2, open: 11, high: 11.5, low: 10.5, close: 11, volume: 90, liquidity: 300000 },
 *   { timestamp: 3, open: 11, high: 12.5, low: 11, close: 12, volume: 110, liquidity: 300000 },
 *   { timestamp: 4, open: 12, high: 12.2, low: 11.8, close: 12.1, volume: 95, liquidity: 300000 },
 *   { timestamp: 5, open: 12.1, high: 12.4, low: 12, close: 12.3, volume: 105, liquidity: 300000 },
 *   { timestamp: 6, open: 12.3, high: 15, low: 12.3, close: 14.5, volume: 400, liquidity: 300000 }, // Current
 * ];
 * 
 * const signal = EntryEngine.evaluate(mockCandles, "EXPANSION", 200000);
 * 
 * // Result:
 * // enter: true (14.5 > 12.5 AND 400 > 100 * 3)
 * // breakoutLevel: 12.5
 * // strengthScore: ~7 (high volume accel + price extension)
 */
