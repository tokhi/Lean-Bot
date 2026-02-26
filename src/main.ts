import type { Candle } from "./types/MarketTypes.js";
import { ReplayEngine } from "./simulation/ReplayEngine.js";

/**
 * Generates a synthetic "Winner" dataset.
 */
function generateMockData(): Candle[] {
  const candles: Candle[] = [];
  const initialPrice = 100;
  const initialLiquidity = 500_000;

  for (let i = 0; i < 10; i++) {
    candles.push({
      timestamp: Date.now() + i * 60000,
      open: initialPrice,
      high: initialPrice + 1,
      low: initialPrice - 1,
      close: initialPrice,
      volume: 100,
      liquidity: initialLiquidity
    });
  }

  // Breakout
  candles.push({
    timestamp: Date.now() + 11 * 60000,
    open: 100,
    high: 115,
    low: 100,
    close: 112,
    volume: 500,
    liquidity: initialLiquidity
  });

  // Expansion
  for (let i = 12; i < 25; i++) {
    const prev = candles[candles.length - 1];
    if (!prev) continue;
    candles.push({
      timestamp: Date.now() + i * 60000,
      open: prev.close,
      high: prev.close + 10,
      low: prev.close - 2,
      close: prev.close + 8,
      volume: 300,
      liquidity: initialLiquidity
    });
  }

  return candles;
}

/**
 * Generates a "Toxic" dataset designed to trigger Hibernate/Drawdown.
 */
function generateToxicData(): Candle[] {
  const candles: Candle[] = [];
  const startPrice = 100;

  for (let i = 0; i < 30; i++) {
    const vol = (Math.random() - 0.5) * 10;
    candles.push({
      timestamp: Date.now() + i * 60000,
      open: startPrice + vol,
      high: startPrice + vol + 5,
      low: startPrice + vol - 5,
      close: startPrice + vol,
      volume: 50, // Low volume = No breakout
      liquidity: 50_000 // Thin liquidity
    });
  }
  return candles;
}

function main() {
  console.log("--- RUNNING WINNER SIMULATION ---");
  const winData = generateMockData();
  const engine1 = new ReplayEngine(1000, 0.015);
  engine1.run(winData);
  console.log(engine1.getStats());

  console.log("\n--- RUNNING TOXIC STRESS TEST ---");
  const toxicData = generateToxicData();
  const engine2 = new ReplayEngine(1000, 0.015);
  engine2.run(toxicData); 
  console.log(engine2.getStats());
}

main();
