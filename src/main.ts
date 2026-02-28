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
  const syncDiscovery = async () => {
    try {
      const rawPools = await MarketScanner.discoverBroadUniverse();
      if (rawPools.length === 0) return;

      for (const pool of rawPools) {
        const mint = pool.relationships?.base_token?.data?.id?.split('_')[1];
        if (!mint) continue;
        const attr = pool.attributes;
        provider.setSymbol(mint, attr.name.split(' / ')[0]);
        const candle: Candle = {
          timestamp: Date.now(),
          open: parseFloat(attr.base_token_price_usd),
          high: parseFloat(attr.base_token_price_usd),
          low: parseFloat(attr.base_token_price_usd),
          close: parseFloat(attr.base_token_price_usd),
          volume: parseFloat(attr.volume_usd.m5 || "0"),
          liquidity: parseFloat(attr.reserve_in_usd || "0"),
          upperWickPct: 0
        };
        await redis.pushCandle(mint, candle);
      }

      const hot = await MarketScanner.discoverHotTokens(CONFIG.MAX_ACTIVE_TOKENS, []);
      const trading = Array.from((orchestrator as any).activePositions.keys()) as string[];
      activeWatchlist = Array.from(new Set([...trading, ...hot.map(t => t.mint)])).slice(0, CONFIG.MAX_ACTIVE_TOKENS);
      
      TradeLogger.log(`Watchlist Synced: ${activeWatchlist.map(m => provider.getSymbol(m)).join(", ")}`, 'INFO');
    } catch (e) {
      TradeLogger.log(`Discovery Sync Error: ${e}`, 'ERROR');
    }
  };

  await syncDiscovery();
  setInterval(syncDiscovery, 60000);

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

  /**
   * JOB 3: STRATEGIC EVALUATOR (Every 30s)
   */
  setInterval(async () => {
    const status = orchestrator.getFullStatus();
    console.log(`\n\n` + "=".repeat(75));
    console.log(`--- DASHBOARD | PnL: $${status.currentPnL.toFixed(2)} | Active: ${(orchestrator as any).activePositions.size} ---`);
    console.log("=".repeat(75));

    for (const mint of activeWatchlist) {
      const history = await redis.getHistory(mint);
      if (history.length >= 7) {
        const currentCandle = history[history.length - 1]!;
        const decision = await orchestrator.tick(mint, currentCandle, redis, 5);
        
        if (decision.prune && !(orchestrator as any).activePositions.has(mint)) {
            TradeLogger.log(`[WATCHLIST] Rotating stale token: ${provider.getSymbol(mint)}`, 'INFO');
            activeWatchlist = activeWatchlist.filter(m => m !== mint);
        }
      } else {
        console.log(`[WAIT] ${provider.getSymbol(mint)} warming memory... (${history.length}/7)`);
      }
    }
  }, 30000);
}

main().catch(console.error);
