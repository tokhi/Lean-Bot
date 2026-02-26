import type { Candle } from "./types/MarketTypes.js";
import { ReplayEngine } from "./simulation/ReplayEngine.js";
import { TradeLogger } from "./simulation/TradeLogger.js";
import type { RobustnessMetrics } from "./simulation/TradeLogger.js";
import { LiveMarketProvider } from "./providers/LiveMarketProvider.js";
import { Orchestrator } from "./Orchestrator.js";
import { StubExecutionLayer } from "./execution/StubExecutionLayer.js";
import { OrderExecutor } from "./execution/OrderExecutor.js";

/**
 * CONFIGURATION TOGGLE
 * We use type casting here to prevent TypeScript from complaining about 
 * "unintentional comparisons" when we toggle between modes.
 */
const MODE = 'LIVE' as 'SIM' | 'LIVE'; 
const SOL_MINT = "So11111111111111111111111111111111111111112";

// --- SIMULATION DATA GENERATORS ---

const DEFAULT_LIQ = 500_000;

function pad(candles: Candle[], count: number, price: number): void {
  const lastTs = candles.length > 0 ? candles[candles.length - 1]!.timestamp : Date.now();
  for (let i = 1; i <= count; i++) {
    candles.push({
      timestamp: lastTs + i * 60000,
      open: price, high: price + 0.5, low: price - 0.5, close: price,
      volume: 80, liquidity: DEFAULT_LIQ
    });
  }
}

/**
 * Generates the "Mixed Regime V2" dataset.
 * Designed to test: 3 fakes, 1 small win, 1 Stage 3 runner, sideways chop, and shakeouts.
 */
function generateMixedRegimeData(): Candle[] {
  let candles: Candle[] = [];
  let p = 100;

  // 1. Three Fake Breakouts (-1R each)
  for (let i = 0; i < 3; i++) {
    pad(candles, 10, p);
    const ts = candles[candles.length - 1]!.timestamp;
    candles.push({ timestamp: ts + 60000, open: p, high: p + 12, low: p, close: p + 11, volume: 500, liquidity: DEFAULT_LIQ });
    candles.push({ timestamp: ts + 120000, open: p + 11, high: p + 11, low: p - 10, close: p - 8, volume: 1000, liquidity: DEFAULT_LIQ });
  }

  // 2. Breakout that reaches 3R then reverses
  pad(candles, 10, p);
  let ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 12, low: p, close: p + 11, volume: 500, liquidity: DEFAULT_LIQ });
  for (let i = 1; i < 5; i++) {
    const cur = 111 + (i * 10); // Escalating to ~151
    candles.push({ timestamp: ts + (i+1) * 60000, open: cur - 2, high: cur + 2, low: cur - 5, close: cur, volume: 200, liquidity: DEFAULT_LIQ });
  }
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: 151, high: 151, low: 110, close: 115, volume: 900, liquidity: DEFAULT_LIQ });

  // 3. Small 1.5R winner
  pad(candles, 10, p);
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 12, low: p, close: p + 11, volume: 500, liquidity: DEFAULT_LIQ });
  candles.push({ timestamp: ts + 120000, open: p + 11, high: p + 30, low: p + 10, close: p + 28, volume: 300, liquidity: DEFAULT_LIQ });
  candles.push({ timestamp: ts + 180000, open: p + 28, high: p + 28, low: p + 15, close: p + 16, volume: 200, liquidity: DEFAULT_LIQ });

  // 4. Full Stage 3 Runner
  pad(candles, 10, p);
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 15, low: p, close: p + 12, volume: 600, liquidity: DEFAULT_LIQ });
  for (let i = 1; i < 15; i++) {
    const cur = 112 + (i * 15);
    candles.push({ timestamp: ts + (i+1) * 60000, open: cur - 5, high: cur + 5, low: cur - 5, close: cur, volume: 300, liquidity: DEFAULT_LIQ });
  }
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: 330, high: 330, low: 250, close: 260, volume: 1000, liquidity: DEFAULT_LIQ });

  // 5. Sideways false triggers
  pad(candles, 10, p);
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 2, low: p - 2, close: p + 1, volume: 800, liquidity: DEFAULT_LIQ });
  candles.push({ timestamp: ts + 120000, open: p, high: p + 15, low: p, close: p + 14, volume: 110, liquidity: DEFAULT_LIQ });

  // 6. High volatility shakeout
  pad(candles, 10, p);
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 20, low: p - 15, close: p + 15, volume: 700, liquidity: DEFAULT_LIQ });
  candles.push({ timestamp: ts + 120000, open: p + 15, high: p + 15, low: p - 30, close: p - 25, volume: 900, liquidity: DEFAULT_LIQ });

  return candles;
}

// --- EXECUTION MODES ---

async function runSimulation() {
  console.log("=== STARTING ROBUSTNESS VALIDATION: MIXED REGIME V2 ===");
  const logger = new TradeLogger();
  const data = generateMixedRegimeData();
  const engine = new ReplayEngine(1000, 0.015);

  engine.run(data, 5);
  
  const history = (engine as any).history;
  history.forEach((h: any) => logger.logTrade("Mixed Regime V2", h));

  const report = logger.getRobustnessReport("Mixed Regime V2", 1000);
  logger.printComparisonTable([report]);
  logger.printDetailedMetrics("Mixed Regime V2", 1000);
}

async function runLivePilot(tokenMint: string) {
  console.log(`\n=== STARTING LIVE PILOT: ${tokenMint} ===`);
  const provider = new LiveMarketProvider();
  const orchestrator = new Orchestrator(1000, new OrderExecutor());

  provider.subscribePriceUpdates([tokenMint], (price) => {
    const liq = provider.getPoolLiquidity(tokenMint);
    process.stdout.write(
      `\r[TICK] ${new Date().toLocaleTimeString()} | Price: $${price.toFixed(6)} | Liquidity: $${liq.toLocaleString()} | History: ${provider.getRecentCandles(tokenMint, 20).length}/7`
    );
  });

  setInterval(async () => {
    console.log(`\n[SYSTEM] Rolling candle for ${tokenMint}...`);
    provider.rollCandle(tokenMint);
    
    const candles = provider.getRecentCandles(tokenMint, 7);
    if (candles.length >= 7) {
      const current = candles[candles.length - 1]!;
      await orchestrator.tick(current, candles, provider.getGlobalBreadth());
    }
  }, 60000);
}

// --- MAIN ENTRY ---

if (MODE === 'SIM') {
  runSimulation().catch(console.error);
} else {
  runLivePilot(SOL_MINT).catch(console.error);
}
