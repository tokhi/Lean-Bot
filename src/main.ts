import { CONFIG } from "./config.js";
import { LiveMarketProvider } from "./providers/LiveMarketProvider.js";
import { Orchestrator } from "./Orchestrator.js";
import { OrderExecutor } from "./execution/OrderExecutor.js";

/**
 * PHASE 3.1a — MICRO LIVE PLUMBING TEST
 * 
 * Objective: 
 * Validate the execution pathway on ONE specific token.
 * No scanning, no parallel trades, no discovery.
 */

// HARDCODED SCOPE: Change this to the specific token you wish to test (e.g., SOL or a high-cap meme)
const TEST_TOKEN_MINT = "412zDygnwP9DzitnQVgRKUFFTDmrYScFch6P2k39pump"; // PUNCH Mint Address

async function runMicroPlumbingTest() {
  // --- STEP 6: VISIBLE LIVE WARNING ---
  console.log("\n" + "=".repeat(50));
  
  if (CONFIG.EXECUTION_MODE === "LIVE" && CONFIG.MICRO_LIVE_TEST) {
    console.log("⚠️  MICRO LIVE TEST MODE ACTIVE ⚠️");
    console.log("   Capital Strictly Limited ($5 Risk / $25 Pos)");
    console.log("   Supervised Execution Required");
  } else if (CONFIG.EXECUTION_MODE === "DRY_RUN") {
    console.log("   RUNNING IN MAINNET DRY-RUN MODE");
    console.log("   NO REAL TRANSACTIONS EXECUTED");
  } else {
    // This catches "LIVE" mode without the MICRO flag (though config.ts should kill it first)
    console.log("⚠️  UNRESTRICTED LIVE MODE DETECTED ⚠️");
  }
  
  console.log("=".repeat(50) + "\n");

  // Log specific caps for clarity
  if (CONFIG.MICRO_LIVE_TEST) {
    console.log(`[SAFETY CHECK] Mode: ${CONFIG.EXECUTION_MODE}`);
    console.log(`[SAFETY CHECK] Max Risk: $${CONFIG.MAX_MICRO_RISK_USD}`);
    console.log(`[SAFETY CHECK] Max Pos:  $${CONFIG.MAX_MICRO_POSITION_USD}`);
    console.log("------------------------------------------");
  }


  const provider = new LiveMarketProvider();
  
  // Single Instance Orchestrator
  // Starting Balance is mock, but Risk Math is governed by PositionSizer overrides
  const orchestrator = new Orchestrator(1000, new OrderExecutor());

  // 1. SAFETY LOOP (Every 3 seconds)
  // Reuses the live price feed to check the Safety Overrides
  provider.subscribePriceUpdates([TEST_TOKEN_MINT], async (price) => {
    const liq = provider.getPoolLiquidity(TEST_TOKEN_MINT);
    const historyCount = provider.getRecentCandles(TEST_TOKEN_MINT, 20).length;
    
    process.stdout.write(
      `\r[TICK] ${new Date().toLocaleTimeString()} | Price: $${price.toFixed(6)} | Liq: $${liq.toLocaleString()} | History: ${historyCount}/7`
    );

    // Trigger the Safety Loop (Check stop-loss, drawdown, etc.)
    await orchestrator.monitorSafety(price, liq);
  });

  // 2. CORE TICK LOOP (Single Token Only)
  setInterval(async () => {
    console.log(`\n[SYSTEM] Evaluating ${TEST_TOKEN_MINT}...`);
    
    // Process price action into candles
    provider.rollCandle(TEST_TOKEN_MINT);
    const candles = provider.getRecentCandles(TEST_TOKEN_MINT, 7);

    if (candles.length >= 7) {
      const current = candles[candles.length - 1]!;
      
      /**
       * Execute Tick.
       * The Orchestrator is hard-coded to ignore any other tokens.
       * Logic is now restricted by the PositionSizer V2.2 logic.
       */
      await orchestrator.tick(current, candles, provider.getGlobalBreadth());
      
    } else {
      console.log(`[SYSTEM] Initializing memory... (${candles.length}/7 candles)`);
    }
  }, 60000);
}

runMicroPlumbingTest().catch((err) => {
  console.error("[FATAL] Micro Test Crash:", err);
  process.exit(1);
});
