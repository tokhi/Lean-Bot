import { writeFileSync, readFileSync, existsSync } from 'node:fs';

/**
 * BlackBoxRecorder V2.1
 * Handles deterministic logging of trade events to a local file.
 */
export class BlackBoxRecorder {
  private static readonly LOG_PATH = './trade_logs.json';

  public static record(data: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, ...data };

    try {
      let logs: any[] = [];
      
      if (existsSync(this.LOG_PATH)) {
        const fileContent = readFileSync(this.LOG_PATH, 'utf-8');
        logs = fileContent ? JSON.parse(fileContent) : [];
      }
      
      logs.push(logEntry);
      writeFileSync(this.LOG_PATH, JSON.stringify(logs, null, 2));
      console.log(`[BLACKBOX] Snapshot persisted to ${this.LOG_PATH}`);
    } catch (error) {
      console.error("[BLACKBOX] Write Error:", error);
    }
  }
}
