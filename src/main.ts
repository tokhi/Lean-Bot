import { CONFIG } from "./config.js";
import { LiveMarketProvider } from "./providers/LiveMarketProvider.js";
import { Orchestrator } from "./Orchestrator.js";
import { OrderExecutor } from "./execution/OrderExecutor.js";
import { MarketScanner } from "./providers/MarketScanner.js";
import { TradeLogger } from "./simulation/TradeLogger.js";
import { RedisProvider } from "./providers/RedisProvider.js";
import type { Candle } from "./types/MarketTypes.js";

async function main() {
  const banner = `
===========================================================================
   SOLANA MOMENTUM AGENT V5.0 — GLOBAL MEMORY ENGINE
   MODE: ${CONFIG.MODE} | REDIS: ACTIVE | WATCHING: TOP 60
===========================================================================`;
  console.log(banner);

  const redis = new RedisProvider();
  await redis.connect();

  const provider = new LiveMarketProvider();
  (global as any).provider = provider;
  const orchestrator = new Orchestrator(1.0, new OrderExecutor());
  
  let activeWatchlist: string[] = [];

  /**
   * JOB 1: GLOBAL SNAPSHOT (Every 60s)
   */
 const syncGlobalMemory = async () => {
    try {
      // MODIFIED: Fetch 60 tokens (Requirement 1 & 9)
      const rawPools = await MarketScanner.discoverBroadUniverse();
      for (const pool of rawPools) {
        const mint = pool.relationships?.base_token?.data?.id?.split('_')[1];
        if (!mint) continue;
        const attr = pool.attributes;
        provider.setSymbol(mint, attr.name.split(' / ')[0]);
        
        // ADDED: Logging specific memory write (Requirement 2)
        await redis.pushCandle(mint, {
          timestamp: Date.now(),
          open: parseFloat(attr.base_token_price_usd),
          high: parseFloat(attr.base_token_price_usd),
          low: parseFloat(attr.base_token_price_usd),
          close: parseFloat(attr.base_token_price_usd),
          volume: parseFloat(attr.volume_usd.m5 || "0"),
          liquidity: parseFloat(attr.reserve_in_usd || "0"),
          upperWickPct: 0
        });
      }

      // MODIFIED: Watchlist Stability (Don't wipe, only add new heat)
      const trading = Array.from(orchestrator.activePositions.keys());
      const hot = await MarketScanner.discoverHotTokens(CONFIG.MAX_ACTIVE_TOKENS, activeWatchlist);
      activeWatchlist = Array.from(new Set([...trading, ...activeWatchlist, ...hot.map(t => t.mint)])).slice(0, CONFIG.MAX_ACTIVE_TOKENS);
      
      TradeLogger.log(`Watchlist Synced: ${activeWatchlist.map(m => provider.getSymbol(m)).join(", ")}`, 'INFO');
    } catch (e: any) { TradeLogger.log(`Sync Error: ${e.message}`, 'ERROR'); }
  };

  await syncGlobalMemory();
  setInterval(syncGlobalMemory, 60000);

  /**
   * JOB 2: SAFETY TICKER (3-5s per token)
   */
  const runSafetyTicker = async () => {
    while (true) {
      if (activeWatchlist.length === 0) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      for (const address of activeWatchlist) {
        const price = await provider.getCurrentPrice(address);
        const liq = provider.getPoolLiquidity(address);
        const id = provider.getSymbol(address);
        const history = await redis.getHistory(address);

        await orchestrator.monitorSafety(address, price, liq);
        
        if (price > 0) {
            process.stdout.write(`\r[TICK] ${id.padEnd(10)}: $${price.toFixed(6)} | Liq: $${Math.round(liq/1000)}k | Mem: ${history.length}/7    `);
            await new Promise(r => setTimeout(r, 1200)); // Rate limit safety
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  };
  runSafetyTicker();

  // --- JOB 3: STRATEGIC EVALUATOR ---
  // MODIFIED: Now performs background 60-token evaluation (Requirement 1)
  setInterval(async () => {
    const perf = orchestrator.getFullPerformanceStatus();
    
    // MODIFIED: Dashboard only prints here once per 30s cycle
    console.log(`\n\n` + "=".repeat(75));
    console.log(`--- DASHBOARD | Total PnL: ${perf.totalPnL.toFixed(4)} SOL | Active: ${perf.activeTrades}/3 ---`);
    console.log(`--- Banked: ${perf.realizedPnL.toFixed(4)} SOL | Floating: ${perf.unrealizedPnL.toFixed(4)} SOL ---`);
    console.log("=".repeat(75));

    // REQUIREMENT 1: Evaluate the full 60-token pool in the background
    const hotPool = await MarketScanner.discoverHotTokens(60, []);
    for (const token of hotPool) {
      const history = await redis.getHistory(token.mint);
      if (history.length >= 7) {
        // MODIFIED: Log evaluation reason (Requirement 10)
        const result = await orchestrator.tick(token.mint, history[history.length - 1]!, redis, 5);
        
        if (result.prune && !orchestrator.activePositions.has(token.mint)) {
            activeWatchlist = activeWatchlist.filter(m => m !== token.mint);
        }
      }
    }
  }, 30000);
}

main().catch(console.error);
