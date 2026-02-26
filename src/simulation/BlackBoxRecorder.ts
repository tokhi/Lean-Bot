import * as fs from 'node:fs';

/**
 * BlackBoxRecorder V2.1
 * 
 * Logic:
 * Saves every trade decision, slippage audit, and PnL outcome to a 
 * local JSON file for post-mortem analysis.
 */
export class BlackBoxRecorder {
  private static readonly LOG_PATH = './trade_logs.json';

  public static record(data: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, ...data };

    try {
      let logs: any[] = [];
      if (fs.existsSync(this.LOG_PATH)) {
        const fileContent = fs.readFileSync(this.LOG_PATH, 'utf-8');
        logs = JSON.parse(fileContent);
      }
      logs.push(logEntry);
      fs.writeFileSync(this.LOG_PATH, JSON.stringify(logs, null, 2));
      console.log(`[BLACKBOX] Trade data persisted to ${this.LOG_PATH}`);
    } catch (error) {
      console.error("[BLACKBOX] Failed to save logs:", error);
    }
  }
}
