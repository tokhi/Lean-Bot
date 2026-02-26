import type { Candle } from "../types/MarketTypes.js";
import type { Position, TradeResult } from "../types/TradeTypes.js";
import type { Regime } from "../core/RegimeEngine.js";

import { EntryEngine } from "../core/EntryEngine.js";
import { PositionSizer } from "../core/PositionSizer.js";
import { ExitEngine } from "../core/ExitEngine.js";
import { ScalingEngine } from "../core/ScalingEngine.js";
import { RegimeEngine } from "../core/RegimeEngine.js";
import { PortfolioRiskManager } from "../risk/PortfolioRiskManager.js";

export class ReplayEngine {
  private portfolio: number;
  private readonly riskPercent: number;
  private readonly riskManager: PortfolioRiskManager;
  
  private activePosition: Position | null = null;
  private history: TradeResult[] = [];
  private dailyLosses: number = 0;

  constructor(initialBalance: number, riskPercent: number = 0.015) {
    this.portfolio = initialBalance;
    this.riskPercent = riskPercent;
    this.riskManager = new PortfolioRiskManager(initialBalance);
  }

  public run(candles: Candle[], simBreadth: number = 5): void {
    const LOOKBACK = 6;

    for (let i = LOOKBACK; i < candles.length; i++) {
      const current = candles[i];
      if (!current) continue; 

      const slice = candles.slice(i - LOOKBACK, i + 1);
      const regime: Regime = RegimeEngine.calculate(simBreadth, this.dailyLosses, 0.04);

      if (this.activePosition) {
        // 1. Check Stop Loss
        if (current.low <= this.activePosition.stopPrice) {
          this.closePosition(this.activePosition.stopPrice, current.timestamp);
          continue; 
        }

        // 2. Trailing Stop Update
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
          this.activePosition = { ...this.activePosition, peakPrice: updatedPeak, stopPrice: newStop };
        }

        // 3. Scaling Logic
        const scaling = ScalingEngine.evaluate(this.activePosition, current.close, this.portfolio, current.liquidity);
        if (scaling.addQuantity > 0) {
          console.log(`[SCALING] Stage ${this.activePosition.stage} -> ${scaling.newStage} | Adding: ${scaling.addQuantity.toFixed(2)} units`);
          this.activePosition = {
            ...this.activePosition,
            quantity: this.activePosition.quantity + scaling.addQuantity,
            stage: scaling.newStage as 1 | 2 | 3
          };
        }
      } 
      
      // 4. Entry Logic
      if (!this.activePosition && this.riskManager.canTrade()) {
        const signal = EntryEngine.evaluate(slice, regime, 150000);
        
        if (signal.enter) {
          const sizing = PositionSizer.calculateStage1Size(this.portfolio, this.riskPercent, current.close, current.close * 0.90, current.liquidity);

          if (!sizing.rejected && sizing.quantity > 0) {
            console.log(`[ENTRY] Stage 1 | Price: ${current.close} | Qty: ${sizing.quantity.toFixed(2)} | Slippage: ${(sizing.expectedSlippage * 100).toFixed(4)}%`);
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

  private closePosition(exitPrice: number, exitTime: number): void {
    if (!this.activePosition) return;
    const pnl = (exitPrice - this.activePosition.entryPrice) * this.activePosition.quantity;
    const rMultiple = pnl / this.activePosition.riskAmount;

    console.log(`[EXIT] Price: ${exitPrice.toFixed(2)} | PnL: $${pnl.toFixed(2)} | R: ${rMultiple.toFixed(2)}`);

    this.history.push({
      entryPrice: this.activePosition.entryPrice,
      exitPrice: exitPrice,
      Rmultiple: rMultiple,
      duration: exitTime - this.activePosition.openTime,
      maxFavorableExcursion: this.activePosition.peakPrice / this.activePosition.entryPrice,
      maxAdverseExcursion: 0 
    });

    this.portfolio += pnl;
    this.riskManager.updatePnL(pnl);
    this.dailyLosses = pnl < 0 ? this.dailyLosses + 1 : 0;
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
