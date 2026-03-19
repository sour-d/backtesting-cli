import type { Candle, TradeEntry, AggregatedTrade, PerformanceStats, Position } from '../types/index.js';
import type { Deployment, StoredTrade } from '../types/deployment.js';

/** Structured event for live debugging (order/exit failures, runtime errors). Persisted to DB in live mode. */
export interface LiveEvent {
  readonly sessionId: string;
  readonly eventType: 'order_placed' | 'order_failed' | 'exit_ok' | 'exit_failed' | 'stop_loss_triggered' | 'stop_loss_exit_failed' | 'runtime_error';
  readonly deploymentId?: string;
  readonly symbol?: string;
  readonly message: string;
  readonly payload?: Record<string, unknown>;
}

export interface LogEntry {
  readonly sessionId: string;
  readonly timestamp: string;
  readonly level: string;
  readonly component: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly context?: Record<string, string>;
}

// --- Query filter types (dashboard) ---

export interface PaginationOpts {
  readonly limit?: number;
  readonly offset?: number;
}

export interface TradeQueryFilters extends PaginationOpts {
  readonly symbol?: string;
  readonly side?: string;
  readonly result?: string;
  readonly exitType?: string;
  readonly deploymentId?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface DeploymentQueryFilters {
  readonly status?: string;
  readonly symbol?: string;
  readonly strategyName?: string;
}

export interface CandleQueryFilters extends PaginationOpts {
  readonly symbol: string;
  readonly interval: string;
  readonly from?: string;
  readonly to?: string;
  readonly order?: 'asc' | 'desc';
}

export interface LogQueryFilters extends PaginationOpts {
  readonly sessionId?: string;
  readonly level?: string;
  readonly component?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface LiveEventQueryFilters extends PaginationOpts {
  readonly sessionId?: string;
  readonly eventType?: LiveEvent['eventType'];
  readonly symbol?: string;
  readonly deploymentId?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface PositionWithDeployment extends Position {
  readonly deploymentId: string;
}

/** Bybit lot size filter for order quantity (from getInstrumentsInfo). */
export interface InstrumentLotSize {
  readonly minOrderQty: string;
  readonly qtyStep: string;
  readonly maxOrderQty?: string;
  readonly maxMktOrderQty?: string;
}

export interface StoredInstrumentInfo {
  readonly lotSizeFilter: InstrumentLotSize;
  readonly updatedAt: string;
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

  /** Optional: persist structured live events for debugging (live mode). No-op on FileStore. */
  saveLiveEvent?(event: LiveEvent): Promise<void>;

  /** Optional: get instrument lot size from DB (live). Used to avoid fetching from API on every order. */
  getInstrumentInfo?(symbol: string): Promise<StoredInstrumentInfo | null>;

  /** Optional: save instrument lot size to DB after fetching from Bybit (live). */
  saveInstrumentInfo?(symbol: string, category: string, lotSizeFilter: InstrumentLotSize): Promise<void>;

  /** Optional: query live_events for debugging (SupabaseStore). */
  queryLiveEvents?(filters: LiveEventQueryFilters): Promise<LiveEvent[]>;

  // --- Dashboard query methods ---
  queryTrades(filters: TradeQueryFilters): Promise<StoredTrade[]>;
  queryDeployments(filters: DeploymentQueryFilters): Promise<Deployment[]>;
  queryAllPositions(): Promise<PositionWithDeployment[]>;
  queryCandles(filters: CandleQueryFilters): Promise<Candle[]>;
  queryLogs(filters: LogQueryFilters): Promise<LogEntry[]>;
}
