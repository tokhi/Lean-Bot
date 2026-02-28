import 'dotenv/config';

export type OperationMode = "DRY" | "LIVE";
export type RiskMode = "FIXED_SOL" | "PERCENT";

const MODE: OperationMode = (process.env['MODE'] as OperationMode) ?? "DRY";

export const CONFIG = {
  MODE,
  
  // --- STEP 1: SOL RISK ENGINE ---
  RISK_MODE: "FIXED_SOL" as RiskMode,
  RISK_MODERATE_SOL: 0.20,           
  RISK_IGNITION_SOL: 0.15,           
  MAX_PORTFOLIO_RISK_PCT: 0.06,      
  DAILY_DRAWDOWN_LIMIT_PCT: 0.06,    

  // --- CONCURRENCY & FREQUENCY ---
  MAX_CONCURRENT_MODERATE: 2,
  MAX_CONCURRENT_IGNITION: 1,
  MAX_TOTAL_CONCURRENT: 3,           
  MAX_TRADES_PER_HOUR: 4,            
  MAX_REENTRIES_PER_TOKEN_30M: 2,    

  // --- ENTRY FILTERS ---
  MIN_VOLATILITY_PERCENT: 1.5,
  MIN_VOLUME_MULTIPLIER: 1.8,
 MIN_LIQUIDITY_GROWTH_5M: 0.02, // Reduced from 0.05 (5%) to 0.02 (2%)
     

  // --- SCANNER CORRIDOR ---
  MIN_LIQUIDITY_USD: 40000,          
  IGNITION_LIQ_UPPER: 200000,        
  MAX_LIQUIDITY_USD: 5000000,        
  MAX_ACTIVE_TOKENS: 3,
  STALE_EVALUATIONS_LIMIT: 2,

  // --- INFRASTRUCTURE ---
  RPC_URL: process.env['RPC_URL'] ?? "https://api.mainnet-beta.solana.com",
  WALLET_PRIVATE_KEY: process.env['WALLET_PRIVATE_KEY'] ?? "",
  JUPITER_API_KEY: process.env['JUPITER_API_KEY'] ?? "",
  SLIPPAGE_TOLERANCE_BPS: 200,       
  MICRO_LIVE_TEST: process.env['MICRO_LIVE_TEST'] === "true",
  MAX_MICRO_POSITION_USD: 30,

  // Strategy logic threshold used for "Smart Timeout"
  MIN_VOLATILITY_THRESHOLD: 0.005 
};
