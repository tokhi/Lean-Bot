import { CONFIG } from "./config.js";
import type { Candle } from "./types/MarketTypes.js";
import type { Position } from "./types/TradeTypes.js";
import type { IExecutionLayer } from "./execution/interfaces/IExecutionLayer.js";

// Core Engine Imports
import { RegimeEngine } from "./core/RegimeEngine.js";
import { EntryEngine } from "./core/EntryEngine.js";
import { PositionSizer } from "./core/PositionSizer.js";
import { ExitEngine } from "./core/ExitEngine.js";
import { ScalingEngine } from "./core/ScalingEngine.js";

// Infrastructure Imports
import { PortfolioRiskManager } from "./risk/PortfolioRiskManager.js";
import { LiquidityMonitor } from "./execution/LiquidityMonitor.js";
import { ExecutionAuditor } from "./execution/ExecutionAuditor.js";
import { QuoteValidator } from "./execution/QuoteValidator.js";
import { TradeLogger } from "./simulation/TradeLogger.js";

export class Orchestrator {
  private activePositions: Map<string, Position> = new Map();
  private isProcessingExit: boolean = false; 
  private readonly riskManager: PortfolioRiskManager;
  private readonly executionLayer: IExecutionLayer;
  private readonly liqMonitor: LiquidityMonitor;
  private readonly auditor: ExecutionAuditor;
  private readonly initialBalance: number;
  private readonly riskPercent: number;

  constructor(initialBalance: number, executionLayer: IExecutionLayer, riskPercent: number = 0.015) {
    this.initialBalance = initialBalance;
    this.riskManager = new PortfolioRiskManager(initialBalance);
    this.executionLayer = executionLayer;
    this.liqMonitor = new LiquidityMonitor();
    this.auditor = new ExecutionAuditor();
    this.riskPercent = riskPercent;
  }

  /**
   * 1) SAFETY LOOP (Triggered every 3s in main.ts)
   * High-frequency monitoring for stop-losses and liquidity rugs.
   */
  public async monitorSafety(tokenAddress: string, currentPrice: number, currentLiquidity: number): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position || this.isProcessingExit) return;

    const timeElapsedMs = Date.now() - position.openTime;
    const unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity;

    // --- HIGH-FREQUENCY OVERRIDES (Every 3s) ---

    // 1. Hard 5-Minute Timeout (Micro-Test Safety)
    if (CONFIG.MICRO_LIVE_TEST || CONFIG.DRY_MULTI_TOKEN) {
      if (timeElapsedMs >= 5 * 60 * 1000) {
        console.log(`[SAFETY EXIT] 5m Timeout reached for ${tokenAddress.slice(0,4)}.`);
        await this.closePosition(tokenAddress, currentPrice, "MICRO_TIMEOUT");
        return;
      }
    }

    // 2. Hard 1R Stop Loss (Dollar based)
    if (unrealizedPnL <= -position.riskAmount) {
      console.log(`[SAFETY EXIT] Hard 1R Stop reached for ${tokenAddress.slice(0,4)}.`);
      await this.closePosition(tokenAddress, currentPrice, "HARD_STOP_LOSS");
      return;
    }

    // 3. Technical Stop Loss Check
    if (currentPrice <= position.stopPrice) {
      console.log(`[SAFETY EXIT] Technical Stop hit for ${tokenAddress.slice(0,4)}.`);
      await this.closePosition(tokenAddress, currentPrice, "TECHNICAL_STOP");
      return;
    }

    // 4. Rapid Liquidity Drop Check
    if (this.liqMonitor.shouldEmergencyExit(currentLiquidity)) {
      console.log(`[SAFETY EXIT] Liquidity Rug detected for ${tokenAddress.slice(0,4)}.`);
      await this.closePosition(tokenAddress, currentPrice, "LIQUIDITY_RUG");
      return;
    }

    // 5. Update Peak Price for trailing stop accuracy
    if (currentPrice > position.peakPrice) {
      this.activePositions.set(tokenAddress, { ...position, peakPrice: currentPrice });
    }
  }

  /**
   * 2) STRATEGIC LOOP (Triggered every 60s in main.ts)
   * Handles entries, scaling, and regime-based management.
   */
  public async tick(tokenAddress: string, current: Candle, history: Candle[], breadthScore: number): Promise<void> {
    if (this.isProcessingExit) return;

    const regime = RegimeEngine.calculate(breadthScore, 0, 0.04);
    const position = this.activePositions.get(tokenAddress);
    const id = tokenAddress.slice(0, 4);

    if (position) {
      await this.manageStrategicScaling(tokenAddress, current);
    } else {
      const signal = EntryEngine.evaluate(history, regime, CONFIG.MIN_LIQUIDITY_USD);
      
      console.log(`[EVAL] ${id} | Px: $${current.close.toFixed(6)} | Filter: ${signal.enter ? "APPROVED" : "REJECTED"} | Reason: ${signal.reason}`);

      if (signal.enter) {
        await this.evaluateEntry(tokenAddress, current, history, regime);
      }
    }
  }

  private async manageStrategicScaling(tokenAddress: string, current: Candle): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position) return;

    // Scaling Logic
    const currentBalance = this.initialBalance + this.riskManager.getStatus().currentPnL;
    const scaling = ScalingEngine.evaluate(position, current.close, currentBalance, current.liquidity);
    
    if (scaling.addQuantity > 0) {
      const result = await this.executionLayer.executeBuy({
        tokenAddress,
        amountUsd: scaling.addQuantity * current.close,
        slippageTolerance: CONFIG.SLIPPAGE_TOLERANCE_BPS / 10000,
        marketPrice: current.close
      });
      
      this.auditor.auditExecution(current.close, result);
      this.activePositions.set(tokenAddress, { 
        ...position, 
        quantity: position.quantity + result.filledQuantity, 
        stage: scaling.newStage as 1 | 2 | 3 
      });
      console.log(`[ORCHESTRATOR] SCALE -> ${tokenAddress.slice(0,4)} Stage ${scaling.newStage}`);
    }

    // Stop Ratchet
    const newStop = ExitEngine.calculateUpdatedStop(position, current.close, current.close * 0.05, 0.04, current.liquidity, Date.now());
    if (newStop > position.stopPrice) {
      this.activePositions.set(tokenAddress, { ...position, stopPrice: newStop });
    }
  }

  private async evaluateEntry(tokenAddress: string, current: Candle, history: Candle[], regime: any): Promise<void> {
    // CORRELATION CAP: If we already have 2 open positions, block all new entries
    if (this.activePositions.size >= 2) {
      // Log silently to avoid console spam
      return; 
    }

    // PORTFOLIO HEAT: Check if current active risk exceeds 4R (Safety Shield)
    const currentActiveRiskR = Array.from(this.activePositions.values())
      .reduce((sum, pos) => sum + (pos.riskAmount / 15), 0);

    if (!this.riskManager.canTrade(this.activePositions.size, currentActiveRiskR)) {
      console.log(`[RISK] Entry blocked: Portfolio Heat too high.`);
      return;
    }

    const currentBalance = this.initialBalance + this.riskManager.getStatus().currentPnL;
    const sizing = PositionSizer.calculateStage1Size(currentBalance, currentBalance * this.riskPercent, current.close, current.close * 0.90, current.liquidity);

    if (!sizing.rejected && sizing.quantity > 0) {
      const validation = QuoteValidator.validate({
        amountUsd: sizing.quantity * current.close,
        poolLiquidity: current.liquidity,
        slippageEstimate: sizing.expectedSlippage,
        isRiskActive: true
      });

      if (!validation.valid) return;

      const result = await this.executionLayer.executeBuy({ 
        tokenAddress, amountUsd: sizing.quantity * current.close, 
        slippageTolerance: CONFIG.SLIPPAGE_TOLERANCE_BPS / 10000, marketPrice: current.close 
      });

      this.activePositions.set(tokenAddress, { 
        entryPrice: result.filledPrice, quantity: result.filledQuantity, 
        stopPrice: result.filledPrice * 0.90, stage: 1, 
        riskAmount: sizing.effectiveRisk, peakPrice: result.filledPrice, openTime: Date.now() 
      });
      
      console.log(`[ORCHESTRATOR] ENTRY Stage 1 | ${tokenAddress.slice(0,4)} | Price: ${result.filledPrice.toFixed(4)}`);
    }
  }

  private async closePosition(tokenAddress: string, price: number, reason: string): Promise<void> {
    const position = this.activePositions.get(tokenAddress);
    if (!position || this.isProcessingExit) return;
    
    this.isProcessingExit = true;
    try {
      const result = await this.executionLayer.executeSell({ 
        tokenAddress, quantity: position.quantity, 
        slippageTolerance: 0.01, marketPrice: price 
      });

      const finalPnl = (result.filledPrice - position.entryPrice) * result.filledQuantity;
      this.riskManager.updatePnL(finalPnl);
      
      console.log(`[ORCHESTRATOR] EXIT ${tokenAddress.slice(0,4)} (${reason}) | PnL: $${finalPnl.toFixed(2)}`);
      this.activePositions.delete(tokenAddress);
    } finally {
      this.isProcessingExit = false;
    }
  }
  /**
   * Provides a read-only view of the portfolio's current PnL and health.
   */
  public getFullStatus() {
    return this.riskManager.getStatus();
  }
}
