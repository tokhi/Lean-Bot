/**
 * Position represents an active, ongoing trade.
 * Tracks scaling stages and the current risk state.
 */
export interface Position {
  readonly entryPrice: number;
  readonly quantity: number;
  readonly stopPrice: number;  // The current active stop loss (ratcheted)
  readonly stage: 1 | 2 | 3;   // Current progression in asymmetric scaling
  readonly riskAmount: number; // The dollar value of 1R (e.g., $15)
  readonly peakPrice: number;  // The highest price reached since entry (for trailing)
  readonly openTime: number;   // Timestamp of original Stage 1 entry
}

/**
 * TradeResult represents the post-mortem data of a closed trade.
 * Used for simulation performance metrics and expectancy calculation.
 */
export interface TradeResult {
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly Rmultiple: number;             // Net profit/loss expressed in units of R
  readonly duration: number;              // Time elapsed between entry and exit
  readonly maxFavorableExcursion: number; // MFE: Highest profit point reached during trade
  readonly maxAdverseExcursion: number;   // MAE: Lowest drawdown point reached during trade
  readonly stageReached: number;          // robustness tracking
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
