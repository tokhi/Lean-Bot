import type { Candle } from "./types/MarketTypes.js";
import { ReplayEngine } from "./simulation/ReplayEngine.js";
import { TradeLogger } from "./simulation/TradeLogger.js";
import type { RobustnessMetrics } from "./simulation/TradeLogger.js";

const DEFAULT_LIQ = 500_000;

function createBaseConsolidation(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i * 60000,
    open: 100, high: 101, low: 99, close: 100, volume: 100, liquidity: DEFAULT_LIQ
  }));
}

/** 1. Fake Breakout: Spikes then collapses */
function generateFakeBreakout(): Candle[] {
  const data = createBaseConsolidation(10);
  data.push({ timestamp: 10 * 60000, open: 100, high: 112, low: 100, close: 111, volume: 500, liquidity: DEFAULT_LIQ });
  data.push({ timestamp: 11 * 60000, open: 111, high: 111, low: 95, close: 96, volume: 1000, liquidity: DEFAULT_LIQ });
  return data;
}

/** 2. Sideways Chop: Volatile within range, no clear trend */
function generateSidewaysChop(): Candle[] {
  const data = createBaseConsolidation(10);
  for (let i = 10; i < 30; i++) {
    const p = 100 + (Math.random() * 4 - 2);
    data.push({ timestamp: i * 60000, open: p, high: p + 1, low: p - 1, close: p, volume: 120, liquidity: DEFAULT_LIQ });
  }
  return data;
}

/** 3. Parabolic Spike: Tests Scaling and ATR/Parabolic ratchet */
function generateParabolicRunner(): Candle[] {
  const data = createBaseConsolidation(10);
  data.push({ timestamp: 10 * 60000, open: 100, high: 115, low: 100, close: 112, volume: 500, liquidity: DEFAULT_LIQ });
  for (let i = 11; i < 25; i++) {
    const last = data[data.length - 1]!.close;
    data.push({ timestamp: i * 60000, open: last, high: last + 10, low: last - 2, close: last + 8, volume: 300, liquidity: DEFAULT_LIQ });
  }
  const peak = data[data.length - 1]!.close;
  data.push({ timestamp: 26 * 60000, open: peak, high: peak + 1, low: peak - 30, close: peak - 25, volume: 800, liquidity: DEFAULT_LIQ });
  return data;
}

async function runRobustnessTest() {
  const logger = new TradeLogger();
  const scenarios = [
    { name: "Fake Breakout", data: generateFakeBreakout(), breadth: 5 },
    { name: "Sideways Chop", data: generateSidewaysChop(), breadth: 5 },
    { name: "Parabolic Runner", data: generateParabolicRunner(), breadth: 5 },
    { name: "Toxic Market", data: generateSidewaysChop(), breadth: -5 }
  ];

  const reports: RobustnessMetrics[] = [];

  for (const scenario of scenarios) {
    const engine = new ReplayEngine(1000, 0.015);
    engine.run(scenario.data, scenario.breadth);
    
    // Transfer engine history to logger
    const history = (engine as any).history;

    history.forEach((h: any) => {
      logger.logTrade(scenario.name, h);
    });

    reports.push(logger.getRobustnessReport(scenario.name, 1000));
  }

  logger.printComparisonTable(reports);
}

runRobustnessTest().catch(console.error);
