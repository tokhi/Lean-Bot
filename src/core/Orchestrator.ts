import type { MarketProvider } from "../types/MarketTypes.js";
import type { Position } from "../types/TradeTypes.js";
import { EntryEngine } from "./EntryEngine.js";
import { PositionSizer } from "./PositionSizer.js";
import { ExitEngine } from "./ExitEngine.js";
import { ScalingEngine } from "./ScalingEngine.js";
import { RegimeEngine } from "./RegimeEngine.js";
import { PortfolioRiskManager } from "../risk/PortfolioRiskManager.js";

/**
 * TradingOrchestrator V2.1
 * Coordinates the deterministic core engines with an external data provider.
 */
export class TradingOrchestrator {
  private activePositions: Map<string, Position> = new Map();
  private riskManager: PortfolioRiskManager;

  constructor(initialBalance: number) {
    this.riskManager = new PortfolioRiskManager(initialBalance);
  }

  /**
   * The "Tick" function called on every price update.
   * Logic is strictly deterministic based on the provided data.
   */
  public onTick(tokenAddress: string, provider: MarketProvider): void {
    const candles = provider.getRecentCandles(tokenAddress, 7);
    const current = candles[candles.length - 1];
    if (!current) return;

    const position = this.activePositions.get(tokenAddress);

    // 1. GLOBAL REGIME CHECK
    const regime = RegimeEngine.calculate(
      provider.getGlobalBreadth(),
      0, // Recent losses would be tracked via a separate state manager
      0.04
    );

    // 2. MANAGE OPEN POSITION
    if (position) {
      // A. Check Exit
      if (current.low <= position.stopPrice) {
        this.activePositions.delete(tokenAddress);
        console.log(`[ORCHESTRATOR] STOP HIT for ${tokenAddress}`);
        return;
      }

      // B. Update Trailing Stop
      const newStop = ExitEngine.calculateUpdatedStop(
        position,
        current.close,
        current.close * 0.05, // ATR mock
        0.04,
        current.liquidity,
        Date.now()
      );
      
      if (newStop > position.stopPrice) {
        this.activePositions.set(tokenAddress, { ...position, stopPrice: newStop, peakPrice: Math.max(position.peakPrice, current.high) });
      }

      // C. Check Scaling
      const scaling = ScalingEngine.evaluate(position, current.close, 1000, current.liquidity);
      if (scaling.addQuantity > 0) {
         this.activePositions.set(tokenAddress, { 
            ...position, 
            quantity: position.quantity + scaling.addQuantity, 
            stage: scaling.newStage as 1 | 2 | 3 
         });
      }
    } 
    
    // 3. CHECK NEW ENTRIES
    else if (this.riskManager.canTrade(this.activePositions.size, 0)) {
      const signal = EntryEngine.evaluate(candles, regime, 150000);
      if (signal.enter) {
        const sizing = PositionSizer.calculateStage1Size(1000, 15, current.close, current.close * 0.90, current.liquidity);
        if (!sizing.rejected) {
          this.activePositions.set(tokenAddress, {
            entryPrice: current.close,
            quantity: sizing.quantity,
            stopPrice: current.close * 0.90,
            stage: 1,
            riskAmount: sizing.effectiveRisk,
            peakPrice: current.close,
            openTime: Date.now()
          });
          console.log(`[ORCHESTRATOR] NEW ENTRY: ${tokenAddress}`);
        }
      }
    }
  }
}
