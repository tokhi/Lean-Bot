/**
 * Result of an execution attempt (Buy or Sell).
 */
export interface ExecutionResult {
  readonly filledPrice: number;
  readonly filledQuantity: number;
  readonly slippage: number;
  readonly rawTxHash: string;
}

/**
 * Options for executing an order.
 */
export interface ExecutionOptions {
  readonly tokenAddress: string;
  readonly amountUsd?: number;
  readonly quantity?: number;
  readonly slippageTolerance: number;
}

/**
 * IExecutionLayer Interface
 * 
 * This interface defines the contract between the Trading Engine and the Blockchain.
 * By using this abstraction, we can:
 * 1. Unit test the Orchestrator with a Stub.
 * 2. Swap between different DEX aggregators (e.g., Jupiter vs. Raydium).
 * 3. Handle asynchronous blockchain latency while keeping Core logic clean.
 */
export interface IExecutionLayer {
  /**
   * Executes a buy swap.
   */
  executeBuy(options: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Executes a sell swap.
   */
  executeSell(options: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Provides a pre-execution slippage estimate based on pool depth.
   */
  estimateSlippage(options: ExecutionOptions): Promise<number>;

  /**
   * Cancels a pending order/transaction if supported by the provider.
   */
  cancelOrder(orderId: string): Promise<boolean>;
}
