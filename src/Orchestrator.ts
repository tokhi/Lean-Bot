import type { Candle } from "./types/MarketTypes.js";
import type { Position } from "./types/TradeTypes.js";
import type { IExecutionLayer } from "./execution/interfaces/IExecutionLayer.js";

// Core Engine Imports
import { RegimeEngine } from "./core/RegimeEngine.js";
import { EntryEngine } from "./core/EntryEngine.js";
import { PositionSizer } from "./core/PositionSizer.js";
import { ExitEngine } from "./core/ExitEngine.js";
import { ScalingEngine } from "./core/ScalingEngine.js";

// Risk and Infrastructure Imports
import { PortfolioRiskManager } from "./risk/PortfolioRiskManager.js";
import { LiquidityMonitor } from "./execution/LiquidityMonitor.js";
import { ExecutionAuditor } from "./execution/ExecutionAuditor.js";
import { QuoteValidator } from "./execution/QuoteValidator.js";
import { CONFIG } from "./config.js";

/**
 * Orchestrator V2.1
 * 
 * Central controller that bridges the deterministic core logic
 * with the asynchronous execution layer.
 */
export class Orchestrator {
  private activePosition: Position | null = null;
  private readonly riskManager: PortfolioRiskManager;
  private readonly executionLayer: IExecutionLayer;
  private readonly liqMonitor: LiquidityMonitor;
  private readonly auditor: ExecutionAuditor;
  private readonly riskPercent: number;
  private readonly initialBalance: number;

  constructor(
    initialBalance: number, 
    executionLayer: IExecutionLayer, 
    riskPercent: number = 0.015
  ) {
    this.initialBalance = initialBalance;
    this.riskManager = new PortfolioRiskManager(initialBalance);
    this.executionLayer = executionLayer;
    this.liqMonitor = new LiquidityMonitor();
    this.auditor = new ExecutionAuditor();
    this.riskPercent = riskPercent;
  }

  /**
   * Main entry point for market updates.
   */
  public async tick(current: Candle, history: Candle[], breadthScore: number): Promise<void> {
    const regime = RegimeEngine.calculate(breadthScore, 0, 0.04);

    // 1. EMERGENCY KILL-SWITCH
    if (this.activePosition && this.liqMonitor.shouldEmergencyExit(current.liquidity)) {
      console.error("!!! EMERGENCY LIQUIDITY EXIT TRIGGERED !!!");
      await this.closePosition(current, "EMERGENCY_EXIT");
      return;
    }

    // 2. STATE MACHINE
    if (this.activePosition) {
      await this.managePosition(current, regime);
    } else if (this.riskManager.canTrade(0, 0)) {
      await this.evaluateEntry(current, history, regime);
    }
  }

  /**
   * Handles logic for an open trade: Exits, Scaling, and Stop Ratcheting.
   */
 private async managePosition(current: Candle, regime: string): Promise<void> {
    if (!this.activePosition) return;

    // 1. ALWAYS UPDATE PEAK PRICE FIRST
    const updatedPeak = Math.max(this.activePosition.peakPrice, current.high);
    
    // Create a temporary updated position to pass to engines
    const trackedPosition = { ...this.activePosition, peakPrice: updatedPeak };

    // 2. CHECK EXIT
    if (current.low <= trackedPosition.stopPrice) {
      await this.closePosition(current, "STOP_LOSS");
      return;
    }

    // 3. CALC NEW STOP (ATR / PARABOLIC)
    const newStop = ExitEngine.calculateUpdatedStop(
      trackedPosition, 
      current.close, 
      current.close * 0.05, // ATR (5% of price)
      0.04, 
      current.liquidity, 
      current.timestamp
    );

    // 4. RATCHET STOP (ONLY UP)
    const finalStop = Math.max(trackedPosition.stopPrice, newStop);

    // 5. UPDATE STATE
    this.activePosition = { 
      ...trackedPosition, 
      stopPrice: finalStop 
    };

    // 6. SCALING LOGIC (Remains the same)
    const currentBalance = this.initialBalance + this.riskManager.getStatus().currentPnL;
    const scaling = ScalingEngine.evaluate(this.activePosition, current.close, currentBalance, current.liquidity);
    
    if (scaling.addQuantity > 0) {
      const result = await this.executionLayer.executeBuy({
        tokenAddress: "MOCK_TOKEN",
        amountUsd: scaling.addQuantity * current.close,
        slippageTolerance: 0.015,
        marketPrice: current.close
      });
      this.auditor.auditExecution(current.close, result);
      this.activePosition = { 
        ...this.activePosition, 
        quantity: this.activePosition.quantity + result.filledQuantity, 
        stage: scaling.newStage as 1 | 2 | 3 
      };
      console.log(`[ORCHESTRATOR] SCALE -> Stage ${scaling.newStage}`);
    }

    const unrealizedPnl = (current.close - this.activePosition.entryPrice) * this.activePosition.quantity;
    console.log(`[MONITOR] Stage: ${this.activePosition.stage} | PnL: $${unrealizedPnl.toFixed(2)} | Stop: ${this.activePosition.stopPrice.toFixed(2)}`);
  }

  /**
   * Handles logic for finding and entering a new trade.
   */
  private async evaluateEntry(current: Candle, history: Candle[], regime: any): Promise<void> {
    const signal = EntryEngine.evaluate(history, regime, CONFIG.MIN_LIQUIDITY_USD);
    
    if (signal.enter) {
      const currentBalance = this.initialBalance + this.riskManager.getStatus().currentPnL;
      
      const sizing = PositionSizer.calculateStage1Size(
        currentBalance, 
        currentBalance * this.riskPercent, 
        current.close, 
        current.close * 0.90, 
        current.liquidity
      );

      if (!sizing.rejected && sizing.quantity > 0) {
        // --- V2.1 FIREWALL INTEGRATION ---
        
        // 1. Calculate stats for Risk Manager
        const currentActiveCount = this.activePosition ? 1 : 0;
        const currentActiveRiskR = this.activePosition ? 1.0 : 0; // Simplified for single trade

        // 2. Run Quote Validator (The Pre-Trade Firewall)
        const validation = QuoteValidator.validate({
          amountUsd: sizing.quantity * current.close,
          poolLiquidity: current.liquidity,
          slippageEstimate: sizing.expectedSlippage,
          isRiskActive: this.riskManager.canTrade(currentActiveCount, currentActiveRiskR)
        });

        if (!validation.valid) {
          console.log(`[VALIDATOR] Entry Blocked: ${validation.reason}`);
          return;
        }

        // 3. Execution (If validated)
        const result = await this.executionLayer.executeBuy({ 
          tokenAddress: "MOCK_TOKEN", 
          amountUsd: sizing.quantity * current.close, 
          slippageTolerance: CONFIG.SLIPPAGE_TOLERANCE_BPS / 10000,
          marketPrice: current.close 
        });

        this.auditor.auditExecution(current.close, result);
        
        this.activePosition = { 
          entryPrice: result.filledPrice, 
          quantity: result.filledQuantity, 
          stopPrice: result.filledPrice * 0.90, 
          stage: 1, 
          riskAmount: sizing.effectiveRisk, 
          peakPrice: result.filledPrice, 
          openTime: current.timestamp 
        };
        
        console.log(`[ORCHESTRATOR] ENTRY Stage 1 | Price: ${result.filledPrice.toFixed(4)}`);
      }
    }
  }

  /**
   * Handles logic for closing a position.
   */
 private async closePosition(current: Candle, reason: string): Promise<void> {
    if (!this.activePosition) return;

    // Use the stopPrice as the target, or the current low if the market gapped below it
    const targetExitPrice = Math.min(this.activePosition.stopPrice, current.high);

    const result = await this.executionLayer.executeSell({ 
      tokenAddress: "MOCK_TOKEN", 
      quantity: this.activePosition.quantity, 
      slippageTolerance: 0.01,
      marketPrice: targetExitPrice // Sell at the Stop Price trigger
    });

    // Audit against the Stop Price to see the REAL slippage
    this.auditor.auditExecution(this.activePosition.stopPrice, result);
    
    const finalPnl = (result.filledPrice - this.activePosition.entryPrice) * result.filledQuantity;
    this.riskManager.updatePnL(finalPnl);
    
    console.log(`[ORCHESTRATOR] EXIT (${reason}) | Target: ${this.activePosition.stopPrice.toFixed(2)} | Filled: ${result.filledPrice.toFixed(4)} | PnL: $${finalPnl.toFixed(2)}`);
    
    this.activePosition = null;
  }
}
