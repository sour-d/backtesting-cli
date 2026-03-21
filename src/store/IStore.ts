import type { Candle, LogRecord, OrderRecord, TradeRecord } from '../core/types.js';
import type { DeploymentState } from '../deployment/types.js';

/** One bar to persist after REST warmup (OHLCV + indicator snapshot at that step). */
export interface WarmupBarRow {
  readonly candle: Candle;
  readonly indicators: Record<string, unknown>;
}

export interface IStore {
  saveCandle(
    symbol: string,
    klineInterval: string,
    candle: Candle,
    indicators: Record<string, unknown>,
  ): Promise<void>;
  /**
   * Remove up to `lineCount` most recent bars for `(symbol, klineInterval)` (file tail or DB rows).
   * Used before rewriting warmup so new REST bars don’t duplicate the same tail.
   */
  truncateCandleTail(symbol: string, klineInterval: string, lineCount: number): Promise<void>;
  /**
   * Replace the latest `tailLineCount` persisted bars for `(symbol, klineInterval)` with `bars`:
   * file store trims JSONL tail; Supabase deletes those rows — then each bar is written (same as live `saveCandle`).
   */
  storeWarmupData(
    symbol: string,
    klineInterval: string,
    tailLineCount: number,
    bars: readonly WarmupBarRow[],
  ): Promise<void>;
  loadRecentCandles(symbol: string, klineInterval: string, limit: number): Promise<Candle[]>;

  saveTrade(record: TradeRecord): Promise<void>;
  saveOrder(record: OrderRecord): Promise<void>;

  saveDeployment(state: DeploymentState): Promise<void>;
  loadDeployments(): Promise<DeploymentState[]>;
  /** Remove deployment from persistence (DB row delete for live; entry removed from JSON for file). */
  deleteDeployment(id: string): Promise<void>;

  saveLog(record: LogRecord): Promise<void>;
}
