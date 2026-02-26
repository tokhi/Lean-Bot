import type { 
  IExecutionLayer, 
  ExecutionResult, 
  ExecutionOptions 
} from "./interfaces/IExecutionLayer.js";

/**
 * StubExecutionLayer
 * 
 * A "Mock" implementation of the IExecutionLayer.
 * It returns immediate, deterministic dummy data to facilitate 
 * system integration testing and "Dry Run" pilot modes.
 */
export class StubExecutionLayer implements IExecutionLayer {
  
  public async executeBuy(options: ExecutionOptions): Promise<ExecutionResult> {
    // Return a dummy success result
    return {
      filledPrice: 1.0, // Hardcoded for stub
      filledQuantity: (options.amountUsd ?? 0) / 1.0,
      slippage: 0.005,
      rawTxHash: "STUB_BUY_TX_HASH_" + Date.now()
    };
  }

  public async executeSell(options: ExecutionOptions): Promise<ExecutionResult> {
    return {
      filledPrice: 1.1,
      filledQuantity: options.quantity ?? 0,
      slippage: 0.007,
      rawTxHash: "STUB_SELL_TX_HASH_" + Date.now()
    };
  }

  public async estimateSlippage(options: ExecutionOptions): Promise<number> {
    // Simulates a 0.5% slippage estimate
    return 0.005;
  }

  public async cancelOrder(orderId: string): Promise<boolean> {
    return true;
  }
}

/**
 * EXAMPLE USAGE / TEST FUNCTION
 */
export async function testStubExecution() {
  const executor = new StubExecutionLayer();
  
  const buyOptions: ExecutionOptions = {
    tokenAddress: "TokenABC123",
    amountUsd: 15, // 1R
    slippageTolerance: 0.015
  };

  console.log("--- TESTING STUB EXECUTION ---");
  const result = await executor.executeBuy(buyOptions);
  
  console.log(`Action: BUY ${buyOptions.tokenAddress}`);
  console.log(`Price: ${result.filledPrice}`);
  console.log(`Hash: ${result.rawTxHash}`);
}
