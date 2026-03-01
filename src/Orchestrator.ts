import { CONFIG } from "./config.js";
import type { Candle } from "./types/MarketTypes.js";
import type { Position } from "./types/TradeTypes.js";
import type { IExecutionLayer, ExecutionOptions } from "./execution/interfaces/IExecutionLayer.js";

// Core Engine Imports
import { EntryEngine } from "./core/EntryEngine.js";
import { PositionSizer } from "./core/PositionSizer.js";
import { ExitEngine, type ExitDecision } from "./core/ExitEngine.js";
import { SafetyFilter } from "./core/SafetyFilter.js";
import { StalenessEngine } from "./core/StalenessEngine.js";
import { ScalingEngine } from "./core/ScalingEngine.js";
import { RegimeEngine } from "./core/RegimeEngine.js";

// Infrastructure
import { PortfolioRiskManager } from "./risk/PortfolioRiskManager.js";
import { LiquidityMonitor } from "./execution/LiquidityMonitor.js";
import { ExecutionAuditor } from "./execution/ExecutionAuditor.js";
import { QuoteValidator } from "./execution/QuoteValidator.js";
import { TradeLogger } from "./simulation/TradeLogger.js";
import { MarketScanner } from "./providers/MarketScanner.js";

export enum EngineType { IGNITION = "IGNITION", MODERATE = "MODERATE" }

export class Orchestrator {
  public activePositions: Map<string, Position & { type: EngineType }> = new Map();
  private staleCounters: Map<string, number> = new Map();
  private isProcessingExit: boolean = false; 
  private readonly riskManager: PortfolioRiskManager;
  private realizedPnLSol: number = 0;

  constructor(private initialSol: number, private executionLayer: IExecutionLayer) {
    this.riskManager = new PortfolioRiskManager(initialSol * 140);
  }

  public async monitorSafety(tokenAddress: string, price: number, liquidity: number): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position || this.isProcessingExit || price <= 0) return;

    const updatedPos = { ...position, lastPrice: price };
    this.activePositions.set(tokenAddress, updatedPos);

    const provider = (global as any).provider;
    const volDelta = provider?.getVolumeDelta?.(tokenAddress) || { buy2m: 1, sell2m: 1 };
    const history: Candle[] = provider?.getRecentCandles(tokenAddress, 2) || [];

    const decision: ExitDecision = ExitEngine.evaluate(
      updatedPos, price, history[0] || ({ close: price } as Candle),
      { current: liquidity, entry: position.initialLiquidity },
      volDelta, Math.floor((Date.now() - position.openTime) / 60000), position.breakoutLevel
    );

    if (decision.action === 'EXIT') {
      await this.closePosition(tokenAddress, price, decision.reason);
      return;
    }

    let finalPos = { ...updatedPos, peakPrice: Math.max(position.peakPrice, price) };
    if (decision.updatedStop && decision.updatedStop > position.stopPrice) {
      finalPos.stopPrice = decision.updatedStop;
    }
    this.activePositions.set(tokenAddress, finalPos);
  }

  public async tick(tokenAddress: string, current: Candle, redis: any, breadth: number): Promise<{ prune: boolean }> {
    if (this.isProcessingExit) return { prune: false };
    const position = this.activePositions.get(tokenAddress);
    const id = position?.symbol || (global as any).provider?.getSymbol(tokenAddress) || tokenAddress.slice(0, 4);

    if (position) {
      const unrealized = (current.close / position.entryPrice) * position.buyAmountSol - position.buyAmountSol;
      process.stdout.write(`\r[ACTIVE] ${position.symbol} (${position.type}) | PnL: ${unrealized.toFixed(4)} SOL | Stop: $${position.stopPrice.toFixed(6)} `);
      return { prune: false };
    }

    const history: Candle[] = await redis.getHistory(tokenAddress);
    if (history.length >= 7) {
      const startTime = this.staleCounters.get(tokenAddress + "_start") || Date.now();
      if (!this.staleCounters.has(tokenAddress + "_start")) this.staleCounters.set(tokenAddress + "_start", Date.now());
      const ageMins = (Date.now() - startTime) / 60000;

      if (ageMins > 3) {
          const atr = history.slice(-5).reduce((s, c) => s + (c.high - c.low), 0) / 5;
          if (StalenessEngine.isStale(history, current.close, atr)) {
              MarketScanner.addToCooldown(tokenAddress);
              this.staleCounters.delete(tokenAddress + "_start");
              return { prune: true };
          }
      }

      const p5mCandle = history[history.length - 6];
      if (!p5mCandle) return { prune: false };

      const signal = EntryEngine.evaluate(history, 24, p5mCandle.liquidity);
      if (signal.enter) {
        await this.evaluateEntry(tokenAddress, current, history, signal.mode as EngineType, signal.reason);
      } else if (!signal.reason.includes("BUILDING")) {
        process.stdout.write(`\r[EVAL] ${id.padEnd(8)} | ${signal.reason.padEnd(30)} `);
      }
    }
    return { prune: false };
  }

  private async evaluateEntry(tokenAddress: string, current: Candle, history: Candle[], mode: EngineType, reason: string): Promise<void> {
    const activeOfType = Array.from(this.activePositions.values()).filter(p => p.type === mode).length;
    const maxAllowed = mode === EngineType.IGNITION ? CONFIG.MAX_CONCURRENT_IGNITION : CONFIG.MAX_CONCURRENT_MODERATE;
    if (activeOfType >= maxAllowed) return;

    if (!SafetyFilter.isSafe(tokenAddress, history, current.liquidity)) return;

    const sizing = PositionSizer.calculateFixedSolSize(mode, current.liquidity, 140, 10.0);

    if (!sizing.isRejected) {
      const result = await this.executionLayer.executeBuy({ 
        tokenAddress, amountSol: sizing.buyAmountSol, marketPrice: current.close, slippageTolerance: 0.02 
      });

      this.activePositions.set(tokenAddress, { 
        symbol: (global as any).provider.getSymbol(tokenAddress), 
        type: mode, 
        buyAmountSol: sizing.buyAmountSol,
        entryPrice: result.filledPrice, 
        quantity: result.filledQuantity, 
        stopPrice: result.filledPrice * (1 - CONFIG.INITIAL_STOP_LOSS_PCT), 
        riskAmount: sizing.riskAmountSol, 
        peakPrice: result.filledPrice, 
        openTime: Date.now(), 
        lastPrice: result.filledPrice,
        breakoutLevel: current.close, 
        initialLiquidity: current.liquidity,
        stage: 1
      });
      
      TradeLogger.log(`[ENTRY] ${mode} | Size: ${sizing.buyAmountSol} SOL | Trigger: ${reason}`, 'TRADE');
    }
  }

  private async closePosition(tokenAddress: string, price: number, reason: string): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position || this.isProcessingExit) return;
    this.isProcessingExit = true;
    try {
      const result = await this.executionLayer.executeSell({ tokenAddress, quantity: position.quantity, slippageTolerance: 0.02, marketPrice: price });
      const exitValueSol = (result.filledPrice / position.entryPrice) * position.buyAmountSol;
      const pnlSol = exitValueSol - position.buyAmountSol;
      this.realizedPnLSol += pnlSol;
      this.riskManager.updatePnL(pnlSol * 140);
      
      TradeLogger.logTrade({
        symbol: position.symbol, entryPrice: position.entryPrice, exitPrice: result.filledPrice,
        Rmultiple: pnlSol / position.riskAmount, reason, pnlSol: pnlSol
      });
      this.activePositions.delete(tokenAddress);
      this.staleCounters.delete(tokenAddress + "_start");
    } finally { this.isProcessingExit = false; }
  }

  public getFullPerformanceStatus() {
    let unrealized = 0;
    for (const pos of this.activePositions.values()) {
        unrealized += (pos.lastPrice / pos.entryPrice) * pos.buyAmountSol - pos.buyAmountSol;
    }
    return {
      realizedPnL: this.realizedPnLSol,
      unrealizedPnL: unrealized,
      totalPnL: this.realizedPnLSol + unrealized,
      activeTrades: this.activePositions.size
    };
  }

  public getFullStatus() { return this.riskManager.getStatus(); }
  
  public logHourlyPortfolioAudit(): void {
    const perf = this.getFullPerformanceStatus();
    TradeLogger.log(`PORT_AUDIT | Total: ${perf.totalPnL.toFixed(4)} SOL | Active: ${perf.activeTrades}`, 'INFO');
  }
}
