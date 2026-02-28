/**
 * Candle represents a single OHLCV bar with liquidity data.
 * Used for deterministic price action and volume analysis.
 */
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  liquidity: number;
  upperWickPct: number;
}

export enum EngineType {
  IGNITION = "IGNITION",
  MODERATE = "MODERATE"
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
