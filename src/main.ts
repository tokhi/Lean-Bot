import { CONFIG } from "./config.js";
import { LiveMarketProvider } from "./providers/LiveMarketProvider.js";
import { Orchestrator } from "./Orchestrator.js";
import { OrderExecutor } from "./execution/OrderExecutor.js";
import { MarketScanner } from "./providers/MarketScanner.js";

/**
 * SOLANA MOMENTUM AGENT V2.3 — MAIN ORCHESTRATOR
 * 
 * Objectives:
 * 1. Strategic Loop (60s): Analyze breakouts and volume acceleration.
 * 2. Safety Loop (4s): Instant stop-loss and liquidity monitoring.
 * 3. Dashboard: Real-time PnL and evaluation reasoning.
 */

async function main() {
  // 1. STARTUP BANNER
  console.log("\n" + "=".repeat(60));
  if (CONFIG.EXECUTION_MODE === "LIVE" && CONFIG.MICRO_LIVE_TEST) {
    console.log("⚠️  MICRO LIVE TEST MODE ACTIVE ⚠️");
    console.log("   Capital strictly capped ($5 Risk / $30 Position)");
    console.log("   Supervised Execution Required");
  } else if (CONFIG.EXECUTION_MODE === "DRY_RUN") {
    console.log("   RUNNING IN MAINNET DRY-RUN MODE");
    console.log("   Simulating entries on real-time data.");
  }
  console.log("=".repeat(60));

  // 2. INITIALIZE INFRASTRUCTURE
  const provider = new LiveMarketProvider();
  const orchestrator = new Orchestrator(1000, new OrderExecutor());
  
  // Default fallback (WIF)
  let activeWatchlist: string[] = ["412zDygnwP9DzitnQVgRKUFFTDmrYScFch6P2k39pump"];

  // 3. SCANNER SYNC (Runs every 5m)
  const refreshWatchlist = async () => {
    if (CONFIG.DRY_MULTI_TOKEN && CONFIG.EXECUTION_MODE === "DRY_RUN") {
      console.log("\n[SCANNER] Re-scanning Solana for High-Velocity pairs...");
      const trending = await MarketScanner.getTrendingTokens(3);
      if (trending.length > 0) {
        // Keep unique tokens
        activeWatchlist = Array.from(new Set([...trending.map(t => t.mint)]));
        console.log(`[SCANNER] Watchlist: ${trending.map(t => t.symbol).join(", ")}`);
      }
    }
  };

  await refreshWatchlist();
  if (CONFIG.DRY_MULTI_TOKEN) setInterval(refreshWatchlist, 5 * 60 * 1000);

  // 4. SAFETY LOOP (High Frequency - 4s)
  provider.subscribePriceUpdates(activeWatchlist, async (address, price) => {
    const liq = provider.getPoolLiquidity(address);
    const history = provider.getRecentCandles(address, 7);
    const id = address.slice(0, 4);

    // Instant Safety Check
    await orchestrator.monitorSafety(address, price, liq);
    
    // Non-scrolling Ticker
    process.stdout.write(`\r[TICK] ${id}: $${price.toFixed(6)} | Liq: $${Math.round(liq/1000)}k | Mem: ${history.length}/7 `);
  });

  // 5. STRATEGIC EVALUATION LOOP (Every 60s)
  setInterval(async () => {
    const status = orchestrator.getFullStatus();
    
    console.log(`\n\n` + "=".repeat(65));
    console.log(`--- DASHBOARD | Session PnL: $${status.currentPnL.toFixed(2)} | Status: ${status.active ? 'ACTIVE' : 'HIBERNATE'} ---`);
    console.log("=".repeat(65));
    
    for (const mint of activeWatchlist) {
      const id = mint.slice(0, 4);
      
      // Roll price ticks into an OHLCV candle
      provider.rollCandle(mint);
      
      const candles = provider.getRecentCandles(mint, 7);

      if (candles.length >= 7) {
        const current = candles[candles.length - 1]!;
        // Execute deterministic Core Engine
        await orchestrator.tick(mint, current, candles, provider.getGlobalBreadth());
      } else {
        console.log(`[WAIT] ${id} building history... (${candles.length}/7)`);
      }
    }
  }, 60000);
}

// Global Process Protection
main().catch((err) => {
  console.error("\n[FATAL] System Crash:");
  console.error(err);
  process.exit(1);
});
