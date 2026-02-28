/**
 * Position represents an active, ongoing trade.
 * Tracks scaling stages and the current risk state.
 */
export interface Position {
  readonly symbol: string;           // Added: e.g., "Jellybean"
  readonly entryPrice: number;
  readonly quantity: number;
  readonly stopPrice: number;
  readonly stage: 1 | 2 | 3;
  readonly riskAmount: number;
  readonly peakPrice: number;
  readonly openTime: number;
  readonly lastPrice: number;
  readonly breakoutLevel: number;
  readonly initialLiquidity: number;
}
export interface TradeResult {
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly Rmultiple: number;
  readonly duration: number;
  readonly maxFavorableExcursion: number;
  readonly maxAdverseExcursion: number;
  readonly stageReached: number;
  readonly realizedSlippage: number; // Added for detailed auditing
}

/**
 * ExecutionReport captures the details of a dry-run or live transaction.
 */
export interface ExecutionReport {
  readonly timestamp: number;
  readonly action: string;
  readonly tokenAddress: string;
  readonly totalValueUsd: string;
  readonly atomicChunks: number;
  readonly jitoTipSol: number;
}
