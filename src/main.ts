import type { Candle } from "./types/MarketTypes.js";
import { ReplayEngine } from "./simulation/ReplayEngine.js";
import { TradeLogger } from "./simulation/TradeLogger.js";

/**
 * Dataset: The "Fake Breakout" (Trap)
 * Price spikes to trigger Stage 1, then immediately collapses.
 */
function generateTrapData(): Candle[] {
  const candles: Candle[] = [];
  const startPrice = 100;
  const liq = 500_000;

  // 1. Consolidation
  for (let i = 0; i < 10; i++) {
    candles.push({
      timestamp: i * 60000,
      open: startPrice, high: startPrice + 1, low: startPrice - 1, close: startPrice,
      volume: 100, liquidity: liq
    });
  }

  // 2. The Trap (Volume spike + Price Breakout)
  candles.push({
    timestamp: 10 * 60000,
    open: 100, high: 112, low: 100, close: 111,
    volume: 500, liquidity: liq
  });

  // 3. The Collapse (Immediate reversal to hit 10% stop)
  candles.push({
    timestamp: 11 * 60000,
    open: 111, high: 111, low: 95, close: 96,
    volume: 1000, liquidity: liq
  });

  return candles;
}

function main() {
  const logger = new TradeLogger();
  const engine = new ReplayEngine(1000, 0.015);

  console.log("=== STRESS TEST: FAKE BREAKOUT (TRAP) ===");
  
  const trapData = generateTrapData();
  engine.run(trapData, 5); // Normal Breadth

  const history = (engine as any).history;
  history.forEach((res: any) => {
    logger.logTrade(res, 0.005, 0.005);
  });

  logger.printSummary();

  const stats = engine.getStats();
  console.log(`Final Portfolio: $${stats.finalBalance.toFixed(2)}`);
  
  if (stats.finalBalance >= 992.50) {
    console.log("RISK SHIELD CHECK: PASSED (Loss capped at ~0.5R)");
  } else {
    console.log("RISK SHIELD CHECK: FAILED");
  }
}

main();
