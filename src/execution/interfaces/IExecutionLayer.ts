
/**
 * Result of an on-chain or simulated transaction.
 */
export interface ExecutionResult {
  readonly filledPrice: number;
  readonly filledQuantity: number;
  readonly slippage: number;
  readonly rawTxHash: string;
}

/**
 * Configuration for a specific swap request.
 * V5.5 Update: Added 'amountSol' to support native SOL fixed allocation logic.
 */
export interface ExecutionOptions {
  readonly tokenAddress: string;
  readonly amountUsd?: number;      // Optional: Legacy USD support
  readonly amountSol?: number;      // REQUIRED for V5.5 Pure SOL buys
  readonly quantity?: number;       // REQUIRED for sells
  readonly slippageTolerance: number;
  readonly marketPrice: number;     // Reference price for audit/telemetry
}

/**
 * IExecutionLayer
 * 
 * The bridge between the deterministic Trading Engine and the Solana Network.
 * This interface allows the bot to switch seamlessly between DRY simulated 
 * execution and LIVE on-chain swaps without changing core logic.
 */
export interface IExecutionLayer {
  /**
   * Executes a buy transaction (SOL -> Token).
   */
  executeBuy(options: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Executes a sell transaction (Token -> SOL).
   */
  executeSell(options: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Estimates the current price impact based on intended trade size and pool depth.
   */
  estimateSlippage(options: ExecutionOptions): Promise<number>;

  /**
   * Attempts to cancel a pending transaction (if supported by the provider).
   */
  cancelOrder(orderId: string): Promise<boolean>;
}
