import type { Candle, TradeEntry, AggregatedTrade, PerformanceStats, Position } from '../types/index.js';
import type { Deployment, StoredTrade } from '../types/deployment.js';

export interface LogEntry {
  readonly sessionId: string;
  readonly timestamp: string;
  readonly level: string;
  readonly component: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly context?: Record<string, string>;
}

export interface IStore {
  // --- Trade recording (backtest + live) ---
  recordTrade(entry: TradeEntry): void;
  getTrades(): readonly TradeEntry[];
  saveResults(results: readonly AggregatedTrade[]): Promise<void>;
  saveStats(stats: PerformanceStats): Promise<void>;

  // --- Market data (backtest + live) ---
  loadMarketData(label: string): Candle[] | null;
  saveMarketData(label: string, data: readonly Candle[]): Promise<void>;

  // --- Deployment persistence (live) ---
  saveDeployment(deployment: Deployment): Promise<void>;
  updateDeployment(id: string, patch: Partial<Deployment>): Promise<void>;
  loadActiveDeployments(): Promise<Deployment[]>;
  removeDeployment(id: string): Promise<void>;

  // --- Position recovery (live) ---
  savePosition(deploymentId: string, position: Position): Promise<void>;
  loadPosition(deploymentId: string): Promise<Position | null>;
  removePosition(deploymentId: string): Promise<void>;

  // --- Completed trade storage (live) ---
  saveTrade(trade: StoredTrade): Promise<void>;
  loadTrades(deploymentId: string): Promise<StoredTrade[]>;

  // --- Live candle buffering ---
  saveCandles(symbol: string, interval: string, candles: readonly Candle[]): Promise<void>;

  // --- Application log persistence (live) ---
  saveLogBatch(entries: readonly LogEntry[]): Promise<void>;
}
