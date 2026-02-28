// 1. Strict Type Imports (verbatimModuleSyntax)
import type { Candle } from "../types/MarketTypes.js";
import type { Position, TradeResult } from "../types/TradeTypes.js";
import type { Regime } from "../core/RegimeEngine.js";

// 2. Logic Imports
import { EntryEngine } from "../core/EntryEngine.js";
import { PositionSizer } from "../core/PositionSizer.js";
import { ExitEngine, type ExitDecision } from "../core/ExitEngine.js";
import { ScalingEngine } from "../core/ScalingEngine.js";
import { RegimeEngine } from "../core/RegimeEngine.js";
import { PortfolioRiskManager } from "../risk/PortfolioRiskManager.js";
import { TradeLogger } from "./TradeLogger.js";

/**
 * ReplayEngine V4.2
 * 
 * Logic:
 * 1. Simulates the Dual-Engine strategy (Ignition vs Moderate) based on liquidity.
 * 2. Implements Volatility-Adaptive sizing (6th/7th args in PositionSizer).
 * 3. Tracks simulation expectancy and R-multiples for validation.
 */
export class ReplayEngine {
  private portfolioSol: number;
  private readonly riskManager: PortfolioRiskManager;
  
  public history: TradeResult[] = [];
  private activePosition: Position | null = null;
  private solPrice: number = 140; // Simulated SOL price for USD math
  private dailyLosses: number = 0;

  constructor(initialSol: number) {
    this.portfolioSol = initialSol;
    // Risk Manager tracks internal dollar PnL for drawdown logic
    this.riskManager = new PortfolioRiskManager(initialSol * 140);
  }

  /**
   * Main Simulation Loop
   */
  public run(candles: Candle[], simBreadth: number = 5): void {
    const LOOKBACK = 10;

    for (let i = LOOKBACK; i < candles.length; i++) {
      const current = candles[i];
      if (!current) continue; 

      const slice = candles.slice(i - LOOKBACK, i + 1);
      const lastClosedCandle = candles[i - 1]!;
      const liq5mAgo = candles[i - 5]?.liquidity || current.liquidity;
      
      // Determine Market Regime
      const regime: Regime = RegimeEngine.calculate(simBreadth, this.dailyLosses, 0.04);

      // Handle Cooldown Reset (Simulation Logic)
      if (!this.activePosition && regime === "HIBERNATE" && this.dailyLosses >= 3) {
          if (i % 40 === 0) {
              TradeLogger.log(`[SYSTEM] Cooldown Expired. Resetting Circuit Breaker.`, 'INFO');
              this.dailyLosses = 0;
          }
      }

      // --- 1. EVALUATE OPEN POSITION ---
      if (this.activePosition) {
        // Mock Volume Delta for simulation (assume neutral pressure)
        const mockVolDelta = { buy2m: 100, sell2m: 100 };
        
        const decision: ExitDecision = ExitEngine.evaluate(
          this.activePosition,
          current.close,
          lastClosedCandle,
          { current: current.liquidity, entry: this.activePosition.initialLiquidity },
          mockVolDelta,
          Math.floor((current.timestamp - this.activePosition.openTime) / 60000),
          this.activePosition.breakoutLevel
        );

        if (decision.action === 'EXIT') {
          this.closePosition(current.close, current.timestamp, decision.reason);
          continue;
        }

        // Apply Trailing Stop Ratchet
        if (decision.updatedStop && decision.updatedStop > this.activePosition.stopPrice) {
          this.activePosition = { ...this.activePosition, stopPrice: decision.updatedStop };
        }

        // Apply Scaling Logic
        const currentBalUsd = this.portfolioSol * this.solPrice;
        const scaling = ScalingEngine.evaluate(this.activePosition, current.close, currentBalUsd, current.liquidity);
        
        if (scaling.addQuantity > 0) {
          this.activePosition = {
            ...this.activePosition,
            quantity: this.activePosition.quantity + scaling.addQuantity,
            stage: scaling.newStage as 1 | 2 | 3
          };
        }
      } 
      
      // --- 2. EVALUATE NEW ENTRY ---
      if (!this.activePosition && this.riskManager.canTrade(0, 0)) {
        // EntryEngine V4.0 Signature: (history, tokenAgeHours, liquidity5mAgo)
        const signal = EntryEngine.evaluate(slice, 24, liq5mAgo);
        
        if (signal.enter) {
          // Calculate 5m velocity for Adaptive Sizing
          const p5mEarlier = candles[i - 5]?.close || current.open;
          const pChange5m = ((current.close - p5mEarlier) / p5mEarlier) * 100;

          // Classification logic (Step 1.2 and Rule 7)
          // Ignition if liq < 200k, Moderate otherwise.
          const baseRiskSol = current.liquidity <= 200000 ? 0.15 : 0.20;

          // PositionSizer V4.2 Signature: 7 Arguments
          const sizing = PositionSizer.calculatePosition(
            this.solPrice, 
            current.close, 
            current.close * 0.90, // Initial 10% Stop
            current.liquidity, 
            this.portfolioSol,
            pChange5m,
            baseRiskSol // The 7th Argument
          );

          if (!sizing.isRejected && sizing.quantity > 0) {
            this.activePosition = {
              symbol: "SIM",
              entryPrice: current.close,
              quantity: sizing.quantity,
              stopPrice: current.close * 0.90,
              stage: 1,
              riskAmount: sizing.riskUsd,
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

  /**
   * Finalizes position and calculates R-multiples
   */
  private closePosition(price: number, time: number, reason: string): void {
    if (!this.activePosition) return;
    const pnlUsd = (price - this.activePosition.entryPrice) * this.activePosition.quantity;
    const r = pnlUsd / this.activePosition.riskAmount;

    this.history.push({
      entryPrice: this.activePosition.entryPrice,
      exitPrice: price,
      Rmultiple: r,
      duration: time - this.activePosition.openTime,
      maxFavorableExcursion: 0, 
      maxAdverseExcursion: 0,
      stageReached: this.activePosition.stage,
      realizedSlippage: 0.005
    });

    // Update simulation SOL balance
    this.portfolioSol += (pnlUsd / this.solPrice);
    this.riskManager.updatePnL(pnlUsd);
    
    // Update circuit breaker
    if (pnlUsd < 0) this.dailyLosses++;
    else this.dailyLosses = 0;

    this.activePosition = null;
  }

  /**
   * Stats Reporting for Validation Phase (Step 9)
   */
  public getStats() {
    const totalR = this.history.reduce((s, h) => s + h.Rmultiple, 0);
    const wins = this.history.filter(h => h.Rmultiple > 0);
    const losses = this.history.filter(h => h.Rmultiple <= 0);

    return {
      finalBalanceSol: this.portfolioSol,
      totalTrades: this.history.length,
      winRate: (wins.length / (this.history.length || 1)) * 100,
      avgWinR: wins.reduce((s, h) => s + h.Rmultiple, 0) / (wins.length || 1),
      avgLossR: losses.reduce((s, h) => s + h.Rmultiple, 0) / (losses.length || 1),
      expectancyR: this.history.length === 0 ? 0 : totalR / this.history.length
    };
  }
}
