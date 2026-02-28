import { createClient } from 'redis';
import type { Candle } from '../types/MarketTypes.js';
import { TradeLogger } from '../simulation/TradeLogger.js';

/**
 * RedisProvider V5.0
 * Logic: Manages time-series candle data for up to 60 tokens.
 * Trims lists to keep only the last 15 minutes of data.
 */
export class RedisProvider {
  private client;
  private readonly HISTORY_LIMIT = 15; // Keep 15 minutes of data

  constructor() {
    this.client = createClient({ url: 'redis://localhost:6379' });
    this.client.on('error', (err) => TradeLogger.log(`Redis Error: ${err}`, 'ERROR'));
  }

  public async connect() {
    await this.client.connect();
    TradeLogger.log("Redis Memory Engine Connected.", 'INFO');
  }

  /**
   * Pushes a new candle to the token's list and trims old data.
   */
  public async pushCandle(mint: string, candle: Candle) {
    const key = `candles:${mint}`;
    await this.client.rPush(key, JSON.stringify(candle));
    await this.client.lTrim(key, -this.HISTORY_LIMIT, -1);
    // Set expiry to 30 mins - if no data for 30m, Redis deletes it
    await this.client.expire(key, 1800); 
  }

  /**
   * Retrieves the last N candles for a token.
   */
  public async getHistory(mint: string): Promise<Candle[]> {
    const key = `candles:${mint}`;
    const data = await this.client.lRange(key, 0, -1);
    return data.map(d => JSON.parse(d));
  }

  /**
   * Returns how many candles are currently stored for a token.
   */
  public async getMemoryDepth(mint: string): Promise<number> {
    return await this.client.lLen(`candles:${mint}`);
  }
}
