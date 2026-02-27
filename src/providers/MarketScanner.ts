import { CONFIG } from "../config.js";

export interface ScannedToken {
  mint: string;
  symbol: string;
  liquidity: number;
  volumeChange24h: number;
  priceChange1h: number;
}

/**
 * MarketScanner V2.4 (Velocity Focused)
 * 
 * Goal: Find the top N tokens on Solana that are actually moving, 
 * not just tokens that paid for a "Boost" ad.
 */
export class MarketScanner {
  // Use the search API to find active Solana pairs
  private static readonly SEARCH_API = "https://api.dexscreener.com/latest/dex/search?q=solana";

  public static async getTrendingTokens(limit: number = 5): Promise<ScannedToken[]> {
    try {
      const response = await fetch(this.SEARCH_API);
      if (!response.ok) return [];

      const data: any = await response.json();
      const pairs = data.pairs || [];

      // 1. FILTER & RANK Logic
      const candidates = pairs
        .filter((p: any) => 
          p.chainId === 'solana' && 
          p.quoteToken.symbol === 'SOL' && 
          (p.liquidity?.usd || 0) >= CONFIG.MIN_LIQUIDITY_USD &&
          (p.volume?.m5 || 0) > 10000 // Increased volume floor for higher quality
        )
        // Sort by Volume Growth (m5) instead of total volume to find "Breakouts"
        .sort((a: any, b: any) => (b.volume?.m5 || 0) - (a.volume?.m5 || 0)) 
        .slice(0, limit);

      return candidates.map((p: any) => ({
        mint: p.baseToken.address,
        symbol: p.baseToken.symbol,
        liquidity: p.liquidity.usd,
        volumeChange24h: p.priceChange.m5 || 0,
        priceChange1h: p.priceChange.h1 || 0
      }));
    } catch (error) {
      console.error("[SCANNER] Failed to build Watchlist:", error);
      return [];
    }
  }
}
