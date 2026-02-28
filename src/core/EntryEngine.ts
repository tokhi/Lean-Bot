import { CONFIG } from "../config.js";
import type { Candle } from "../types/MarketTypes.js";

export class EntryEngine {
  public static evaluate(
    history: Candle[],
    tokenAgeHours: number,
    liquidity5mAgo: number
  ): { enter: boolean; reason: string } {
    if (history.length < 7) return { enter: false, reason: "INIT_MEM" };

    const current = history[history.length - 1]!;
    const prevHigh = Math.max(...history.slice(-7, -1).map(c => c.high));
    
    // --- STEP 3: AGE-AWARE THRESHOLDS ---
    let minVol = CONFIG.MIN_VOLATILITY_PERCENT;
    let minMult = CONFIG.MIN_VOLUME_MULTIPLIER;

    if (tokenAgeHours < 12) {
      minVol = 3.0; // Stricter for new tokens
      minMult = 2.5;
    }

    const priceChange = ((current.close - history[history.length - 6]!.close) / history[history.length - 6]!.close) * 100;
    const volAvg = history.slice(-6, -1).reduce((a, b) => a + b.volume, 0) / 5;
    const volMult = current.volume / (volAvg || 1);

    // --- STEP 4: LIQUIDITY GROWTH ---
    const liqGrowth = (current.liquidity - liquidity5mAgo) / liquidity5mAgo;

    if (liqGrowth < CONFIG.MIN_LIQUIDITY_GROWTH_5M) return { enter: false, reason: `LOW_LIQ_GROWTH_${(liqGrowth * 100).toFixed(1)}%` };
    if (Math.abs(priceChange) < minVol) return { enter: false, reason: `LOW_VOLATILITY_${priceChange.toFixed(1)}%` };
    if (volMult < minMult) return { enter: false, reason: `LOW_VOLUME_${volMult.toFixed(1)}x` };
    if (current.close <= prevHigh) return { enter: false, reason: "NO_BREAKOUT" };

    return { enter: true, reason: "IGNITION_CONFIRMED" };
  }
}
