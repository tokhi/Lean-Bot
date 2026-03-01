import 'dotenv/config';

export type OperationMode = "DRY" | "LIVE";
export type RiskMode = "FIXED_SOL" | "PERCENT";

const MODE: OperationMode = (process.env['MODE'] as OperationMode) ?? "DRY";

export const CONFIG = {
  MODE,
  // --- REQUIREMENT 3: DUAL-MODE ALLOCATION ---
  BUY_AMOUNT_IGNITION_SOL: 1.0,      
  BUY_AMOUNT_MODERATE_SOL: 2.0,      
  RISK_IGNITION_SOL: 1.0,            // Alias for logging sync
  RISK_MODERATE_SOL: 2.0,            // Alias for logging sync

  // --- REQUIREMENT 4 & 5: STOP LOSS & REVERSAL ---
  INITIAL_STOP_LOSS_PCT: 0.10,       
  REVERSAL_VOLATILITY_THRESHOLD: 2.0, 

  // --- REQUIREMENT 6 & 7: MODE-SPECIFIC VOLATILITY ---
  IGNITION_VOLATILITY_MIN: 3.0,      
  MODERATE_VOLATILITY_MIN: 1.5,      

  // --- PORTFOLIO LIMITS ---
  MAX_TOTAL_CONCURRENT: 3,           
  MAX_CONCURRENT_IGNITION: 1,        // FIXED: Added for Orchestrator
  MAX_CONCURRENT_MODERATE: 2,        // FIXED: Added for Orchestrator
  MAX_ACTIVE_TOKENS: 5,              
  MAX_SCAN_POOL: 60,                 
  MAX_TRADES_PER_HOUR: 6,

  // --- FILTERS ---
  MIN_LIQUIDITY_USD: 40000,          
  IGNITION_LIQ_UPPER: 200000,        
  MAX_LIQUIDITY_USD: 5000000,        
  MIN_VOLUME_MULTIPLIER: 1.3,        
  MIN_LIQUIDITY_GROWTH_5M: 0.02,

  // --- INFRASTRUCTURE ---
  RPC_URL: process.env['RPC_URL'] ?? "https://api.mainnet-beta.solana.com",
  WALLET_PRIVATE_KEY: process.env['WALLET_PRIVATE_KEY'] ?? "",
  JUPITER_API_KEY: process.env['JUPITER_API_KEY'] ?? "",
  SLIPPAGE_TOLERANCE_BPS: 200,       
  PATIENCE_LIMIT_MINS: 15,
  INITIAL_SOL_BALANCE: 1.0
};
