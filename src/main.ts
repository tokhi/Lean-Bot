import type { Candle } from "./types/MarketTypes.js";
import { ReplayEngine } from "./simulation/ReplayEngine.js";
import { TradeLogger } from "./simulation/TradeLogger.js";
import type { RobustnessMetrics } from "./simulation/TradeLogger.js";

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

function generateMixedRegimeData(): Candle[] {
  let candles: Candle[] = [];
  let p = 100;

  // 1. Three Fake Breakouts (-1R each)
  for (let i = 0; i < 3; i++) {
    pad(candles, 10, p);
    const ts = candles[candles.length - 1]!.timestamp;
    candles.push({ timestamp: ts + 60000, open: p, high: p + 12, low: p, close: p + 11, volume: 500, liquidity: DEFAULT_LIQ }); // Entry
    candles.push({ timestamp: ts + 120000, open: p + 11, high: p + 11, low: p - 10, close: p - 8, volume: 1000, liquidity: DEFAULT_LIQ }); // Stop
  }

  // 2. 3R winner that reverses
  pad(candles, 10, p);
  let ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 12, low: p, close: p + 11, volume: 500, liquidity: DEFAULT_LIQ }); // Entry
  for (let i = 1; i < 5; i++) {
    const cur = p + 11 + (i * 10); // Reaches ~150 (+3R)
    candles.push({ timestamp: ts + (i+1) * 60000, open: cur - 2, high: cur + 2, low: cur - 5, close: cur, volume: 200, liquidity: DEFAULT_LIQ });
  }
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: 151, high: 151, low: 110, close: 115, volume: 900, liquidity: DEFAULT_LIQ }); // Reversal

  // 3. Small 1.5R winner
  pad(candles, 10, p);
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 12, low: p, close: p + 11, volume: 500, liquidity: DEFAULT_LIQ }); // Entry
  candles.push({ timestamp: ts + 120000, open: p + 11, high: p + 30, low: p + 10, close: p + 28, volume: 300, liquidity: DEFAULT_LIQ }); // Hits ~1.5R
  candles.push({ timestamp: ts + 180000, open: p + 28, high: p + 28, low: p + 15, close: p + 16, volume: 200, liquidity: DEFAULT_LIQ }); // Exit

  // 4. Full Stage 3 Runner
  pad(candles, 10, p);
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 15, low: p, close: p + 12, volume: 600, liquidity: DEFAULT_LIQ });
  for (let i = 1; i < 15; i++) {
    const cur = 112 + (i * 15); // Massive expansion
    candles.push({ timestamp: ts + (i+1) * 60000, open: cur - 5, high: cur + 5, low: cur - 5, close: cur, volume: 300, liquidity: DEFAULT_LIQ });
  }
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: 330, high: 330, low: 250, close: 260, volume: 1000, liquidity: DEFAULT_LIQ }); // Final Exit

  // 5. Sideways false triggers (High volume, no breakout OR Breakout, no volume)
  pad(candles, 10, p);
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 2, low: p - 2, close: p + 1, volume: 800, liquidity: DEFAULT_LIQ }); // Vol, no price
  candles.push({ timestamp: ts + 120000, open: p, high: p + 15, low: p, close: p + 14, volume: 110, liquidity: DEFAULT_LIQ }); // Price, no vol

  // 6. High volatility shakeout
  pad(candles, 10, p);
  ts = candles[candles.length - 1]!.timestamp;
  candles.push({ timestamp: ts + 60000, open: p, high: p + 20, low: p - 15, close: p + 15, volume: 700, liquidity: DEFAULT_LIQ }); // Spike
  candles.push({ timestamp: ts + 120000, open: p + 15, high: p + 15, low: p - 30, close: p - 25, volume: 900, liquidity: DEFAULT_LIQ }); // Dump

  return candles;
}

async function runValidation() {
  const logger = new TradeLogger();
  const scenarioName = "Mixed Regime V2";
  const data = generateMixedRegimeData();
  
  const engine = new ReplayEngine(1000, 0.015);
  engine.run(data, 5);
  
  const history = (engine as any).history;
  history.forEach((h: any) => logger.logTrade(scenarioName, h));

  const report = logger.getRobustnessReport(scenarioName, 1000);
  logger.printComparisonTable([report]);
  logger.printDetailedMetrics(scenarioName, 1000);
}

runValidation().catch(console.error);
