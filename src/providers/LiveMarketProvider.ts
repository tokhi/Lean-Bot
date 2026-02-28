import type { MarketProvider, Candle } from "../types/MarketTypes.js";

export class LiveMarketProvider implements MarketProvider {
  private candleBuffer: Map<string, Candle[]> = new Map();
  private tickBuffer: Map<string, { price: number; vol: number; liq: number }[]> = new Map();
  private symbolMap: Map<string, string> = new Map();
  
  private readonly GECKO_BASE = "https://api.geckoterminal.com/api/v2/networks/solana";

  public setSymbol(mint: string, symbol: string) { this.symbolMap.set(mint, symbol); }
  public getSymbol(mint: string): string { return this.symbolMap.get(mint) || mint.slice(0, 4); }

  /**
   * Public Price Fetcher for Safety Loop
   */
  public async getCurrentPrice(tokenAddress: string): Promise<number> {
    try {
      // Use the search/tokens endpoint to get specific pool data
      const url = `${this.GECKO_BASE}/tokens/${tokenAddress}/pools?page=1`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return 0;

      const json = await res.json() as any;
      const pool = (json.data || []).sort((a: any, b: any) => 
        parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd)
      )[0];

      if (!pool) return 0;
      const attr = pool.attributes;
      const price = parseFloat(attr.base_token_price_usd);
      
      const ticks = this.tickBuffer.get(tokenAddress) || [];
      ticks.push({ price, vol: parseFloat(attr.volume_usd.h1), liq: parseFloat(attr.reserve_in_usd) });
      this.tickBuffer.set(tokenAddress, ticks);

      return price;
    } catch { return 0; }
  }

  public getPoolLiquidity(tokenAddress: string): number {
    const ticks = this.tickBuffer.get(tokenAddress) || [];
    return ticks.length > 0 ? ticks[ticks.length - 1]!.liq : 0;
  }

  public getVolumeDelta(tokenAddress: string) {
    const ticks = this.tickBuffer.get(tokenAddress) || [];
    if (ticks.length < 2) return { buy2m: 1, sell2m: 1 };
    const curr = ticks[ticks.length - 1]!, prev = ticks[ticks.length - 2]!;
    return curr.price >= prev.price ? { buy2m: Math.abs(curr.vol - prev.vol), sell2m: 0 } : { buy2m: 0, sell2m: Math.abs(curr.vol - prev.vol) };
  }

  public rollCandle(tokenAddress: string): void {
    const ticks = this.tickBuffer.get(tokenAddress) || [];
    if (ticks.length === 0) return;
    const p = ticks.map(t => t.price);
    const candle: Candle = {
      timestamp: Date.now(),
      open: p[0]!, high: Math.max(...p), low: Math.min(...p), close: p[p.length-1]!,
      volume: ticks[ticks.length-1]!.vol / 60,
      liquidity: ticks[ticks.length-1]!.liq,
      upperWickPct: 0
    };
    const history = this.candleBuffer.get(tokenAddress) || [];
    history.push(candle);
    this.candleBuffer.set(tokenAddress, history.slice(-20));
    this.tickBuffer.set(tokenAddress, []);
  }

  public getRecentCandles(mint: string, count: number): Candle[] { return (this.candleBuffer.get(mint) || []).slice(-count); }
  public getGlobalBreadth() { return 5; }
}
