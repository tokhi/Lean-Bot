import 'dotenv/config';

/**
 * ExecutionMode defines the environment for the bot's muscles.
 * - DRY_RUN: Uses real market prices but MOCKS all trades.
 * - LIVE: Sends real transactions to the Solana network (WARNING: REAL FUNDS).
 */
export type ExecutionMode = "DRY_RUN" | "LIVE";

const EXECUTION_MODE: ExecutionMode = (process.env['EXECUTION_MODE'] as ExecutionMode) ?? "DRY_RUN";
const WALLET_PRIVATE_KEY = process.env['WALLET_PRIVATE_KEY'] ?? "";
const MICRO_LIVE_TEST = process.env['MICRO_LIVE_TEST'] === "true";

/**
 * FATAL SAFETY GUARDS: PHASE 3.1a
 * 
 * Logic:
 * 1. If mode is LIVE, a private key MUST exist.
 * 2. If mode is LIVE, MICRO_LIVE_TEST MUST be true. 
 *    This prevents "Unrestricted Live" mode which is not yet authorized.
 */
if (EXECUTION_MODE === "LIVE") {
  if (!WALLET_PRIVATE_KEY) {
    console.error("\n[FATAL ERROR] EXECUTION_MODE is 'LIVE' but WALLET_PRIVATE_KEY is missing.");
    process.exit(1);
  }
  
  if (!MICRO_LIVE_TEST) {
    console.error("\n[FATAL ERROR] LIVE mode requires MICRO_LIVE_TEST=true for safety.");
    console.error("Unrestricted LIVE trading is currently disabled in the protocol logic.");
    process.exit(1);
  }
}

export const CONFIG = {
  // 1. GLOBAL STRATEGY GUARDRAILS
  MAX_PORTFOLIO_RISK_PCT: 0.015,  // 1.5% portfolio risk per trade
  DAILY_DRAWDOWN_LIMIT_PCT: 0.04,  // 4% total daily loss limit
  MIN_LIQUIDITY_USD: 200000,      // Minimum pool depth
  MAX_POOL_IMPACT_PCT: 0.005,     // 0.5% maximum price impact
  SLIPPAGE_TOLERANCE_BPS: 150,    // 1.5% max slippage

  // 2. PHASE 3.1a MICRO LIVE CONSTRAINTS
  // Purpose: Limit maximum financial exposure during plumbing validation.
  MICRO_LIVE_TEST,
  MAX_MICRO_RISK_USD: 5,          // Hard cap: Maximum $5 loss (1R)
  MAX_MICRO_POSITION_USD: 25,     // Hard cap: Maximum $25 total exposure per trade

  // 3. OPERATIONAL MODE
  EXECUTION_MODE,

  // 4. NETWORK SETTINGS
  RPC_URL: process.env['RPC_URL'] ?? "https://api.mainnet-beta.solana.com",
  WSS_URL: process.env['WSS_URL'] ?? "wss://api.mainnet-beta.solana.com",

  // 5. SECRETS & API KEYS
  JUPITER_API_KEY: process.env['JUPITER_API_KEY'] ?? "",
  WALLET_PRIVATE_KEY,
};
