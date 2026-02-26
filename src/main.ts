import type { Candle } from "./types/MarketTypes.js";
import { Orchestrator } from "./Orchestrator.js";
import { StubExecutionLayer } from "./execution/StubExecutionLayer.js";

function generateLongRunnerData(): Candle[] {
  const candles: Candle[] = [];
  const start = 100;
  // 1. Consolidation
  for (let i = 0; i < 10; i++) {
    candles.push({ timestamp: Date.now() + i * 60000, open: start, high: start + 1, low: start - 1, close: start, volume: 100, liquidity: 500000 });
  }
  // 2. Breakout & Rally (To trigger Scale 2 and 3)
  for (let i = 11; i < 30; i++) {
    const p = start + (i - 10) * 10; // Rapid $10 increase per candle
    candles.push({ timestamp: Date.now() + i * 60000, open: p - 5, high: p + 2, low: p - 6, close: p, volume: i === 11 ? 1000 : 300, liquidity: 500000 });
  }
  // 3. Realistic Reversal (Slow enough to hit the stop near the target)
  candles.push({ 
    timestamp: Date.now() + 31 * 60000, 
    open: 300, 
    high: 301, 
    low: 250, // This will trigger the $263 stop
    close: 255, 
    volume: 900, 
    liquidity: 500000 
  });
  return candles;
}

async function runDryRun() {
  console.log("=== STARTING DYNAMIC DRY RUN (V2.1) ===");
  const data = generateLongRunnerData();
  const orchestrator = new Orchestrator(1000, new StubExecutionLayer());

  for (let i = 6; i < data.length; i++) {
    await orchestrator.tick(data[i]!, data.slice(0, i + 1), 5);
  }
  console.log("=== DRY RUN COMPLETE ===");
}

runDryRun().catch(console.error);
