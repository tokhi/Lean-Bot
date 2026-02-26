// 1. Type Imports (verbatimModuleSyntax)
import type { Candle } from "../types/MarketTypes.js";
import type { Position, TradeResult } from "../types/TradeTypes.js";
import type { Regime } from "../core/RegimeEngine.js";

// 2. Core Logic Imports
import { EntryEngine } from "../core/EntryEngine.js";
import { PositionSizer } from "../core/PositionSizer.js";
import { ExitEngine } from "../core/ExitEngine.js";
import { ScalingEngine } from "../core/ScalingEngine.js";
import { RegimeEngine } from "../core/RegimeEngine.js";
import { PortfolioRiskManager } from "../risk/PortfolioRiskManager.js";

/**
 * ReplayEngine V2.1 (Production-Ready Simulation)
 * Orchestrates deterministic simulation with Portfolio Heat and Atomic Partitioning simulation.
 */
export class ReplayEngine {
  private portfolio: number;
  private readonly riskPercent: number;
  private readonly riskManager: PortfolioRiskManager;
  
  private activePosition: Position | null = null;
  public history: TradeResult[] = []; // Public for Logger access in Main
  private dailyLosses: number = 0;

  constructor(initialBalance: number, riskPercent: number = 0.015) {
    this.portfolio = initialBalance;
    this.riskPercent = riskPercent;
    this.riskManager = new PortfolioRiskManager(initialBalance);
  }

  /**
   * Main Simulation Loop
   */
  public run(candles: Candle[], simBreadth: number = 5): void {
    const LOOKBACK = 6;

    for (let i = LOOKBACK; i < candles.length; i++) {
      const current = candles[i];
      if (!current) continue; 

      const slice = candles.slice(i - LOOKBACK, i + 1);
      
      // Calculate Market Regime
      const regime: Regime = RegimeEngine.calculate(simBreadth, this.dailyLosses, 0.04);

      // --- HANDLE OPEN POSITION ---
      if (this.activePosition) {
        // 1. Check Technical Stop Loss
        if (current.low <= this.activePosition.stopPrice) {
          this.closePosition(this.activePosition.stopPrice, current.timestamp);
          continue; 
        }

        // 2. Trailing Stop Update (ATR / Parabolic / Velocity)
        const updatedPeak = Math.max(this.activePosition.peakPrice, current.high);
        const newStop = ExitEngine.calculateUpdatedStop(
          { ...this.activePosition, peakPrice: updatedPeak },
          current.close,
          current.close * 0.05, 
          0.04,                 
          current.liquidity,
          current.timestamp
        );

        if (newStop > this.activePosition.stopPrice) {
          this.activePosition = { 
            ...this.activePosition, 
            peakPrice: updatedPeak, 
            stopPrice: newStop 
          };
        }

        // 3. Scaling Engine (Asymmetric Pyramiding)
        const scaling = ScalingEngine.evaluate(
          this.activePosition, 
          current.close, 
          this.portfolio, 
          current.liquidity
        );

        if (scaling.addQuantity > 0) {
          console.log(`[SCALING] Stage ${this.activePosition.stage} -> ${scaling.newStage} | Adding: ${scaling.addQuantity.toFixed(2)} units`);
          this.activePosition = {
            ...this.activePosition,
            quantity: this.activePosition.quantity + scaling.addQuantity,
            stage: scaling.newStage as 1 | 2 | 3
          };
        }
      } 
      
      // --- HANDLE NEW ENTRIES ---
      // Check Portfolio Heat: Current Trades = 0, Active Risk = 0 (for this 1-token sim)
      const canEnter = !this.activePosition && this.riskManager.canTrade(0, 0);

      if (canEnter) {
        const signal = EntryEngine.evaluate(slice, regime, 150000);
        
        if (signal.enter) {
          const sizing = PositionSizer.calculateStage1Size(
            this.portfolio,
            this.portfolio * this.riskPercent, 
            current.close,
            current.close * 0.90,
            current.liquidity
          );

          if (!sizing.rejected && sizing.quantity > 0) {
            console.log(`[ENTRY] Stage 1 | Price: ${current.close} | Qty: ${sizing.quantity.toFixed(2)} | Exp. Risk: $${sizing.effectiveRisk.toFixed(2)}`);
            this.activePosition = {
              entryPrice: current.close,
              quantity: sizing.quantity,
              stopPrice: current.close * 0.90,
              stage: 1,
              riskAmount: sizing.effectiveRisk,
              peakPrice: current.close,
              openTime: current.timestamp
            };
          }
        }
      }
    }
  }

  /**
   * Finalizes trade with Atomic Partitioning Tax simulation
   */
 private closePosition(exitPrice: number, exitTime: number): void {
    if (!this.activePosition) return;

    const pnl = (exitPrice - this.activePosition.entryPrice) * this.activePosition.quantity;
    const rMultiple = pnl / this.activePosition.riskAmount;

    this.history.push({
      entryPrice: this.activePosition.entryPrice,
      exitPrice: exitPrice,
      Rmultiple: rMultiple,
      duration: exitTime - this.activePosition.openTime,
      maxFavorableExcursion: this.activePosition.peakPrice / this.activePosition.entryPrice,
      maxAdverseExcursion: 0,
      stageReached: this.activePosition.stage // Capture the final stage before closing
    });

    this.portfolio += pnl;
    this.riskManager.updatePnL(pnl);
    
    if (pnl < 0) this.dailyLosses++;
    else this.dailyLosses = 0;

    this.activePosition = null;
  }

  public getStats() {
    const totalR = this.history.reduce((sum, h) => sum + h.Rmultiple, 0);
    return {
      finalBalance: this.portfolio,
      totalTrades: this.history.length,
      expectancyR: this.history.length === 0 ? 0 : totalR / this.history.length
    };
  }
}
