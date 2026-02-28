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
import { ScalingEngine } from "./core/ScalingEngine.js";
import { RegimeEngine } from "./core/RegimeEngine.js";

// Infrastructure Imports
import { PortfolioRiskManager } from "./risk/PortfolioRiskManager.js";
import { LiquidityMonitor } from "./execution/LiquidityMonitor.js";
import { ExecutionAuditor } from "./execution/ExecutionAuditor.js";
import { QuoteValidator } from "./execution/QuoteValidator.js";
import { TradeLogger } from "./simulation/TradeLogger.js";

export enum EngineType { IGNITION = "IGNITION", MODERATE = "MODERATE" }

export class Orchestrator {
  private activePositions: Map<string, Position & { type: EngineType }> = new Map();
  private staleCounters: Map<string, number> = new Map();
  private isProcessingExit: boolean = false; 
  private readonly riskManager: PortfolioRiskManager;
  private readonly executionLayer: IExecutionLayer;
  private readonly liqMonitor: LiquidityMonitor;
  private readonly initialSol: number;

  constructor(initialSol: number, executionLayer: IExecutionLayer) {
    this.initialSol = initialSol;
    this.riskManager = new PortfolioRiskManager(initialSol * 140);
    this.executionLayer = executionLayer;
    this.liqMonitor = new LiquidityMonitor();
  }

  /**
   * 1) SAFETY LOOP (4s Frequency)
   * High-priority checks for Rugs, Structural Failures, and Technical Stops.
   */
  public async monitorSafety(tokenAddress: string, price: number, liquidity: number): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position || this.isProcessingExit || price <= 0) return;

    // A. Liquidity Rug Check (3-tick confirmation)
    if (this.liqMonitor.shouldEmergencyExit(liquidity, position.initialLiquidity, tokenAddress)) {
        await this.closePosition(tokenAddress, price, "LIQUIDITY_RUG_OR_DRAIN");
        return;
    }

    const provider = (global as any).provider;
    const volDelta = provider?.getVolumeDelta?.(tokenAddress) || { buy2m: 1, sell2m: 1 };
    const history = provider?.getRecentCandles(tokenAddress, 2) || [];
    const lastClosedCandle = history[0] || ({ close: price } as Candle);

    // B. Predator Exit Logic
    const decision: ExitDecision = ExitEngine.evaluate(
      position,
      price,
      lastClosedCandle,
      { current: liquidity, entry: position.initialLiquidity },
      volDelta,
      Math.floor((Date.now() - position.openTime) / 60000),
      position.breakoutLevel
    );

    if (decision.action === 'EXIT') {
      await this.closePosition(tokenAddress, price, decision.reason);
      return;
    }

    // C. Trailing Updates
    let updatedPos = { ...position, lastPrice: price, peakPrice: Math.max(position.peakPrice, price) };
    if (decision.updatedStop && decision.updatedStop > position.stopPrice) {
      updatedPos.stopPrice = decision.updatedStop;
    }
    this.activePositions.set(tokenAddress, updatedPos);
  }

  /**
   * 2) STRATEGIC LOOP (30s-60s Frequency)
   */
  public async tick(tokenAddress: string, current: Candle, redis: any, breadth: number): Promise<{ prune: boolean }> {
    if (this.isProcessingExit) return { prune: false };

    const position = this.activePositions.get(tokenAddress);
    const symbol = (global as any).provider?.getSymbol(tokenAddress) || tokenAddress.slice(0, 4);

    if (position) {
      await this.manageStrategicScaling(tokenAddress, current);
      return { prune: false };
    }

    // --- GLOBAL MEMORY EVALUATION ---
    const history = await redis.getHistory(tokenAddress);
    
    if (history.length >= 7) {
      const p5mCandle = history[history.length - 6];
      if (!p5mCandle) return { prune: false };

      const liq5mAgo = p5mCandle.liquidity;
      
      // Determine if entry signals fire
      const signal = EntryEngine.evaluate(history, 24, liq5mAgo);

      if (signal.enter) {
        await this.evaluateEntry(tokenAddress, current, history, signal.reason);
        return { prune: false };
      } else {
        // RULE: Log Near-Miss for transparency
        if (!signal.reason.includes("BUILDING")) {
            console.log(`[SKIP] ${symbol.padEnd(10)} | Reason: ${signal.reason}`);
        }
      }

      // Staleness Check
      const atr = history.slice(-5).reduce((sum: number, c: Candle) => sum + (c.high - c.low), 0) / 5;
      if (StalenessEngine.isStale(history, current.close, atr)) return { prune: true };
    }

    return { prune: false };
  }

  private async manageStrategicScaling(tokenAddress: string, current: Candle): Promise<void> {
    const position = this.activePositions.get(tokenAddress)!;
    const unrealizedPnL = (current.close - position.entryPrice) * position.quantity;
    const unrealizedR = unrealizedPnL / position.riskAmount;
    process.stdout.write(`\r[ACTIVE] ${position.symbol} | PnL: $${unrealizedPnL.toFixed(2)} (${unrealizedR.toFixed(2)}R) | Stop: $${position.stopPrice.toFixed(6)} `);

    const currentBalUsd = (this.initialSol * 140) + this.riskManager.getStatus().currentPnL;
    const scaling = ScalingEngine.evaluate(position, current.close, currentBalUsd, current.liquidity);
    
    if (scaling.addQuantity > 0) {
      const result = await this.executionLayer.executeBuy({
        tokenAddress, amountUsd: scaling.addQuantity * current.close,
        slippageTolerance: 0.02, marketPrice: current.close
      });
      
      this.activePositions.set(tokenAddress, { 
        ...position, quantity: position.quantity + result.filledQuantity, stage: scaling.newStage as 1 | 2 | 3 
      });
      TradeLogger.log(`[ORCHESTRATOR] SCALE -> ${position.symbol} Stage ${scaling.newStage}`, 'TRADE');
    }
  }

  private async evaluateEntry(tokenAddress: string, current: Candle, history: Candle[], signalReason: string): Promise<void> {
    // FIXED: Corrected CONFIG property access
    if (this.activePositions.size >= CONFIG.MAX_TOTAL_CONCURRENT) return;

    if (!SafetyFilter.isSafe(tokenAddress, history, current.liquidity)) return;

    const type = current.liquidity <= CONFIG.IGNITION_LIQ_UPPER ? EngineType.IGNITION : EngineType.MODERATE;
    const activeOfType = Array.from(this.activePositions.values()).filter(p => p.type === type).length;
    const maxAllowed = type === EngineType.IGNITION ? CONFIG.MAX_CONCURRENT_IGNITION : CONFIG.MAX_CONCURRENT_MODERATE;
    if (activeOfType >= maxAllowed) return;

    const baseRiskSol = type === EngineType.IGNITION ? CONFIG.RISK_IGNITION_SOL : CONFIG.RISK_MODERATE_SOL;
    
    const p5mCandle = history[history.length - 6];
    if (!p5mCandle) return;

    const p5m = ((current.close - p5mCandle.close) / p5mCandle.close) * 100;

    const sizing = PositionSizer.calculatePosition(
      140, // SolPrice mock
      current.close, 
      current.close * 0.90, // 10% Stop
      current.liquidity, 
      this.initialSol, 
      p5m, 
      baseRiskSol
    );

    if (!sizing.isRejected) {
      const validation = QuoteValidator.validate({
        amountUsd: sizing.quantity * current.close, 
        poolLiquidity: current.liquidity,
        liquidity5mChange: (current.liquidity - p5mCandle.liquidity) / p5mCandle.liquidity,
        isRiskActive: this.riskManager.canTrade(this.activePositions.size, 0)
      });

      if (!validation.valid) {
          TradeLogger.log(`[FIREWALL] Blocked entry for ${tokenAddress.slice(0,4)}: ${validation.reason}`, 'WARN');
          return;
      }

      const result = await this.executionLayer.executeBuy({ 
        tokenAddress, 
        amountUsd: sizing.quantity * current.close, 
        slippageTolerance: 0.02, 
        marketPrice: current.close 
      });

      this.activePositions.set(tokenAddress, { 
        symbol: (global as any).provider.getSymbol(tokenAddress), 
        type,
        entryPrice: result.filledPrice, 
        quantity: result.filledQuantity, 
        stopPrice: result.filledPrice * 0.90, 
        stage: 1, 
        riskAmount: sizing.riskUsd, 
        peakPrice: result.filledPrice, 
        openTime: Date.now(), 
        lastPrice: result.filledPrice,
        breakoutLevel: current.close, 
        initialLiquidity: current.liquidity
      });
      
      TradeLogger.log(`[ENTRY] ${type} on ${tokenAddress.slice(0,4)} | Risk: ${baseRiskSol} SOL`, 'TRADE');
    }
  }

  private async closePosition(tokenAddress: string, price: number, reason: string): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position || this.isProcessingExit || price <= 0) return;
    
    this.isProcessingExit = true;
    try {
      const result = await this.executionLayer.executeSell({ 
        tokenAddress, 
        quantity: position.quantity, 
        slippageTolerance: 0.02, 
        marketPrice: price 
      });

      const finalPnl = (result.filledPrice - position.entryPrice) * result.filledQuantity;
      this.riskManager.updatePnL(finalPnl);
      
      // Safety: Protect against division by zero for R calculation
      const riskUnit = position.riskAmount || 1;

      TradeLogger.logTrade({
        symbol: position.symbol, 
        entryPrice: position.entryPrice, 
        exitPrice: result.filledPrice,
        Rmultiple: finalPnl / riskUnit, 
        reason, 
        pnlUsd: finalPnl
      });

      this.activePositions.delete(tokenAddress);
    } finally { 
      this.isProcessingExit = false; 
    }
  }

  public getFullStatus() { return this.riskManager.getStatus(); }
}
