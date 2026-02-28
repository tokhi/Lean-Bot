import type { Position } from "../types/TradeTypes.js";
import type { Candle } from "../types/MarketTypes.js";

/**
 * Result of the exit evaluation logic.
 */
export interface ExitDecision {
  readonly action: 'EXIT' | 'HOLD';
  readonly reason: string;
  readonly updatedStop?: number; // Optional property for stop-loss ratcheting
}

/**
 * ExitEngine V4.1 (Predator)
 * 
 * Implements asymmetric exits:
 * 1. Hard Stop ($1.0R Floor)
 * 2. Liquidity Velocity (3% Drop + Sell Pressure)
 * 3. Structural Invalidation (Body Close < Breakout)
 * 4. Early R-Failure (-0.4R in 3m)
 * 5. Profit Protection (BE at 0.8R)
 */
export class ExitEngine {
  public static evaluate(
    position: Position, 
    currentPrice: number, 
    lastCandle: Candle,
    liq: { current: number; entry: number },
    vol: { buy2m: number; sell2m: number },
    candlesSinceEntry: number,
    breakoutLevel: number
  ): ExitDecision {
    
    const unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity;
    const currentR = unrealizedPnL / position.riskAmount;

    // --- 1. HARD STOP (The absolute floor) ---
    if (currentPrice <= position.stopPrice) {
      return { action: 'EXIT', reason: 'HARD_STOP_HIT' };
    }

    // --- 2. LIQUIDITY VELOCITY (3% Drop + Net Sell Vol) ---
    const liqDrop = (liq.entry - liq.current) / liq.entry;
    if (liqDrop >= 0.03 && vol.sell2m > vol.buy2m && currentPrice < position.lastPrice) {
      return { action: 'EXIT', reason: 'LIQUIDITY_DRAIN_VELOCITY' };
    }

    // --- 3. STRUCTURAL FAILURE (Body Close Invalidation) ---
    // Only valid in first 5 mins. If the candle closes back below breakout.
    if (candlesSinceEntry <= 5 && lastCandle.close < breakoutLevel) {
      return { action: 'EXIT', reason: 'STRUCTURAL_CLOSE_FAILURE' };
    }

    // --- 4. EARLY R-FAILURE ---
    if (candlesSinceEntry <= 3 && currentR < -0.4) {
      return { action: 'EXIT', reason: 'EARLY_MOMENTUM_EXHAUSTION' };
    }

    // --- 5. TRAILING & PROFIT RATCHET ---
    // Rule: Move to BE at 0.8R
    if (currentR >= 0.8 && position.stopPrice < position.entryPrice) {
        return { 
          action: 'HOLD', 
          reason: 'RATCHET_TO_BE', 
          updatedStop: position.entryPrice 
        };
    }

    return { action: 'HOLD', reason: 'CONTINUE_TREND' };
  }
}
