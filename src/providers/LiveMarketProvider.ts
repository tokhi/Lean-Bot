import type { MarketProvider, Candle } from "../types/MarketTypes.js";

/**
 * LiveMarketProvider V2.2 (DexScreener Implementation)
 * 
 * Logic:
 * 1. Fetches data from DexScreener Public API.
 * 2. Sorts available pairs by USD liquidity to find the "Main" pool.
 * 3. Builds deterministic 1-minute OHLCV candles from real-time ticks.
 * 4. Provides real-time Liquidity and Volume data for the Core Engines.
 */
export class LiveMarketProvider implements MarketProvider {
  private candleBuffer: Map<string, Candle[]> = new Map();
  private tickBuffer: Map<string, { price: number; vol: number; liq: number }[]> = new Map();
  
  private readonly DEX_API_URL = "https://api.dexscreener.com/latest/dex/tokens/";

  /**
   * Fetches the current price and microstructure from the most liquid pool.
   */
  public async getCurrentPrice(tokenAddress: string): Promise<number> {
    try {
      const response = await fetch(`${this.DEX_API_URL}${tokenAddress}`);
      if (!response.ok) return 0;

      const json = await response.json();
      const pairs = json.pairs || [];

      const mainPair = pairs.sort((a: any, b: any) => 
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0];

      if (!mainPair) return 0;

      const price = parseFloat(mainPair.priceUsd);
      
      // DEBUG: Ensure we aren't seeing the exact same volume/price every time
      // console.log(`[DEBUG] Received Price: ${price} | Last Trade: ${mainPair.pairCreatedAt}`);

      const liquidity = mainPair.liquidity?.usd || 0;
      const volume = mainPair.volume?.m5 || 0; 

      const ticks = this.tickBuffer.get(tokenAddress) || [];
      ticks.push({ price, vol: volume, liq: liquidity });
      this.tickBuffer.set(tokenAddress, ticks);

      return price;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Returns the latest USD liquidity from the tick buffer.
   */
  public getPoolLiquidity(tokenAddress: string): number {
    const ticks = this.tickBuffer.get(tokenAddress) || [];
    if (ticks.length === 0) return 0;
    return ticks[ticks.length - 1]!.liq;
  }

  /**
   * Aggregates raw ticks into a deterministic 1-minute OHLCV candle.
   * Called by the Orchestrator on every 60-second interval.
   */
  public rollCandle(tokenAddress: string): void {
    const ticks = this.tickBuffer.get(tokenAddress) || [];
    if (ticks.length === 0) return;

    const prices = ticks.map(t => t.price);
    const latestLiq = ticks[ticks.length - 1]!.liq;
    const latestVol = ticks[ticks.length - 1]!.vol;

    const newCandle: Candle = {
      timestamp: Date.now(),
      open: prices[0]!,
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1]!,
      volume: latestVol, 
      liquidity: latestLiq
    };

    const history = this.candleBuffer.get(tokenAddress) || [];
    history.push(newCandle);

    // Keep only last 20 candles for EntryEngine lookback
    if (history.length > 20) history.shift();
    this.candleBuffer.set(tokenAddress, history);

    // Clear ticks to start the next 1-minute window
    this.tickBuffer.set(tokenAddress, []);
  }

  /**
   * Polling subscription for real-time console monitoring.
   */
  public subscribePriceUpdates(tokenAddresses: string[], callback: (price: number) => void): void {
    setInterval(async () => {
      for (const address of tokenAddresses) {
        const price = await this.getCurrentPrice(address);
        if (price > 0) callback(price);
      }
    }, 3000); // 3-second interval to stay within DexScreener rate limits
  }

  // --- MarketProvider Interface Support ---

  public getRecentCandles(tokenAddress: string, count: number): Candle[] {
    const history = this.candleBuffer.get(tokenAddress) || [];
    return history.slice(-count);
  }

  public getGlobalBreadth(): number {
    // Phase 3 Pilot: Hardcoded to 5 (Expansion) to allow trading logic to evaluate.
    return 5;
  }
}
