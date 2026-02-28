import { CONFIG } from "../config.js";
import type { Candle } from "../types/MarketTypes.js";

export class EntryEngine {
  public static evaluate(
    history: Candle[],
    tokenAgeHours: number,
    liquidity5mAgo: number
  ): { enter: boolean; reason: string } {
    if (history.length < 7) return { enter: false, reason: `BUILDING_MEM_${history.length}/7` };

    const current = history[history.length - 1]!;
    const prevHigh = Math.max(...history.slice(-7, -1).map(c => c.high));
    
    // Age-aware thresholds
    let minVol = CONFIG.MIN_VOLATILITY_PERCENT;
    let minMult = CONFIG.MIN_VOLUME_MULTIPLIER;
    if (tokenAgeHours < 12) {
      minVol = 3.0;
      minMult = 2.5;
    }

    // Math Calculations
    const priceChange = ((current.close - history[history.length - 6]!.close) / history[history.length - 6]!.close) * 100;
    const volAvg = history.slice(-6, -1).reduce((a, b) => a + b.volume, 0) / 5;
    const volMult = current.volume / (volAvg || 1);
    const liqGrowth = (current.liquidity - liquidity5mAgo) / (liquidity5mAgo || 1);

    // --- DETAILED REJECTION LOGIC ---
    if (liqGrowth < CONFIG.MIN_LIQUIDITY_GROWTH_5M) {
      return { enter: false, reason: `LIQ_STAGNANT(${(liqGrowth * 100).toFixed(1)}% < ${CONFIG.MIN_LIQUIDITY_GROWTH_5M * 100}%)` };
    }
    
    if (current.close <= prevHigh) {
      return { enter: false, reason: `NO_BREAKOUT(Price $${current.close.toFixed(6)} <= High $${prevHigh.toFixed(6)})` };
    }

    if (Math.abs(priceChange) < minVol) {
      return { enter: false, reason: `LOW_VOLATILITY(${priceChange.toFixed(2)}% < ${minVol}%)` };
    }

    if (volMult < minMult) {
      return { enter: false, reason: `LOW_VOLUME(${volMult.toFixed(2)}x < ${minMult}x)` };
    }

    return { enter: true, reason: "IGNITION_CONFIRMED" };
  }
}
