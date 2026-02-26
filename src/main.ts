import type { Candle } from "./types/MarketTypes.js";
import { ReplayEngine } from "./simulation/ReplayEngine.js";
import { TradeLogger } from "./simulation/TradeLogger.js";

/**
 * Generates a synthetic "Winner" dataset.
 */
function generateWinnerData(): Candle[] {
  const candles: Candle[] = [];
  const startPrice = 100;
  const liq = 500_000;

  for (let i = 0; i < 15; i++) {
    candles.push({
      timestamp: i * 60000,
      open: startPrice, high: startPrice + 1, low: startPrice - 1, close: startPrice,
      volume: 100, liquidity: liq
    });
  }

  // Breakout Candle
  candles.push({
    timestamp: 15 * 60000,
    open: 100, high: 115, low: 100, close: 112,
    volume: 500, liquidity: liq
  });

  // Expansion Phase
  for (let i = 16; i < 40; i++) {
    const last = candles[candles.length - 1]!;
    candles.push({
      timestamp: i * 60000,
      open: last.close, high: last.close + 10, low: last.close - 2, close: last.close + 6,
      volume: 200, liquidity: liq
    });
  }

  // Final Reversal (Hits Ratchet)
  const peak = candles[candles.length - 1]!;
  candles.push({
    timestamp: 40 * 60000,
    open: peak.close, high: peak.close + 1, low: peak.close - 50, close: peak.close - 45,
    volume: 800, liquidity: liq
  });

  return candles;
}

function main() {
  const logger = new TradeLogger();
  const engine = new ReplayEngine(1000, 0.015);

  console.log("=== STARTING LEAN V2 BACKTEST ===");
  
  // 1. Run Winning Scenario
  const winData = generateWinnerData();
  engine.run(winData, 5); 

  // 2. Extract Results from Engine into Logger
  // Note: In a production sim, the engine would pipe results to the logger automatically.
  // For this lean skeleton, we utilize the engine's internal history.
  const history = (engine as any).history; // Accessing for summary purposes
  history.forEach((res: any) => {
    // Assume 0.5% expected vs 0.7% realized slippage for the log
    logger.logTrade(res, 0.005, 0.007);
  });

  // 3. Print Final Summary
  logger.printSummary();

  const stats = engine.getStats();
  if (stats.finalBalance > 1000) {
    console.log("PROFITABILITY CHECK: PASSED");
  }
}

main();
