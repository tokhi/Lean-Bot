import type { MarketProvider, Candle } from "../types/MarketTypes.js";

/**
 * LiveMarketProvider V2.1 (DexScreener Implementation)
 * 
 * Logic:
 * 1. Uses DexScreener Free API (No Key Required).
 * 2. Fetches Price, Real Liquidity, and Volume in one call.
 * 3. Builds 1-minute OHLCV candles from ticks.
 */
export class LiveMarketProvider implements MarketProvider {
  private candleBuffer: Map<string, Candle[]> = new Map();
  private tickBuffer: Map<string, { price: number; vol: number; liq: number }[]> = new Map();
  
  private readonly DEX_API_URL = "https://api.dexscreener.com/latest/dex/tokens/";

  public async getCurrentPrice(tokenAddress: string): Promise<number> {
    try {
      const response = await fetch(`${this.DEX_API_URL}${tokenAddress}`);
      if (!response.ok) return 0;

      const json = await response.json();
      const pair = json.pairs?.[0]; // Get the primary liquidity pool (usually Raydium)

      if (!pair) {
        console.warn(`[LIVE PROVIDER] No pool found for ${tokenAddress}`);
        return 0;
      }

      const price = parseFloat(pair.priceUsd);
      const liquidity = pair.liquidity?.usd || 0;
      const volume = pair.volume?.m5 || 0; // Use 5-minute volume as a proxy

      // Store tick data
      const ticks = this.tickBuffer.get(tokenAddress) || [];
      ticks.push({ price, vol: volume, liq: liquidity });
      this.tickBuffer.set(tokenAddress, ticks);

      return price;
    } catch (error) {
      console.error(`[LIVE PROVIDER] DexScreener Error:`, error);
      return 0;
    }
  }

  public getPoolLiquidity(tokenAddress: string): number {
    const ticks = this.tickBuffer.get(tokenAddress) || [];
    if (ticks.length === 0) return 0;
    return ticks[ticks.length - 1]!.liq; // Return latest real liquidity
  }

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
    if (history.length > 20) history.shift();
    this.candleBuffer.set(tokenAddress, history);

    this.tickBuffer.set(tokenAddress, []);
  }

  public subscribePriceUpdates(tokenAddresses: string[], callback: (price: number) => void): void {
    setInterval(async () => {
      for (const address of tokenAddresses) {
        const price = await this.getCurrentPrice(address);
        if (price > 0) callback(price);
      }
    }, 3000); // 3s interval to be respectful to DexScreener
  }

  public getRecentCandles(tokenAddress: string, count: number): Candle[] {
    return (this.candleBuffer.get(tokenAddress) || []).slice(-count);
  }

  public getGlobalBreadth(): number {
    return 5;
  }
}
