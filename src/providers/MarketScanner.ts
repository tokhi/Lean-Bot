import { CONFIG } from "../config.js";

export interface ScannedToken {
  readonly mint: string;
  readonly symbol: string;
  readonly liquidity: number;
  readonly rankingScore: number;
  readonly type: "IGNITION" | "MODERATE";
}

export class MarketScanner {
  private static readonly GECKO_URL = "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1";
  
  private static readonly BLACKLIST = [
    "So11111111111111111111111111111111111111112", // SOL
    "EPjFW36vnm7HqeogAq6Qg3LXYrDhwd6cfjSbwFrEBdis", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"  // USDT
  ];

  public static async discoverHotTokens(limit: number = 3, excludeMints: string[] = []): Promise<ScannedToken[]> {
    try {
      const response = await fetch(this.GECKO_URL, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'TrendingBot/1.0' }
      });
      if (!response.ok) return [];

      const data = await response.json() as any;
      const pools = data.data || [];
      const results: ScannedToken[] = [];

      for (const pool of pools) {
        const attr = pool.attributes;
        const mint = pool.relationships?.base_token?.data?.id?.split('_')[1];
        const liq = parseFloat(attr.reserve_in_usd || "0");
        const price = parseFloat(attr.base_token_price_usd || "0");

        if (!mint || this.BLACKLIST.includes(mint) || excludeMints.includes(mint)) continue;
        
        // 1. Stability Filter (Exclude SOL/USD pegs)
        if ((price > 0.90 && price < 1.10) || (price > 120 && price < 180)) continue;

        // 2. Dual-Engine Classification
        // Ignition: 40k - 200k | Moderate: 200k - 5M
        let type: "IGNITION" | "MODERATE";
        if (liq >= 40000 && liq <= 200000) {
            type = "IGNITION";
        } else if (liq > 200000 && liq <= 5000000) {
            type = "MODERATE";
        } else {
            continue; // Outside corridor
        }

        results.push({
          mint: mint,
          symbol: attr.name.split(' / ')[0] || "Unknown",
          liquidity: liq,
          type,
          rankingScore: this.calculateHeatScore(attr)
        });
      }

      // Sort by mathematical heat (Price move + Volume Intensity)
      return results.sort((a, b) => b.rankingScore - a.rankingScore).slice(0, limit);
    } catch (e) { return []; }
  }

  private static calculateHeatScore(attr: any): number {
    const p5 = Math.abs(parseFloat(attr.price_change_percentage?.m5 || "0"));
    const v5 = parseFloat(attr.volume_usd?.m5 || "0");
    const liq = parseFloat(attr.reserve_in_usd || "1");
    
    // Intensity: How much volume is attacking the pool depth
    const intensity = Math.min(v5 / liq, 5) * 100;
    return (p5 * 0.5) + (intensity * 0.5);
  }

  public static async validateTokenHealth(mint: string): Promise<boolean> {
    try {
      const url = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      const json: any = await res.json();
      const pool = json.data?.[0]?.attributes;
      if (!pool) return false;
      const liq = parseFloat(pool.reserve_in_usd || "0");
      return liq >= 40000 && liq <= 5000000;
    } catch { return false; }
  }
}
