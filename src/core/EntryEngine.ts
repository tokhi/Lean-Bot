import { CONFIG } from "../config.js";
import type { Candle } from "../types/MarketTypes.js";

export class EntryEngine {
  /**
   * evaluate V5.5
   * Logic: assigned mode based on liquidity, checks for breakouts OR reversals.
   */
  public static evaluate(
    history: Candle[],
    tokenAgeHours: number,
    liquidity5mAgo: number
  ): { enter: boolean; reason: string; mode: "IGNITION" | "MODERATE" } {
    const current = history[history.length - 1]!;
    const mode = current.liquidity <= CONFIG.IGNITION_LIQ_UPPER ? "IGNITION" : "MODERATE";
    
    if (history.length < 7) return { enter: false, reason: `BUILD_MEM_${history.length}/7`, mode };

    // --- REQUIREMENT 7: AGGRESSIVE SPIKE DETECTION ---
    const avgVol = history.slice(-10, -1).reduce((s, c) => s + c.volume, 0) / 10;
    const volMult = current.volume / (avgVol || 1);
    const spikeMove = ((current.close - current.open) / current.open) * 100;
    
    if (mode === "IGNITION" && volMult >= 2.5 && spikeMove >= 2.0) {
        return { enter: true, reason: "AGGRESSIVE_SPIKE", mode };
    }

    // --- REQUIREMENT 5: DOWNTREND RECOVERY ---
    const windowMax = Math.max(...history.slice(-10).map(c => c.high));
    const localLow = Math.min(...history.slice(-10).map(c => c.low));
    const bouncePct = ((current.close - localLow) / (localLow || 1)) * 100;
    const isReversal = bouncePct > CONFIG.REVERSAL_VOLATILITY_THRESHOLD && current.close > windowMax * 0.7;

    // Standard Breakout
    const prevHigh = Math.max(...history.slice(-7, -1).map(c => c.high));
    const isBreakout = current.close > prevHigh;

    if (!isBreakout && !isReversal) {
        return { enter: false, reason: "NO_STRUCTURE", mode };
    }

    // Volatility/Volume Check
    const minVol = mode === "IGNITION" ? CONFIG.IGNITION_VOLATILITY_MIN : CONFIG.MODERATE_VOLATILITY_MIN;
    const pChange = Math.abs((current.close - history[history.length - 6]!.close) / history[history.length - 6]!.close) * 100;
    const liqGrowth = (current.liquidity - liquidity5mAgo) / (liquidity5mAgo || 1);

    if (liqGrowth < CONFIG.MIN_LIQUIDITY_GROWTH_5M) return { enter: false, reason: `LIQ_STAGNANT(${(liqGrowth * 100).toFixed(1)}%)`, mode };
    if (pChange < minVol) return { enter: false, reason: `LOW_VOL(${pChange.toFixed(1)}%)`, mode };
    if (volMult < CONFIG.MIN_VOLUME_MULTIPLIER) return { enter: false, reason: `LOW_VOL_MULT(${volMult.toFixed(1)}x)`, mode };

    return { enter: true, reason: isBreakout ? "BREAKOUT" : "REVERSAL", mode };
  }
}
