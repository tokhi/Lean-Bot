// 1. Types must use 'import type' for verbatimModuleSyntax
import type { Candle } from "../types/MarketTypes.js";
import type { Position, TradeResult } from "../types/TradeTypes.js";
import type { Regime } from "../core/RegimeEngine.js";

// 2. Logic modules use standard imports with .js extension
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

  public run(candles: Candle[]): void {
    const LOOKBACK = 6;

    for (let i = LOOKBACK; i < candles.length; i++) {
      // 3. Handle 'noUncheckedIndexedAccess' with explicit check
      const current = candles[i];
      if (!current) continue; 

      const slice = candles.slice(i - LOOKBACK, i + 1);

      const regime: Regime = RegimeEngine.calculate(5, this.dailyLosses, 0.04);

      if (this.activePosition) {
        if (current.low <= this.activePosition.stopPrice) {
          this.closePosition(this.activePosition.stopPrice, current.timestamp);
          continue; 
        }

        const updatedPeak = Math.max(this.activePosition.peakPrice, current.high);
        const newStop = ExitEngine.calculateUpdatedStop(
          { ...this.activePosition, peakPrice: updatedPeak },
          current.close,
          current.close * 0.05, 
          0.04,                 
          current.liquidity,
          current.timestamp
        );

        this.activePosition = {
          ...this.activePosition,
          peakPrice: updatedPeak,
          stopPrice: newStop
        };

        const scaling = ScalingEngine.evaluate(
          this.activePosition,
          current.close,
          this.portfolio,
          current.liquidity
        );

        if (scaling.addQuantity > 0) {
          this.activePosition = {
            ...this.activePosition,
            quantity: this.activePosition.quantity + scaling.addQuantity,
            stage: scaling.newStage as 1 | 2 | 3
          };
        }
      } 
      
      if (!this.activePosition && this.riskManager.canTrade()) {
        const signal = EntryEngine.evaluate(slice, regime, 150000);
        
        if (signal.enter) {
          const sizing = PositionSizer.calculateStage1Size(
            this.portfolio,
            this.riskPercent,
            current.close,
            current.close * 0.90,
            current.liquidity
          );

          if (!sizing.rejected && sizing.quantity > 0) {
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

    const result: TradeResult = {
      entryPrice: this.activePosition.entryPrice,
      exitPrice: exitPrice,
      Rmultiple: rMultiple,
      duration: exitTime - this.activePosition.openTime,
      maxFavorableExcursion: this.activePosition.peakPrice / this.activePosition.entryPrice,
      maxAdverseExcursion: 0 
    };

    this.history.push(result);
    this.portfolio += pnl;
    this.riskManager.updatePnL(pnl);
    
    if (pnl < 0) this.dailyLosses++;
    else this.dailyLosses = 0;

    this.activePosition = null;
  }

  public getStats() {
    const wins = this.history.filter(h => h.Rmultiple > 0);
    const losses = this.history.filter(h => h.Rmultiple <= 0);
    const winRate = (wins.length / this.history.length) || 0;
    
    // Constant for simulation visualization
    const R_UNIT_USD = 15;
    const grossProfit = wins.reduce((sum, h) => sum + (h.Rmultiple * R_UNIT_USD), 0);
    const grossLoss = Math.abs(losses.reduce((sum, h) => sum + (h.Rmultiple * R_UNIT_USD), 0));

    return {
      finalBalance: this.portfolio,
      winRate: winRate * 100,
      totalTrades: this.history.length,
      profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
      expectancyR: this.history.length === 0 ? 0 : this.history.reduce((sum, h) => sum + h.Rmultiple, 0) / this.history.length
    };
  }
}
