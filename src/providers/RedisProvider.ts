import { createClient } from 'redis';
import type { Candle } from '../types/MarketTypes.js';
import { TradeLogger } from '../simulation/TradeLogger.js';

// MODIFIED: Explicit Time-Series logic for 15-minute rolling window
export class RedisProvider {
  private client;
  private readonly HISTORY_LIMIT = 15; // Preserve 15 minutes of history

  constructor() {
    this.client = createClient({ url: 'redis://127.0.0.1:6379' });
  }

  public async connect() {
    await this.client.connect();
    TradeLogger.log("Redis Connected. Global Memory Active.", 'INFO');
  }

  public async pushCandle(mint: string, candle: Candle) {
    const key = `candles:${mint}`;
    // MODIFIED: Use rPush to add to end and lTrim to maintain fixed window size
    await this.client.rPush(key, JSON.stringify(candle));
    await this.client.lTrim(key, -this.HISTORY_LIMIT, -1);
    await this.client.expire(key, 1800); // 30m TTL for the whole list
  }

  public async getHistory(mint: string): Promise<Candle[]> {
    const data = await this.client.lRange(`candles:${mint}`, 0, -1);
    return data.map(d => JSON.parse(d));
  }
}
