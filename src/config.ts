import 'dotenv/config';

/**
 * ExecutionMode defines the environment for the bot's muscles.
 * - DRY_RUN: Uses real market prices but MOCKS all trades.
 * - LIVE: Sends real transactions to the Solana network (WARNING: REAL FUNDS).
 */
export type ExecutionMode = "DRY_RUN" | "LIVE";

const EXECUTION_MODE: ExecutionMode = (process.env['EXECUTION_MODE'] as ExecutionMode) ?? "DRY_RUN";
const WALLET_PRIVATE_KEY = process.env['WALLET_PRIVATE_KEY'] ?? "";

/**
 * SAFETY GUARD: PILOT DISCIPLINE
 */
if (EXECUTION_MODE === "LIVE" && !WALLET_PRIVATE_KEY) {
  console.error("\n[FATAL ERROR] System configuration mismatch.");
  console.error("EXECUTION_MODE is set to 'LIVE' but WALLET_PRIVATE_KEY is missing in .env.");
  process.exit(1);
}

export const CONFIG = {
  // 1. HARD GUARDRAILS (Immutable at Runtime)
  MAX_PORTFOLIO_RISK_PCT: 0.015,  // 1.5% portfolio risk per trade
  DAILY_DRAWDOWN_LIMIT_PCT: 0.04,  // 4% total daily loss limit
  MIN_LIQUIDITY_USD: 200000,      // Minimum pool depth to consider trading
  MAX_POOL_IMPACT_PCT: 0.005,     // 0.5% maximum price impact allowed per trade
  SLIPPAGE_TOLERANCE_BPS: 150,    // 1.5% (150 basis points) max allowed slippage

  // 2. OPERATIONAL MODE
  EXECUTION_MODE,

  // 3. NETWORK SETTINGS
  RPC_URL: process.env['RPC_URL'] ?? "https://api.mainnet-beta.solana.com",
  WSS_URL: process.env['WSS_URL'] ?? "wss://api.mainnet-beta.solana.com",

  // 4. API KEYS
  JUPITER_API_KEY: process.env['JUPITER_API_KEY'] ?? "",

  // 5. SECRETS
  WALLET_PRIVATE_KEY,
};
