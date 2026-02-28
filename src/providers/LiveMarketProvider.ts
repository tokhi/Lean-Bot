import type { MarketProvider, Candle } from "../types/MarketTypes.js";

export class LiveMarketProvider implements MarketProvider {
  private candleBuffer: Map<string, Candle[]> = new Map();
  private tickBuffer: Map<string, { price: number; vol: number; liq: number }[]> = new Map();
  private symbolMap: Map<string, string> = new Map();
  private readonly GECKO_TRENDING = "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1";

  public setSymbol(mint: string, symbol: string) { this.symbolMap.set(mint, symbol); }
  public getSymbol(mint: string): string { return this.symbolMap.get(mint) || mint.slice(0, 4); }

  public async pollPrices(mints: string[]): Promise<void> {
    try {
      const res = await fetch(this.GECKO_TRENDING, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      const json = await res.json() as any;
      const pools = json.data || [];

      for (const mint of mints) {
        const pool = pools.find((p: any) => p.relationships?.base_token?.data?.id === `solana_${mint}`);
        if (pool) {
          const attr = pool.attributes;
          const ticks = this.tickBuffer.get(mint) || [];
          ticks.push({ 
            price: parseFloat(attr.base_token_price_usd), 
            vol: parseFloat(attr.volume_usd.h1), 
            liq: parseFloat(attr.reserve_in_usd) 
          });
          this.tickBuffer.set(mint, ticks);
        }
      }
    } catch (e) {}
  }

  public subscribePriceUpdates(mints: string[], cb: (address: string, price: number) => void): void {
    setInterval(async () => {
      await this.pollPrices(mints);
      for (const mint of mints) {
        const last = this.tickBuffer.get(mint)?.slice(-1)[0];
        if (last) cb(mint, last.price);
      }
    }, 5000);
  }

  public getPoolLiquidity(mint: string): number {
    return this.tickBuffer.get(mint)?.slice(-1)[0]?.liq || 0;
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
  public getVolumeDelta(tokenAddress: string) { return { buy2m: 100, sell2m: 100 }; }
  public getGlobalBreadth() { return 5; }
}
