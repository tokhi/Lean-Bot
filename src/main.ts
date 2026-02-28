import { CONFIG } from "./config.js";
import { LiveMarketProvider } from "./providers/LiveMarketProvider.js";
import { Orchestrator } from "./Orchestrator.js";
import { OrderExecutor } from "./execution/OrderExecutor.js";
import { MarketScanner } from "./providers/MarketScanner.js";
import { TradeLogger } from "./simulation/TradeLogger.js";

async function main() {
  TradeLogger.log(`=== SOLANA MOMENTUM AGENT V4.6 — GECKO UNIFIED ===`, 'INFO');

  const provider = new LiveMarketProvider();
  (global as any).provider = provider;
  const orchestrator = new Orchestrator(1.0, new OrderExecutor());
  let watchlist: string[] = [];

  const refresh = async () => {
    TradeLogger.log("Refreshing discovery funnel...", 'INFO');
    const trading = Array.from((orchestrator as any).activePositions.keys()) as string[];
    
    // Discover Hot Tokens (Intensity Rank)
    const hot = await MarketScanner.discoverHotTokens(CONFIG.MAX_ACTIVE_TOKENS, watchlist);
    
    if (hot.length === 0 && trading.length === 0) {
        TradeLogger.log("No valid movers in corridor. Waiting...", 'WARN');
    } else {
        watchlist = Array.from(new Set([...trading, ...hot.map(t => t.mint)])).slice(0, 3);
        hot.forEach(t => provider.setSymbol(t.mint, t.symbol));
        TradeLogger.log(`Watchlist: ${watchlist.map(m => provider.getSymbol(m)).join(", ")}`, 'INFO');
    }
  };

  await refresh();
  setInterval(refresh, 300000);

  // Explicit typing (address: string, price: number) fixes TS7006
  provider.subscribePriceUpdates(watchlist, async (addr: string, price: number) => {
    const liq = provider.getPoolLiquidity(addr);
    await orchestrator.monitorSafety(addr, price, liq);
    process.stdout.write(`\r[TICK] ${provider.getSymbol(addr)}: $${price.toFixed(6)} | Liq: $${Math.round(liq/1000)}k    `);
  });

  setInterval(async () => {
    console.log(`\n\n--- DASHBOARD | PnL: $${orchestrator.getFullStatus().currentPnL.toFixed(2)} | Active: ${(orchestrator as any).activePositions.size} ---`);
    for (const m of watchlist) {
      provider.rollCandle(m);
      const hist = provider.getRecentCandles(m, 7);
      if (hist.length >= 7) {
        const current = hist[hist.length-1]!;
        const res = await orchestrator.tick(m, current, hist, 5);
        // Rotation logic if stale
        if (res.prune && !(orchestrator as any).activePositions.has(m)) {
            watchlist = watchlist.filter(item => item !== m);
        }
      } else {
        console.log(`[WAIT] ${provider.getSymbol(m)} building memory: ${hist.length}/7`);
      }
    }
  }, 60000);
}

main().catch(console.error);
