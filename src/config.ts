import 'dotenv/config';

export const CONFIG = {
  // 1. HARD GUARDRAILS
  MAX_PORTFOLIO_RISK_PCT: 0.015, 
  DAILY_DRAWDOWN_LIMIT_PCT: 0.04, 
  MIN_LIQUIDITY_USD: 200000,
  
  // 2. NETWORK SETTINGS
  RPC_URL: process.env['RPC_URL'] ?? "https://api.mainnet-beta.solana.com",
  WSS_URL: process.env['WSS_URL'] ?? "wss://api.mainnet-beta.solana.com",
  
  // 3. SECRETS
  WALLET_PRIVATE_KEY: process.env['WALLET_PRIVATE_KEY'] ?? "",
};
