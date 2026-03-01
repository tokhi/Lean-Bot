import { CONFIG } from "./config.js";
import { LiveMarketProvider } from "./providers/LiveMarketProvider.js";
import { Orchestrator } from "./Orchestrator.js";
import { OrderExecutor } from "./execution/OrderExecutor.js";
import { MarketScanner } from "./providers/MarketScanner.js";
import { TradeLogger } from "./simulation/TradeLogger.js";
import { RedisProvider } from "./providers/RedisProvider.js";
import type { Candle } from "./types/MarketTypes.js";

function classifyMode(history: Candle[]): 'IGNITION' | 'MODERATE' {
  if (history.length < 2) return 'MODERATE';
  const lastIdx = history.length - 1;
  const prevIdx = history.length - 2;
  const last = history[lastIdx]!;
  const prev = history[prevIdx]!;
  const pctChange = (last.close - prev.close) / prev.close;
  return pctChange > 0.10 ? 'IGNITION' : 'MODERATE';
}

function isSpike(history: Candle[]): boolean {
  if (history.length < 6) return false;
  const recentAvgVol = history.slice(-3).reduce((s, c) => s + c.volume, 0) / 3;
  const prevAvgVol  = history.slice(-6, -3).reduce((s, c) => s + c.volume, 0) / 3;
  const last = history[history.length - 1]!;
  const prev = history[history.length - 2]!;
  return (
    recentAvgVol > prevAvgVol * 2.0 &&
    last.close > last.open &&
    last.liquidity > prev.liquidity * 1.15
  );
}

function isReversal(history: Candle[]): boolean {
  if (history.length < 5) return false;
  const recent = history.slice(-3).map(c => c.close);
  const prior  = history.slice(-5, -3).map(c => c.close);
  const avgRecent = recent.reduce((s, v) => s + v, 0) / recent.length;
  const avgPrior  = prior.reduce((s, v) => s + v, 0) / prior.length;
  return avgRecent > avgPrior * 1.03 && recent[recent.length - 1]! > recent[0]!;
}

async function antiRugCheck(mint: string, liquidityUSD: number, provider: LiveMarketProvider): Promise<boolean> {
  // Placeholder – replace with real checks (Birdeye / Dexscreener / holder API)
  const liqRisk     = liquidityUSD < 50000 ? 40 : 0;
  const holderRisk  = Math.random() * 100 > 60 ? 0 : 35; // simulate
  const devRisk     = Math.random() * 100 > 80 ? 0 : 25; // simulate
  const rugScore    = liqRisk + holderRisk + devRisk;

  TradeLogger.log(`[ANTI-RUG ${provider.getSymbol(mint) || mint.slice(0,6)}] score ${rugScore}/100`, 'INFO');
  return rugScore < 60;
}

async function main() {
  console.log(`
===========================================================================
   SOLANA MOMENTUM AGENT V5.5 — GLOBAL MEMORY ENGINE
   MODE: FULL | REDIS: ACTIVE | WATCHING: TOP 60
===========================================================================`);

  const redis = new RedisProvider();
  await redis.connect();

  const provider = new LiveMarketProvider();
  (global as any).provider = provider;

  const orchestrator = new Orchestrator(1.0, new OrderExecutor());

  let activeWatchlist: string[] = [];

  // JOB 1: GLOBAL MEMORY REFRESH
  const refreshGlobalMemory = async () => {
    try {
      const pools = await MarketScanner.discoverBroadUniverse();
      for (const pool of pools) {
        const mint = pool.relationships?.base_token?.data?.id?.split('_')[1];
        if (!mint) continue;

        const attr = pool.attributes;
        provider.setSymbol(mint, attr.name.split(' / ')[0]);

        await redis.pushCandle(mint, {
          timestamp: Date.now(),
          open:      parseFloat(attr.base_token_price_usd),
          high:      parseFloat(attr.base_token_price_usd),
          low:       parseFloat(attr.base_token_price_usd),
          close:     parseFloat(attr.base_token_price_usd),
          volume:    parseFloat(attr.volume_usd?.m5 || "0"),
          liquidity: parseFloat(attr.reserve_in_usd || "0"),
          upperWickPct: 0,
        });
      }

      const trading = Array.from(orchestrator.activePositions.keys());
      const hot = await MarketScanner.discoverHotTokens(CONFIG.MAX_ACTIVE_TOKENS, activeWatchlist);
      activeWatchlist = [...new Set([...trading, ...activeWatchlist, ...hot.map(t => t.mint)])].slice(0, 60);

      TradeLogger.log(`Watchlist Synced: ${activeWatchlist.map(m => provider.getSymbol(m) || m.slice(0,6)).join(", ")}`, 'INFO');
    } catch (err: any) {
      TradeLogger.log(`Memory refresh error: ${err.message}`, 'ERROR');
    }
  };

  await refreshGlobalMemory();
  setInterval(refreshGlobalMemory, 60_000);

  // JOB 2: SAFETY TICKER
  (async () => {
    while (true) {
      if (activeWatchlist.length === 0) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      for (const mint of activeWatchlist) {
        const price = await provider.getCurrentPrice(mint);
        const liq   = provider.getPoolLiquidity(mint);
        const sym   = provider.getSymbol(mint) || mint.slice(0,6);

        if (price > 0) {
          await orchestrator.monitorSafety(mint, price, liq);
          const histLen = (await redis.getHistory(mint)).length;
          process.stdout.write(`\r[TICK] ${sym.padEnd(10)}: $${price.toFixed(6)} | Liq: $${Math.round(liq/1000)}k | Mem: ${histLen}/7    `);
        }
        await new Promise(r => setTimeout(r, 800));
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  })();

  // JOB 3: STRATEGY EVALUATOR + ENTRY/EXIT
  setInterval(async () => {
    const perf = orchestrator.getFullPerformanceStatus();

    console.log(`\n\n` + "=".repeat(75));
    console.log(`--- DASHBOARD | Total PnL: ${perf.totalPnL.toFixed(4)} SOL | Active: ${perf.activeTrades}/3 ---`);
    console.log(`--- Banked: ${perf.realizedPnL.toFixed(4)} SOL | Floating: ${perf.unrealizedPnL.toFixed(4)} SOL ---`);
    console.log("=".repeat(75));

    const candidates = await MarketScanner.discoverHotTokens(60, []);
    for (const token of candidates) {
      const mint = token.mint;
      const history = await redis.getHistory(mint);
      if (history.length < 7) continue;

      const lastCandle = history[history.length - 1]!; // safe after length check

      const price = lastCandle.close;
      const liq   = lastCandle.liquidity;
      const sym   = provider.getSymbol(mint) || mint.slice(0,6);

      const mode = classifyMode(history);
      TradeLogger.log(`[MODE] ${sym} → ${mode}`, 'INFO');

      // Stop-loss check
      if (orchestrator.activePositions.has(mint)) {
        const pos = orchestrator.activePositions.get(mint)!;
        const slPrice = pos.entryPrice * 0.90;
        if (price <= slPrice) {
          await orchestrator.exitPosition(mint, price, "Stop-loss 10% triggered");
        }
      }
      // Entry logic
      else if (orchestrator.activePositions.size < 3) {
        const passRug   = await antiRugCheck(mint, liq, provider);
        const hasSpike  = isSpike(history);
        const hasRevers = isReversal(history);

        if (passRug && (hasSpike || hasRevers)) {
          if (hasSpike)  TradeLogger.log(`[SPIKE DETECTED] ${sym}`, 'INFO');
          if (hasRevers) TradeLogger.log(`[REVERSAL DETECTED] ${sym}`, 'INFO');

          const allocSOL = mode === 'IGNITION' ? 1.0 : 2.0;
          const success = await orchestrator.enterPosition(
            mint,
            allocSOL,
            price,
            liq,                // currentLiquidity
            price * 1.05        // example breakoutLevel; replace with real calc from history if available
          );
          if (success) {
            TradeLogger.log(`[ENTRY] ${sym} in ${mode} mode | ${allocSOL} SOL @ $${price.toFixed(6)}`, 'TRADE');
          }
        } else {
          TradeLogger.log(`[REJECT] ${sym} | rug:${passRug} spike:${hasSpike} rev:${hasRevers}`, 'INFO');
        }
      }

      const result = await orchestrator.tick(mint, lastCandle, redis, 5);
      if (result.prune && !orchestrator.activePositions.has(mint)) {
        activeWatchlist = activeWatchlist.filter(m => m !== mint);
      }
    }
  }, 30_000);
}

main().catch(err => console.error("Main crashed:", err));
