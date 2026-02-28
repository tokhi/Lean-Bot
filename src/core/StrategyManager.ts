import { CONFIG } from "../config.js";
import { EngineType } from "../types/MarketTypes.js";

export class StrategyManager {
  /**
   * IGNITION ENGINE (Spike Hunter)
   */
  public static isSpikeCandidate(history: any[]): boolean {
    const curr = history[history.length - 1];
    const prev = history[history.length - 2];
    
    // 1) Volume Acceleration
    const volAccel = curr.volume > prev.volume && curr.volMult >= 2.5;
    // 2) Price Impulse
    const priceImpulse = (curr.high - curr.low) / curr.low >= 0.02 && curr.close > prev.high;
    // 3) Liquidity & Volatility
    const liqInflow = curr.liqGrowth >= 0.05;
    const volatility = curr.volatility5m >= 0.03;

    if (!volAccel || !priceImpulse || !liqInflow || !volatility) return false;
    
    // Final check rejection
    if (curr.liquidity < 40000 || curr.liqDrain > 0.02 || curr.upperWickPct > 60) return false;

    return true;
  }

  /**
   * MODERATE ENGINE (Momentum Continuation)
   */
  public static isModerateCandidate(history: any[]): boolean {
    const curr = history[history.length - 1];
    const high15m = Math.max(...history.slice(-15).map(c => c.high));

    return curr.volMult >= 1.8 && 
           curr.volatility5m >= 0.025 && 
           curr.close > high15m && 
           curr.liqGrowth >= 0;
  }
}
