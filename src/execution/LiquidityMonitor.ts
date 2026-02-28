import { TradeLogger } from "../simulation/TradeLogger.js";

export class LiquidityMonitor {
  private strikeCount: Map<string, number> = new Map();
  private readonly STRIKE_THRESHOLD = 3; 

  public shouldEmergencyExit(currentLiq: number, entryLiq: number, symbol: string): boolean {
    if (entryLiq <= 0) return false;
    const drop = (entryLiq - currentLiq) / entryLiq;

    // Trigger only on > 3% drop (V4.5 Rule 5.2)
    if (drop >= 0.03) {
      const count = (this.strikeCount.get(symbol) || 0) + 1;
      this.strikeCount.set(symbol, count);
      if (count >= this.STRIKE_THRESHOLD) return true;
    } else {
      this.strikeCount.set(symbol, 0);
    }
    return false;
  }
}
