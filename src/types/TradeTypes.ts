/**
 * Position represents an active, ongoing trade.
 */
export interface Position {
  readonly symbol: string;           
  readonly entryPrice: number;
  readonly quantity: number;
  readonly stopPrice: number;
  readonly stage: 1 | 2 | 3;
  readonly riskAmount: number;       // SOL units at risk
  readonly peakPrice: number;
  readonly openTime: number;
  readonly lastPrice: number;        
  readonly breakoutLevel: number;    
  readonly initialLiquidity: number; 
  readonly buyAmountSol: number;     // Requirement 8: Fixed SOL allocation
}

/**
 * TradeResult represents the post-mortem data of a closed trade.
 */
export interface TradeResult {
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly Rmultiple: number;             
  readonly duration: number;              
  readonly maxFavorableExcursion: number; 
  readonly maxAdverseExcursion: number;   
  readonly stageReached: number;          
  readonly realizedSlippage: number;      
  readonly pnlSol: number;                // Requirement 9: Realized SOL gain/loss
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
