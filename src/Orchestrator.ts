import { CONFIG } from "./config.js";
import type { Candle } from "./types/MarketTypes.js";
import type { Position } from "./types/TradeTypes.js";
import type { IExecutionLayer } from "./execution/interfaces/IExecutionLayer.js";

// Core Engine Imports
import { EntryEngine } from "./core/EntryEngine.js";
import { PositionSizer } from "./core/PositionSizer.js";
import { ExitEngine, type ExitDecision } from "./core/ExitEngine.js";
import { SafetyFilter } from "./core/SafetyFilter.js";
import { StalenessEngine } from "./core/StalenessEngine.js";

// Infrastructure
import { PortfolioRiskManager } from "./risk/PortfolioRiskManager.js";
import { LiquidityMonitor } from "./execution/LiquidityMonitor.js";
import { ExecutionAuditor } from "./execution/ExecutionAuditor.js";
import { QuoteValidator } from "./execution/QuoteValidator.js";
import { TradeLogger } from "./simulation/TradeLogger.js";

export enum EngineType {
  IGNITION = "IGNITION",
  MODERATE = "MODERATE"
}

export class Orchestrator {
  private activePositions: Map<string, Position & { type: EngineType }> = new Map();
  private staleCounters: Map<string, number> = new Map();
  private isProcessingExit: boolean = false; 
  private readonly riskManager: PortfolioRiskManager;
  private readonly executionLayer: IExecutionLayer;
  private readonly liqMonitor: LiquidityMonitor;
  private tradeCountThisHour: number = 0;
  private lastHourReset: number = Date.now();

  constructor(initialSol: number, executionLayer: IExecutionLayer) {
    this.riskManager = new PortfolioRiskManager(initialSol * 140);
    this.executionLayer = executionLayer;
    this.liqMonitor = new LiquidityMonitor();
  }

  public async monitorSafety(tokenAddress: string, price: number, liquidity: number): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position || this.isProcessingExit) return;

    if (this.liqMonitor.shouldEmergencyExit(liquidity, position.initialLiquidity, position.symbol)) {
        await this.closePosition(tokenAddress, price, "LIQUIDITY_RUG_OR_DRAIN");
        return;
    }

    const provider = (global as any).provider;
    const volDelta = provider?.getVolumeDelta?.(tokenAddress) || { buy2m: 1, sell2m: 1 };
    const history = provider?.getRecentCandles(tokenAddress, 2) || [];

    const decision: ExitDecision = ExitEngine.evaluate(
      position,
      price,
      history[0] || { close: price } as Candle,
      { current: liquidity, entry: position.initialLiquidity },
      volDelta,
      Math.floor((Date.now() - position.openTime) / 60000),
      position.breakoutLevel
    );

    if (decision.action === 'EXIT') {
      await this.closePosition(tokenAddress, price, decision.reason);
      return;
    }

    let updatedPos = { ...position, lastPrice: price, peakPrice: Math.max(position.peakPrice, price) };
    if (decision.updatedStop && decision.updatedStop > position.stopPrice) {
      updatedPos.stopPrice = decision.updatedStop;
    }
    this.activePositions.set(tokenAddress, updatedPos);
  }

  public async tick(tokenAddress: string, current: Candle, history: Candle[], breadth: number): Promise<{ prune: boolean }> {
    if (this.isProcessingExit) return { prune: false };
    if (Date.now() - this.lastHourReset > 3600000) {
      this.tradeCountThisHour = 0;
      this.lastHourReset = Date.now();
    }

    const position = this.activePositions.get(tokenAddress);
    if (position) {
      await this.monitorSafety(tokenAddress, current.close, current.liquidity);
    } else {
      const isStale = StalenessEngine.isStale(history, current.close, current.close * 0.02);
      if (isStale) return { prune: true };
      await this.evaluateEntry(tokenAddress, current, history);
    }
    return { prune: false };
  }

  private async evaluateEntry(tokenAddress: string, current: Candle, history: Candle[]): Promise<void> {
    if (this.activePositions.size >= CONFIG.MAX_TOTAL_CONCURRENT) return;
    if (this.tradeCountThisHour >= CONFIG.MAX_TRADES_PER_HOUR) return;

    const type = current.liquidity <= CONFIG.IGNITION_LIQ_UPPER ? EngineType.IGNITION : EngineType.MODERATE;
    const activeOfType = Array.from(this.activePositions.values()).filter(p => p.type === type).length;
    const maxAllowed = type === EngineType.IGNITION ? CONFIG.MAX_CONCURRENT_IGNITION : CONFIG.MAX_CONCURRENT_MODERATE;
    
    if (activeOfType >= maxAllowed) return;

    const liq5mAgo = history[history.length - 6]?.liquidity || current.liquidity;
    const signal = EntryEngine.evaluate(history, 24, liq5mAgo);
    const symbol = (global as any).provider?.getSymbol(tokenAddress) || tokenAddress.slice(0,4);

    if (!signal.enter) {
        if (signal.reason.includes("FILTERED") || signal.reason.includes("LOW") || signal.reason.includes("NO")) {
            TradeLogger.log(`[NEAR MISS] ${symbol} | Reason: ${signal.reason}`, 'INFO');
        }
        return;
    }

    if (!SafetyFilter.isSafe(tokenAddress, history, current.liquidity)) {
        TradeLogger.log(`[SAFETY REJECT] ${symbol}: Failed Anti-Rug Shield`, 'WARN');
        return;
    }

    const solPrice = 140; 
    const baseRiskSol = type === EngineType.IGNITION ? CONFIG.RISK_IGNITION_SOL : CONFIG.RISK_MODERATE_SOL;
    
     // Calculate 5m price change for adaptive sizing
    const p5mEarlier = history[history.length - 6]?.close || current.open;
    const pChange5m = ((current.close - p5mEarlier) / p5mEarlier) * 100;

    const sizing = PositionSizer.calculatePosition(
    solPrice, 
    current.close, 
    current.close * 0.90, 
    current.liquidity, 
    1.0, // Assuming 1.0 SOL base for math
    pChange5m,
    baseRiskSol // Fixed: Passing 7th argument
    );
    if (!sizing.isRejected) {
      const validation = QuoteValidator.validate({
        amountUsd: sizing.quantity * current.close, poolLiquidity: current.liquidity,
        liquidity5mChange: (current.liquidity - liq5mAgo) / liq5mAgo,
        isRiskActive: this.riskManager.canTrade(this.activePositions.size, 0)
      });

      if (!validation.valid) {
          TradeLogger.log(`[FIREWALL] Blocked ${symbol}: ${validation.reason}`, 'WARN');
          return;
      }

      const result = await this.executionLayer.executeBuy({ 
        tokenAddress, amountUsd: sizing.quantity * current.close, 
        slippageTolerance: 0.02, marketPrice: current.close 
      });

      this.activePositions.set(tokenAddress, { 
        symbol, type, entryPrice: result.filledPrice, quantity: result.filledQuantity, 
        stopPrice: result.filledPrice * 0.90, stage: 1, riskAmount: sizing.riskUsd, 
        peakPrice: result.filledPrice, openTime: Date.now(), lastPrice: result.filledPrice,
        breakoutLevel: current.close, initialLiquidity: current.liquidity
      });
      
      this.tradeCountThisHour++;
      // FIXED: Logging specific risk unit used
      TradeLogger.log(`[ENTRY] ${type} ${symbol} | Price: $${result.filledPrice.toFixed(6)} | Risk: ${baseRiskSol} SOL`, 'TRADE');
    }
  }

  private async closePosition(tokenAddress: string, price: number, reason: string): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position) return;
    this.isProcessingExit = true;
    try {
      const result = await this.executionLayer.executeSell({ tokenAddress, quantity: position.quantity, slippageTolerance: 0.02, marketPrice: price });
      const finalPnl = (result.filledPrice - position.entryPrice) * result.filledQuantity;
      this.riskManager.updatePnL(finalPnl);
      
      TradeLogger.logTrade({
        symbol: position.symbol,
        entryPrice: position.entryPrice,
        exitPrice: result.filledPrice,
        Rmultiple: finalPnl / position.riskAmount,
        reason,
        pnlUsd: finalPnl
      });

      this.activePositions.delete(tokenAddress);
    } finally { this.isProcessingExit = false; }
  }

  public getFullStatus() { return this.riskManager.getStatus(); }
}
