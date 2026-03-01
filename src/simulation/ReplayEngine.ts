import type { Candle } from "../types/MarketTypes.js";
import type { Position, TradeResult } from "../types/TradeTypes.js";
import type { Regime } from "../core/RegimeEngine.js";

import { CONFIG } from "../config.js";
import { EntryEngine } from "../core/EntryEngine.js";
import { PositionSizer } from "../core/PositionSizer.js";
import { ExitEngine, type ExitDecision } from "../core/ExitEngine.js";
import { ScalingEngine } from "../core/ScalingEngine.js";
import { RegimeEngine } from "../core/RegimeEngine.js";
import { PortfolioRiskManager } from "../risk/PortfolioRiskManager.js";
import { TradeLogger } from "./TradeLogger.js";

export class ReplayEngine {
  private portfolioSol: number;
  private readonly riskManager: PortfolioRiskManager;
  public history: TradeResult[] = [];
  private activePosition: Position | null = null;
  private solPrice: number = 140;
  private dailyLosses: number = 0;

  constructor(initialSol: number) {
    this.portfolioSol = initialSol;
    this.riskManager = new PortfolioRiskManager(initialSol * 140);
  }

  public run(candles: Candle[], simBreadth: number = 5): void {
    const LOOKBACK = 10;

    for (let i = LOOKBACK; i < candles.length; i++) {
      const current = candles[i]!;
      const lastClosedCandle = candles[i - 1]!;
      const p5mCandle = candles[i - 5];
      if (!p5mCandle) continue;

      const liq5mAgo = p5mCandle.liquidity;
      const regime: Regime = RegimeEngine.calculate(simBreadth, this.dailyLosses, 0.04);

      if (this.activePosition) {
        const decision: ExitDecision = ExitEngine.evaluate(
          this.activePosition, current.close, lastClosedCandle,
          { current: current.liquidity, entry: this.activePosition.initialLiquidity },
          { buy2m: 100, sell2m: 100 },
          Math.floor((current.timestamp - this.activePosition.openTime) / 60000),
          this.activePosition.breakoutLevel
        );

        if (decision.action === 'EXIT') {
          this.closePosition(current.close, current.timestamp, decision.reason);
          continue;
        }

        if (decision.updatedStop && decision.updatedStop > this.activePosition.stopPrice) {
          this.activePosition = { ...this.activePosition, stopPrice: decision.updatedStop };
        }
      } 
      
      if (!this.activePosition && this.riskManager.canTrade(0, 0)) {
        const signal = EntryEngine.evaluate(candles.slice(i-10, i+1), 24, liq5mAgo);
        
        if (signal.enter) {
          const type = current.liquidity <= 200000 ? "IGNITION" : "MODERATE";
          const sizing = PositionSizer.calculateFixedSolSize(type, current.liquidity, this.solPrice, this.portfolioSol);

          if (!sizing.isRejected) {
            this.activePosition = {
              symbol: "SIM",
              buyAmountSol: sizing.buyAmountSol,
              entryPrice: current.close,
              quantity: (sizing.buyAmountSol * this.solPrice) / current.close,
              stopPrice: current.close * (1 - CONFIG.INITIAL_STOP_LOSS_PCT),
              stage: 1,
              riskAmount: sizing.riskAmountSol,
              peakPrice: current.close,
              openTime: current.timestamp,
              lastPrice: current.close,
              breakoutLevel: current.close,
              initialLiquidity: current.liquidity
            };
          }
        }
      }
    }
  }

  private closePosition(price: number, time: number, reason: string): void {
    if (!this.activePosition) return;
    const exitValueSol = (price / this.activePosition.entryPrice) * this.activePosition.buyAmountSol;
    const pnlSol = exitValueSol - this.activePosition.buyAmountSol;

    this.history.push({
      entryPrice: this.activePosition.entryPrice,
      exitPrice: price,
      Rmultiple: pnlSol / this.activePosition.riskAmount,
      duration: time - this.activePosition.openTime,
      maxFavorableExcursion: 0, 
      maxAdverseExcursion: 0,
      stageReached: this.activePosition.stage,
      realizedSlippage: 0.005,
      pnlSol: pnlSol
    });

    this.portfolioSol += pnlSol;
    this.riskManager.updatePnL(pnlSol * 140);
    if (pnlSol < 0) this.dailyLosses++;
    else this.dailyLosses = 0;
    this.activePosition = null;
  }

  public getStats() {
    return { finalBalanceSol: this.portfolioSol, totalTrades: this.history.length };
  }
}
