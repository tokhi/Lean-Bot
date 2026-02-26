/**
 * LiquidityMonitor V2.1
 * 
 * Responsibility:
 * Monitors real-time gRPC/Websocket pool updates.
 * Provides a boolean 'Kill' signal if liquidity drops >15% instantly.
 */
export class LiquidityMonitor {
  private lastKnownLiquidity: number = 0;
  private readonly KILL_THRESHOLD = 0.15; // 15% drop

  /**
   * Called on every liquidity update event.
   * @returns boolean - True if the position should be emergency sold.
   */
  public shouldEmergencyExit(currentLiquidity: number): boolean {
    if (this.lastKnownLiquidity === 0) {
      this.lastKnownLiquidity = currentLiquidity;
      return false;
    }

    const dropPercent = (this.lastKnownLiquidity - currentLiquidity) / this.lastKnownLiquidity;
    
    if (dropPercent >= this.KILL_THRESHOLD) {
      console.error(`[EMERGENCY] LIQUIDITY DROP DETECTED: ${(dropPercent * 100).toFixed(2)}%`);
      return true;
    }

    this.lastKnownLiquidity = currentLiquidity;
    return false;
  }
}
