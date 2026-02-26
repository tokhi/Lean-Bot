/**
 * Candle represents a single OHLCV bar with liquidity data.
 * Used for deterministic price action and volume analysis.
 */
export interface Candle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly liquidity: number; // USD value of pool depth at this candle
}

/**
 * MarketProvider is the contract for any data source (Simulated or Live).
 * This ensures the Trading Engine remains 100% deterministic and agnostic 
 * of the transport layer (Websocket vs. Historical JSON).
 */
export interface MarketProvider {
  /**
   * Fetches the latest N candles for a specific token.
   */
  getRecentCandles(tokenAddress: string, count: number): Candle[];

  /**
   * Returns current global market metrics for Regime calculation.
   */
  getGlobalBreadth(): number;

  /**
   * Fetches real-time liquidity depth for a specific pool.
   */
  getPoolLiquidity(tokenAddress: string): number;
}
