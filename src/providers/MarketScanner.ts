import { CONFIG } from "../config.js";

export interface ScannedToken {
  readonly mint: string;
  readonly symbol: string;
  readonly liquidity: number;
  readonly rankingScore: number;
  readonly type: "IGNITION" | "MODERATE";
}

/**
 * MarketScanner V5.0 (Wide-Net Predator)
 * 
 * Logic:
 * 1. Wide-Net Discovery: Fetches 3 pages (Top 60) of trending pools in parallel.
 * 2. Trending-Only Validation: Health checks are performed against the cached 60-token universe.
 * 3. BANNED: /networks/solana/tokens/ endpoint is strictly prohibited.
 */
export class MarketScanner {
  private static readonly GECKO_BASE_URL = "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools";
  
  private static lastTrendingPools: any[] = [];
  private static recentlyPruned: Map<string, number> = new Map();
  private static readonly COOLDOWN_DURATION_MS = 30 * 60 * 1000;

  private static readonly STABLE_BLACKLIST = [
    "So11111111111111111111111111111111111111112", // SOL
    "EPjFW36vnm7HqeogAq6Qg3LXYrDhwd6cfjSbwFrEBdis", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"  // USDT
  ];

  public static addToCooldown(mint: string): void {
    this.recentlyPruned.set(mint, Date.now());
  }

  /**
   * MODIFIED: Strictly fetches Page 1, 2, and 3 (Requirement 1 & 9)
   */
  public static async discoverBroadUniverse(): Promise<any[]> {
    try {
      const pages = [1, 2, 3];
      const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
      
      const dataResults = await Promise.all(pages.map(async (page) => {
          const res = await fetch(`${this.GECKO_BASE_URL}?page=${page}`, { headers });
          return res.ok ? res.json() : { data: [] };
      }));
      
      this.lastTrendingPools = dataResults.flatMap((d: any) => d.data || []);
      return this.lastTrendingPools;
    } catch { return []; }
  }

  /**
   * Ranks the cached 60-token universe using Heat Score 2.0.
   */
  public static async discoverHotTokens(limit: number = 3, excludeMints: string[] = []): Promise<ScannedToken[]> {
    if (this.lastTrendingPools.length === 0) await this.discoverBroadUniverse();
    // ... cooldown cleanup remains unchanged

    const results: ScannedToken[] = [];
    for (const pool of this.lastTrendingPools) {
      const attr = pool.attributes;
      const mint = pool.relationships?.base_token?.data?.id?.split('_')[1];
      const liq = parseFloat(attr.reserve_in_usd || "0");
      const price = parseFloat(attr.base_token_price_usd || "0");

      if (!mint || this.STABLE_BLACKLIST.includes(mint) || excludeMints.includes(mint)) continue;
      if ((price > 0.90 && price < 1.10) || (price > 120 && price < 180)) continue;

      // ADDED: Dual-Engine Classification (Requirement 3)
      let type: "IGNITION" | "MODERATE" | null = null;
      if (liq >= CONFIG.MIN_LIQUIDITY_USD && liq <= CONFIG.IGNITION_LIQ_UPPER) type = "IGNITION";
      else if (liq > CONFIG.IGNITION_LIQ_UPPER && liq <= CONFIG.MAX_LIQUIDITY_USD) type = "MODERATE";

      if (type) {
        results.push({
          mint, symbol: attr.name.split(' / ')[0], liquidity: liq, type,
          rankingScore: this.calculateHeatScore(attr)
        });
      }
    }
    return results.sort((a, b) => b.rankingScore - a.rankingScore).slice(0, limit);
  }

  /**
   * Health Validation — PERMITTED LOGIC
   * Strictly uses the last cached 60-token snapshot.
   */
  public static async validateTokenHealth(mint: string): Promise<boolean> {
    const pool = this.lastTrendingPools.find(p => p.relationships?.base_token?.data?.id === `solana_${mint}`);
    if (!pool) return false; // Not in Top 60 = Loss of Momentum

    const liq = parseFloat(pool.attributes.reserve_in_usd || "0");
    return liq >= 40000;
  }

  private static calculateHeatScore(attr: any): number {
    const p5 = Math.abs(parseFloat(attr.price_change_percentage?.m5 || "0"));
    const v5 = parseFloat(attr.volume_usd?.m5 || "0");
    const liq = parseFloat(attr.reserve_in_usd || "1");
    const intensity = Math.min(v5 / liq, 10) * 100;
    return (p5 * 0.6) + (intensity * 4.0); 
  }
}
