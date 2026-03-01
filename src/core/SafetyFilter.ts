import { TradeLogger } from "../simulation/TradeLogger.js";

export class SafetyFilter {
  private static blacklist: Set<string> = new Set();

  public static isSafe(mint: string, history: any[], currentLiq: number): boolean {
    if (this.blacklist.has(mint)) return false;

    const current = history[history.length - 1];
    const prev = history[history.length - 2];
    if (!current || !prev) return true;

    // REQUIREMENT 8: LIQUIDITY SCREENING
    if (currentLiq < 40000) return false;
    
    const liq5mAgo = history[history.length - 6]?.liquidity || currentLiq;
    const liqDrain = (liq5mAgo - currentLiq) / liq5mAgo;
    if (liqDrain > 0.10) {
        TradeLogger.log(`[ANTI-RUG] ${mint.slice(0,4)}: 10% Liquidity Drain Detected`, 'WARN');
        return false;
    }

    // CONCENTRATION & PUMP/DUMP
    const body = Math.abs(current.close - current.open);
    const upperWick = current.high - Math.max(current.open, current.close);
    if (upperWick > body * 0.7) {
        TradeLogger.log(`[ANTI-RUG] ${mint.slice(0,4)}: Excessive Upper Wick`, 'WARN');
        return false;
    }

    // BLACKLIST TRIGGER
    const priceDrop2m = (history[history.length - 3]?.close - current.close) / history[history.length - 3]?.close;
    if (priceDrop2m > 0.40 && liqDrain > 0.10) {
      this.blacklist.add(mint);
      TradeLogger.log(`!!! RUG DETECTED for ${mint}. Blacklisted.`, 'ERROR');
      return false;
    }

    return true;
  }
}
