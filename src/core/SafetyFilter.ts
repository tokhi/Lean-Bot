import { TradeLogger } from "../simulation/TradeLogger.js";

export class SafetyFilter {
  private static blacklist: Set<string> = new Set();

  public static isSafe(mint: string, history: any[], currentLiq: number, entryLiq: number = 0): boolean {
    if (this.blacklist.has(mint)) return false;

    const current = history[history.length - 1];
    const prev = history[history.length - 2];
    if (!current || !prev) return true;

    // 1 & 2) MIN LIQUIDITY & CONCENTRATION
    const volMult = current.volMult;
    if (currentLiq < 40000) return false;
    if (currentLiq < 60000 && volMult > 6) return false;

    // 3) LIQUIDITY INSTABILITY (5% drain in 2m)
    const liq2mAgo = history[history.length - 3]?.liquidity || currentLiq;
    const liqDrain2m = (liq2mAgo - currentLiq) / liq2mAgo;
    if (liqDrain2m > 0.05) return false;

    // 4) PUMP-AND-DUMP CANDLE
    if (prev.changePct > 25 && current.retracePct > 70) return false;

    // 5) PARABOLIC WICK
    if (current.upperWickPct > 70 && current.liqGrowth <= 0) return false;

    // 6) DEAD LIQUIDITY
    if (current.liqGrowth <= 0 && current.volMult < prev.volMult) return false;

    // 7) BLACKLIST TRIGGER
    const priceDrop2m = (history[history.length - 3]?.close - current.close) / history[history.length - 3]?.close;
    if (priceDrop2m > 0.40 && liqDrain2m > 0.10) {
      this.blacklist.add(mint);
      TradeLogger.log(`RUG_DETECTED for ${mint}. Blacklisting.`, 'ERROR');
      return false;
    }

    return true;
  }
}
