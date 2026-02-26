import type { Candle } from "./types/MarketTypes.js";
import { ReplayEngine } from "./simulation/ReplayEngine.js";

function generateWinnerData(): Candle[] {
  const candles: Candle[] = [];
  const startPrice = 100;
  const liq = 500_000;

  // 1. Consolidation (15 candles)
  for (let i = 0; i < 15; i++) {
    candles.push({
      timestamp: i * 60000,
      open: startPrice, high: startPrice + 1, low: startPrice - 1, close: startPrice,
      volume: 100, liquidity: liq
    });
  }

  // 2. Breakout
  candles.push({
    timestamp: 15 * 60000,
    open: 100, high: 115, low: 100, close: 112,
    volume: 500, liquidity: liq
  });

  // 3. Steady Expansion (Sequential - no gaps)
  for (let i = 16; i < 40; i++) {
    const last = candles[candles.length - 1]!;
    candles.push({
      timestamp: i * 60000,
      open: last.close, high: last.close + 10, low: last.close - 2, close: last.close + 6,
      volume: 200, liquidity: liq
    });
  }

  // 4. Reversal
  const peak = candles[candles.length - 1]!;
  candles.push({
    timestamp: 40 * 60000,
    open: peak.close, high: peak.close + 1, low: peak.close - 50, close: peak.close - 45,
    volume: 800, liquidity: liq
  });

  return candles;
}

function generateToxicData(): Candle[] {
  const candles: Candle[] = [];
  const liq = 200_000; // Above min threshold but volatile

  for (let i = 0; i < 30; i++) {
    const price = 100 + (Math.random() * 20);
    candles.push({
      timestamp: i * 60000,
      open: price, high: price + 5, low: price - 5, close: price,
      volume: 400, // High volume
      liquidity: liq
    });
  }
  return candles;
}

function main() {
  console.log("=== RUNNING WINNER SIMULATION ===");
  const engine1 = new ReplayEngine(1000, 0.015);
  engine1.run(generateWinnerData(), 5); // Breadth = 5
  console.log(engine1.getStats());

  console.log("\n=== RUNNING TOXIC TEST (Negative Breadth) ===");
  const engine2 = new ReplayEngine(1000, 0.015);
  engine2.run(generateToxicData(), -5); // Breadth = -5 (Should Hibernate)
  console.log(engine2.getStats());
}

main();
