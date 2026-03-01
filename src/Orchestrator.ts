import { CONFIG } from "./config.js";
import { OrderExecutor } from "./execution/OrderExecutor.js";
import { TradeLogger } from "./simulation/TradeLogger.js";
import type { Candle } from "./types/MarketTypes.js";
import type { Position } from "./types/TradeTypes.js";
import { RedisProvider } from "./providers/RedisProvider.js";

export class Orchestrator {
  private maxAllocation: number;
  private executor: OrderExecutor;

  public activePositions: Map<string, Position> = new Map(); // mint → Position
  private realizedPnL: number = 0;
  private unrealizedPnL: number = 0;

  constructor(maxAllocationPerTrade: number = 1.0, executor: OrderExecutor) {
    this.maxAllocation = maxAllocationPerTrade;
    this.executor = executor;
    TradeLogger.log(`Orchestrator ready — max/trade: ${maxAllocationPerTrade} SOL`, 'INFO');
  }

  async monitorSafety(mint: string, currentPrice: number, liquidity: number): Promise<void> {
    const pos = this.activePositions.get(mint);
    if (!pos) return;

    const sym = (global as any).provider?.getSymbol(mint) || mint.slice(0, 6);

    if (currentPrice <= pos.stopPrice) {
      await this.exitPosition(mint, currentPrice, "Stop-loss 10% triggered");
      return;
    }

    // Optional: update lastPrice, check trailing, etc.
    // For now, just safety check
    if (Math.random() < 0.03) {
      TradeLogger.log(
        `[SAFETY] ${sym} @ $${currentPrice.toFixed(6)}  SL @ $${pos.stopPrice.toFixed(6)}`,
        'INFO'
      );
    }
  }

  async tick(
    mint: string,
    candle: Candle,
    redis: RedisProvider,
    convictionThreshold: number = 5
  ): Promise<{ prune: boolean }> {
    const history = await redis.getHistory(mint);
    if (history.length < 7) return { prune: false };

    const shouldPrune = history.length > 25 && candle.close < candle.open * 0.65;

    return { prune: shouldPrune };
  }

  async enterPosition(
    mint: string,
    buyAmountSol: number,
    entryPrice: number,
    // Pass these from main.ts evaluation context (e.g. from candle/history)
    currentLiquidity: number = 0,     // Required for initialLiquidity
    breakoutLevel: number = entryPrice // Placeholder; compute from history if needed
  ): Promise<boolean> {
    if (this.activePositions.size >= 3) {
      TradeLogger.log(`[ENTRY BLOCKED] Max 3 positions active`, 'WARN');
      return false;
    }

    buyAmountSol = Math.min(buyAmountSol, this.maxAllocation);

    try {
      // Live trading: await this.executor.buy(mint, buyAmountSol);
      TradeLogger.log(
        `[SIM BUY] ${mint} — ${buyAmountSol} SOL @ $${entryPrice.toFixed(6)}`,
        'INFO'
      );

      const symbol = (global as any).provider?.getSymbol(mint) || mint.slice(0, 8);
      const quantity = buyAmountSol / entryPrice; // tokens bought
      const stopPrice = entryPrice * 0.90;        // 10% stop as required
      const now = Date.now();

      const position: Position = {
        symbol,
        entryPrice,
        quantity,
        stopPrice,
        stage: 1,                           // Assume entry stage; adjust per your logic
        riskAmount: buyAmountSol,           // Full exposure at risk initially
        peakPrice: entryPrice,
        openTime: now,
        lastPrice: entryPrice,
        breakoutLevel,
        initialLiquidity: currentLiquidity, // Use real liq from candle
        buyAmountSol,
      };

      this.activePositions.set(mint, position);
      return true;
    } catch (err: any) {
      TradeLogger.log(`[ENTRY FAIL] ${mint} — ${err.message}`, 'ERROR');
      return false;
    }
  }

  async exitPosition(mint: string, exitPrice: number, reason: string = "Exit"): Promise<number> {
    const pos = this.activePositions.get(mint);
    if (!pos) {
      TradeLogger.log(`[EXIT SKIP] No position for ${mint}`, 'WARN');
      return 0;
    }

    try {
      // Live: await this.executor.sell(mint, pos.buyAmountSol);
      TradeLogger.log(
        `[SIM SELL] ${pos.symbol} — reason: ${reason} @ $${exitPrice.toFixed(6)}`,
        'INFO'
      );

      const exitValue = pos.quantity * exitPrice;
      const pnl = exitValue - pos.buyAmountSol;

      this.realizedPnL += pnl;

      this.activePositions.delete(mint);

      TradeLogger.log(
        `[TRADE CLOSED] ${pos.symbol} PnL: ${pnl.toFixed(4)} SOL (${(pnl / pos.buyAmountSol * 100).toFixed(1)}%) — ${reason}`,
        'TRADE'
      );

      return pnl;
    } catch (err: any) {
      TradeLogger.log(`[EXIT FAIL] ${mint} — ${err.message}`, 'ERROR');
      return 0;
    }
  }

  getFullPerformanceStatus() {
    return {
      totalPnL: this.realizedPnL + this.unrealizedPnL,
      realizedPnL: this.realizedPnL,
      unrealizedPnL: this.unrealizedPnL,
      activeTrades: this.activePositions.size,
    };
  }
}
