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

export class Orchestrator {
  private activePosition: Position | null = null;
  private isProcessingExit: boolean = false; // Race condition lock
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
   * 1) STRATEGIC LOOP (Runs every 60s)
   * Handles: Candle Rolling, Regime, Entry, and Scaling.
   */
  public async tick(current: Candle, history: Candle[], breadthScore: number): Promise<void> {
    if (this.isProcessingExit) return;

    const regime = RegimeEngine.calculate(breadthScore, 0, 0.04);

    if (this.activePosition) {
      await this.manageStrategicScaling(current);
    } else {
      await this.evaluateEntry(current, history, regime);
    }
  }

  /**
   * 2) SAFETY LOOP (Runs every 3s)
   * Handles: Instant Stop-Loss, Liquidity Floor, and Daily Drawdown breaches.
   */
  public async monitorSafety(currentPrice: number, currentLiquidity: number): Promise<void> {
    if (!this.activePosition || this.isProcessingExit) return;

    // A. Check Daily Drawdown Breach
    if (!this.riskManager.canTrade(1, 1.0)) {
      console.log(`[SAFETY EXIT] Daily Drawdown Limit Breached.`);
      await this.closePosition(currentPrice, "DAILY_DRAWDOWN_OVERRIDE");
      return;
    }

    // B. Check Instant Liquidity Floor
    if (currentLiquidity < CONFIG.MIN_LIQUIDITY_USD) {
      console.log(`[SAFETY EXIT] Liquidity fell below $${CONFIG.MIN_LIQUIDITY_USD}.`);
      await this.closePosition(currentPrice, "LIQUIDITY_FLOOR_OVERRIDE");
      return;
    }

    // C. Instant Rug/Liquidity Drop Check
    if (this.liqMonitor.shouldEmergencyExit(currentLiquidity)) {
      console.log(`[SAFETY EXIT] Rapid Liquidity Drop Detected.`);
      await this.closePosition(currentPrice, "LIQUIDITY_RUG_OVERRIDE");
      return;
    }

    // D. Instant Price Stop Check
    if (currentPrice <= this.activePosition.stopPrice) {
      console.log(`[SAFETY EXIT] Stop Loss Hit at $${currentPrice}.`);
      await this.closePosition(currentPrice, "FAST_STOP_LOSS");
      return;
    }

    // Update internal peak price if ticker is higher (improves ratchet accuracy)
    if (currentPrice > this.activePosition.peakPrice) {
      this.activePosition = { ...this.activePosition, peakPrice: currentPrice };
    }
  }

  private async manageStrategicScaling(current: Candle): Promise<void> {
    const currentBalance = this.initialBalance + this.riskManager.getStatus().currentPnL;
    const scaling = ScalingEngine.evaluate(this.activePosition!, current.close, currentBalance, current.liquidity);
    
    if (scaling.addQuantity > 0) {
      const result = await this.executionLayer.executeBuy({
        tokenAddress: "MOCK_TOKEN",
        amountUsd: scaling.addQuantity * current.close,
        slippageTolerance: CONFIG.SLIPPAGE_TOLERANCE_BPS / 10000,
        marketPrice: current.close
      });
      this.auditor.auditExecution(current.close, result);
      this.activePosition = { 
        ...this.activePosition!, 
        quantity: this.activePosition!.quantity + result.filledQuantity, 
        stage: scaling.newStage as 1 | 2 | 3 
      };
      console.log(`[ORCHESTRATOR] SCALE -> Stage ${scaling.newStage}`);
    }

    // Update stop ratchet every minute based on candle ATR
    const newStop = ExitEngine.calculateUpdatedStop(this.activePosition!, current.close, current.close * 0.05, 0.04, current.liquidity, Date.now());
    if (newStop > this.activePosition!.stopPrice) {
      this.activePosition = { ...this.activePosition!, stopPrice: newStop };
    }
  }

  private async evaluateEntry(current: Candle, history: Candle[], regime: any): Promise<void> {
    if (!this.riskManager.canTrade(0, 0)) return;

    const signal = EntryEngine.evaluate(history, regime, CONFIG.MIN_LIQUIDITY_USD);
     // Log the engine's reasoning every minute
    if (!signal.enter) {
        console.log(`[ANALYSIS] ${signal.reason}`);
        return; 
    }
    
    if (signal.enter) {
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
          tokenAddress: "MOCK_TOKEN", amountUsd: sizing.quantity * current.close, 
          slippageTolerance: CONFIG.SLIPPAGE_TOLERANCE_BPS / 10000, marketPrice: current.close 
        });

        this.activePosition = { 
          entryPrice: result.filledPrice, quantity: result.filledQuantity, 
          stopPrice: result.filledPrice * 0.90, stage: 1, 
          riskAmount: sizing.effectiveRisk, peakPrice: result.filledPrice, openTime: Date.now() 
        };
        console.log(`[ORCHESTRATOR] ENTRY Stage 1 | Price: ${result.filledPrice.toFixed(4)}`);
      }
    }
  }

  private async closePosition(price: number, reason: string): Promise<void> {
    if (!this.activePosition || this.isProcessingExit) return;
    
    this.isProcessingExit = true; // Lock
    try {
      const result = await this.executionLayer.executeSell({ 
        tokenAddress: "MOCK_TOKEN", quantity: this.activePosition.quantity, 
        slippageTolerance: 0.01, marketPrice: price 
      });

      const finalPnl = (result.filledPrice - this.activePosition.entryPrice) * result.filledQuantity;
      this.riskManager.updatePnL(finalPnl);
      
      console.log(`[ORCHESTRATOR] EXIT (${reason}) | Realized Price: ${result.filledPrice.toFixed(4)} | PnL: $${finalPnl.toFixed(2)}`);
      this.activePosition = null;
    } finally {
      this.isProcessingExit = false; // Release
    }
  }
}
