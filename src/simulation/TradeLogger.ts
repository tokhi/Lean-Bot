import { appendFileSync, existsSync, mkdirSync } from 'node:fs';

export class TradeLogger {
  private static readonly LOG_DIR = './logs';
  private static readonly LOG_FILE = "trading_engine.log";

  public static log(message: string, type: 'INFO' | 'WARN' | 'ERROR' | 'TRADE' = 'INFO'): void {
    if (!existsSync(this.LOG_DIR)) mkdirSync(this.LOG_DIR);
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${type}] ${message}`;
    console.log(formatted);
    appendFileSync(`${this.LOG_DIR}/${this.LOG_FILE}`, formatted + '\n');
  }

  public static logTrade(data: {
    symbol: string,
    entryPrice: number,
    exitPrice: number,
    Rmultiple: number,
    reason: string,
    pnlSol: number // Fixed: Changed from pnlUsd to pnlSol
  }) {
    this.log(`[TRADE_CLOSED] ${data.symbol} | Result: ${data.Rmultiple.toFixed(2)}R | PnL: ${data.pnlSol.toFixed(4)} SOL | Reason: ${data.reason}`, 'TRADE');
    this.log(` > In: $${data.entryPrice.toFixed(6)} | Out: $${data.exitPrice.toFixed(6)}`, 'TRADE');
    
    const path = `./logs/telemetry.json`;
    appendFileSync(path, JSON.stringify({ timestamp: new Date().toISOString(), ...data }) + '\n');
  }
}
