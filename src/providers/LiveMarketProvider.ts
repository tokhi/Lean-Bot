import type { MarketProvider, Candle } from "../types/MarketTypes.js";

export class LiveMarketProvider implements MarketProvider {
  private candleBuffer: Map<string, Candle[]> = new Map();
  private tickBuffer: Map<string, { price: number; vol: number; liq: number }[]> = new Map();
  
  private readonly DEX_API_URL = "https://api.dexscreener.com/latest/dex/tokens/";

public async getCurrentPrice(tokenAddress: string): Promise<number> {
    try {
      // DEBUG: Prove the bot is trying to talk to the internet
      // console.log(`[NETWORK] Polling DexScreener for ${tokenAddress.slice(0,4)}...`);

      const response = await fetch(`${this.DEX_API_URL}${tokenAddress}`, {
        signal: AbortSignal.timeout(5000) // 5s timeout to prevent hanging
      });
      
      if (!response.ok) return 0;

      const json: any = await response.json();
      const pair = json.pairs?.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

      if (!pair) return 0;

      const price = parseFloat(pair.priceUsd);
      const liquidity = pair.liquidity?.usd || 0;
      const volume = pair.volume?.m5 || 0; 

      const ticks = this.tickBuffer.get(tokenAddress) || [];
      ticks.push({ price, vol: volume, liq: liquidity });
      this.tickBuffer.set(tokenAddress, ticks);

      return price;
    } catch (error) {
      console.error(`[NETWORK ERROR] Check your internet/DNS:`, error);
      return 0;
    }
  }
  public getPoolLiquidity(tokenAddress: string): number {
    const ticks = this.tickBuffer.get(tokenAddress) || [];
    return ticks.length > 0 ? ticks[ticks.length - 1]!.liq : 0;
  }

  public rollCandle(tokenAddress: string): void {
    const ticks = this.tickBuffer.get(tokenAddress) || [];
    if (ticks.length === 0) {
        console.warn(`[CANDLE] Cannot roll ${tokenAddress.slice(0,4)}: No ticks received in last 60s.`);
        return;
    }

    const prices = ticks.map(t => t.price);
    const newCandle: Candle = {
      timestamp: Date.now(),
      open: prices[0]!,
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1]!,
      volume: ticks[ticks.length - 1]!.vol, 
      liquidity: ticks[ticks.length - 1]!.liq
    };

    const history = this.candleBuffer.get(tokenAddress) || [];
    history.push(newCandle);
    if (history.length > 20) history.shift();
    this.candleBuffer.set(tokenAddress, history);
    this.tickBuffer.set(tokenAddress, []); // Reset
    
    console.log(`[CANDLE] ${tokenAddress.slice(0,4)} rolled. History: ${history.length}/7`);
  }

 public subscribePriceUpdates(tokenAddresses: string[], callback: (address: string, price: number) => void): void {
    // Clear existing intervals if you add logic for that, but for now:
    setInterval(async () => {
      // Logic: Poll ALL tokens in parallel so one slow API call doesn't block the rest
      await Promise.all(tokenAddresses.map(async (address) => {
        try {
          const price = await this.getCurrentPrice(address);
          if (price > 0) {
            callback(address, price);
          }
        } catch (err) {
          // Per-token error handling to prevent loop crash
          console.error(`[POLL ERROR] ${address.slice(0,4)}:`, err);
        }
      }));
    }, 4000); // 4s interval
  }

  public getRecentCandles(tokenAddress: string, count: number): Candle[] {
    return (this.candleBuffer.get(tokenAddress) || []).slice(-count);
  }

  public getGlobalBreadth(): number { return 5; }
}
