import { CONFIG } from "./config.js";
import { LiveMarketProvider } from "./providers/LiveMarketProvider.js";
import { Orchestrator } from "./Orchestrator.js";
import { OrderExecutor } from "./execution/OrderExecutor.js";

/**
 * PHASE 3: LIVE DRY-RUN ORCHESTRATOR
 * 
 * Goal: Validate the bot on real mainnet price action without spending SOL.
 * Execution Layer: DRY_RUN
 * Data Provider: DexScreener/Jupiter Live
 */

async function runLiveDryRun() {
  const TOKEN_MINT = "So11111111111111111111111111111111111111112"; 
  
  console.log("\n" + "=".repeat(40));
  if (CONFIG.EXECUTION_MODE === "DRY_RUN") {
    console.log("   RUNNING IN MAINNET DRY-RUN MODE");
    console.log("   NO REAL TRANSACTIONS EXECUTED");
  } else if (CONFIG.EXECUTION_MODE === "LIVE") {
    console.log("   ⚠️  WARNING: LIVE CAPITAL ACTIVE  ⚠️");
    console.log("   TRADING REAL SOL ON MAINNET");
  }
  console.log("=".repeat(40) + "\n");

  const provider = new LiveMarketProvider();
  const orchestrator = new Orchestrator(1000, new OrderExecutor());

  // 1. Monitor Price Ticks (Every 3 seconds)
  provider.subscribePriceUpdates([TOKEN_MINT], (price) => {
    const liq = provider.getPoolLiquidity(TOKEN_MINT);
    const historyCount = provider.getRecentCandles(TOKEN_MINT, 20).length;
    
    process.stdout.write(
      `\r[TICK] ${new Date().toLocaleTimeString()} | Price: $${price.toFixed(6)} | Liq: $${liq.toLocaleString()} | History: ${historyCount}/7`
    );
  });

  // 2. Core Logic Loop (Every 60 seconds)
  setInterval(async () => {
    console.log(`\n[SYSTEM] Rolling 1m candle and running Engine...`);
    
    provider.rollCandle(TOKEN_MINT);
    const candles = provider.getRecentCandles(TOKEN_MINT, 7);

    if (candles.length >= 7) {
      const current = candles[candles.length - 1]!;
      // Use the live breadth score (Currently returns 5 for Expansion)
      await orchestrator.tick(current, candles, provider.getGlobalBreadth());
    } else {
      console.log(`[SYSTEM] Initializing Market State... (${candles.length}/7 candles)`);
    }
  }, 60000);
}

runLiveDryRun().catch(console.error);
