import 'dotenv/config';

export type OperationMode = "DRY" | "LIVE";
export type RiskMode = "FIXED_SOL" | "PERCENT";

const MODE: OperationMode = (process.env['MODE'] as OperationMode) ?? "DRY";

export const CONFIG = {
  MODE,
  
  // --- RISK ENGINE (SOL BASED) ---
  RISK_MODE: "FIXED_SOL" as RiskMode,
  RISK_MODERATE_SOL: 0.20,           
  RISK_IGNITION_SOL: 0.15,           
  MAX_PORTFOLIO_RISK_PCT: 0.06,      
  DAILY_DRAWDOWN_LIMIT_PCT: 0.06,    

  // --- CONCURRENCY & FREQUENCY ---
  MAX_CONCURRENT_MODERATE: 2,
  MAX_CONCURRENT_IGNITION: 1,
  MAX_TOTAL_CONCURRENT: 3,           // <-- Orchestrator uses this
  MAX_TRADES_PER_HOUR: 4,            
  MAX_REENTRIES_PER_TOKEN_30M: 2,    

  // --- ENTRY FILTERS ---
  MIN_VOLATILITY_PERCENT: 1.0,       // Lowered for testing as discussed
  MIN_VOLUME_MULTIPLIER: 1.1,        // Lowered for testing as discussed
  MIN_LIQUIDITY_GROWTH_5M: 0.01,     // Lowered for testing as discussed
   // Increase patience to 15 minutes (7m build + 8m hunt)
  PATIENCE_LIMIT_MINS: 15,

  // --- SCANNER CORRIDOR ---
  MIN_LIQUIDITY_USD: 40000,          
  IGNITION_LIQ_UPPER: 200000,        
  MAX_LIQUIDITY_USD: 5000000,        
  MAX_ACTIVE_TOKENS: 3,
  STALE_EVALUATIONS_LIMIT: 5, // allow more attempts

  // --- INFRASTRUCTURE ---
  RPC_URL: process.env['RPC_URL'] ?? "https://api.mainnet-beta.solana.com",
  WALLET_PRIVATE_KEY: process.env['WALLET_PRIVATE_KEY'] ?? "",
  JUPITER_API_KEY: process.env['JUPITER_API_KEY'] ?? "",
  SLIPPAGE_TOLERANCE_BPS: 200,       
  MICRO_LIVE_TEST: process.env['MICRO_LIVE_TEST'] === "true",
  MAX_MICRO_POSITION_USD: 30,
  MIN_VOLATILITY_THRESHOLD: 0.005 
};
