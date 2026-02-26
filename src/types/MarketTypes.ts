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
