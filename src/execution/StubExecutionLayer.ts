import type { 
  IExecutionLayer, 
  ExecutionResult, 
  ExecutionOptions 
} from "./interfaces/IExecutionLayer.js";
import { SlippageModel } from "./SlippageModel.js";

/**
 * StubExecutionLayer V2.1
 * 
 * A "Mock" implementation of the IExecutionLayer.
 * Now integrated with SlippageModel to simulate realistic price impact
 * during dry runs.
 */
export class StubExecutionLayer implements IExecutionLayer {
  

  public async executeBuy(options: ExecutionOptions): Promise<ExecutionResult> {
    const MOCK_LIQUIDITY = 500_000; 
    const amountUsd = options.amountUsd ?? 0;
    const estimatedSlippage = SlippageModel.estimateImpact(amountUsd, MOCK_LIQUIDITY);

    // Use the market price from options instead of 1.0
    const filledPrice = options.marketPrice * (1 + estimatedSlippage);

    return {
      filledPrice: filledPrice,
      filledQuantity: amountUsd / filledPrice,
      slippage: estimatedSlippage,
      rawTxHash: "STUB_BUY_TX_HASH_" + Date.now()
    };
  }

  public async executeSell(options: ExecutionOptions): Promise<ExecutionResult> {
    const MOCK_LIQUIDITY = 500_000;
    const amountUsd = (options.quantity ?? 0) * options.marketPrice;
    const estimatedSlippage = SlippageModel.estimateImpact(amountUsd, MOCK_LIQUIDITY);
    
    // Sell price is pushed down by slippage
    const filledPrice = options.marketPrice * (1 - estimatedSlippage);

    return {
      filledPrice: filledPrice,
      filledQuantity: options.quantity ?? 0,
      slippage: estimatedSlippage,
      rawTxHash: "STUB_SELL_TX_HASH_" + Date.now()
    };
  }
// ... rest of file

  public async estimateSlippage(options: ExecutionOptions): Promise<number> {
    const MOCK_LIQUIDITY = 250_000;
    const amountUsd = options.amountUsd ?? (options.quantity ?? 0 * 1.0);
    return SlippageModel.estimateImpact(amountUsd, MOCK_LIQUIDITY);
  }

  public async cancelOrder(orderId: string): Promise<boolean> {
    return true;
  }
}
