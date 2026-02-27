import 'dotenv/config';

export type ExecutionMode = "DRY_RUN" | "LIVE";

const EXECUTION_MODE: ExecutionMode = (process.env['EXECUTION_MODE'] as ExecutionMode) ?? "DRY_RUN";
const WALLET_PRIVATE_KEY = process.env['WALLET_PRIVATE_KEY'] ?? "";
const MICRO_LIVE_TEST = process.env['MICRO_LIVE_TEST'] === "true";

/**
 * NEW CONFIGURATION FLAG: DRY_MULTI_TOKEN
 * Logic: 
 * - If true: Bot can scan and monitor multiple tokens in parallel.
 * - This flag is ONLY effective when EXECUTION_MODE is "DRY_RUN".
 */
const DRY_MULTI_TOKEN = process.env['DRY_MULTI_TOKEN'] === "true";

/**
 * SAFETY GUARDS
 */
if (EXECUTION_MODE === "LIVE") {
  if (!WALLET_PRIVATE_KEY) {
    console.error("[FATAL] LIVE mode requires WALLET_PRIVATE_KEY.");
    process.exit(1);
  }
  if (!MICRO_LIVE_TEST) {
    console.error("[FATAL] LIVE mode requires MICRO_LIVE_TEST=true.");
    process.exit(1);
  }
}

export const CONFIG = {
  // 1. GLOBAL STRATEGY GUARDRAILS
  MAX_PORTFOLIO_RISK_PCT: 0.015,
  DAILY_DRAWDOWN_LIMIT_PCT: 0.04,
  MIN_LIQUIDITY_USD: 200000,
  MAX_POOL_IMPACT_PCT: 0.005,
  SLIPPAGE_TOLERANCE_BPS: 150,

  // 2. OPERATIONAL MODE
  EXECUTION_MODE,
  MICRO_LIVE_TEST,
  
  /**
   * MULTI-TOKEN LOGIC GATE
   * Forced to 'false' if mode is LIVE to ensure single-token supervision.
   */
  DRY_MULTI_TOKEN: EXECUTION_MODE === "LIVE" ? false : DRY_MULTI_TOKEN,

  // 3. PHASE 3.1a MICRO LIVE CONSTRAINTS
  MAX_MICRO_RISK_USD: 5,
  MAX_MICRO_POSITION_USD: 30,

  // 4. NETWORK & API
  RPC_URL: process.env['RPC_URL'] ?? "https://api.mainnet-beta.solana.com",
  WSS_URL: process.env['WSS_URL'] ?? "wss://api.mainnet-beta.solana.com",
  JUPITER_API_KEY: process.env['JUPITER_API_KEY'] ?? "",
  WALLET_PRIVATE_KEY,
};
