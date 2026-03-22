/** OHLCV candle (exchange-neutral). */
export interface Candle {
  readonly dateUnix: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Candle plus indicator snapshot at the same bar (built by MarketRuntime only). */
export interface EnrichedCandle extends Candle {
  readonly indicators: Readonly<Record<string, unknown>>;
}

export type OrderSide = 'Buy' | 'Sell';

/** One DB row per round-trip (same id as `positions.id` while open). */
export type OrderHistoryStatus = 'open' | 'closed';

export interface OrderHistoryRecord {
  readonly id: string;
  readonly deploymentId: string;
  readonly symbol: string;
  readonly status: OrderHistoryStatus;
  readonly updatedAtMs: number;
  readonly entrySide?: OrderSide;
  readonly entryQty?: number;
  readonly entryPrice?: number | null;
  readonly entryOrderType?: string;
  readonly venueEntryOrderId?: string | null;
  readonly entryAtMs?: number | null;
  readonly entryFee?: number | null;
  readonly entryTimestampMs?: number | null;
  readonly stopLoss?: number | null;
  readonly venueExitOrderId?: string | null;
  readonly exitAtMs?: number | null;
  readonly exitQty?: number | null;
  readonly exitPrice?: number | null;
  readonly exitFee?: number | null;
  readonly exitTimestampMs?: number | null;
  readonly raw?: Record<string, unknown> | null;
}

/** Patch for merge; first insert must include deploymentId, symbol, status. */
export type OrderHistoryPatch = Partial<Omit<OrderHistoryRecord, 'id'>> &
  Pick<OrderHistoryRecord, 'id' | 'updatedAtMs'>;

export interface FillRecord {
  readonly id: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly qty: number;
  readonly price: number;
  readonly fee: number;
  readonly feeAsset: string;
  readonly timestamp: number;
}

export interface TradeRecord {
  readonly id: string;
  readonly symbol: string;
  /** Bybit-style interval code (e.g. `1`, `240`, `D`) — used for backtest trade filenames. */
  readonly klineInterval?: string;
  readonly side: OrderSide;
  readonly qty: number;
  readonly price: number;
  readonly fee: number;
  readonly timestamp: number;
  readonly kind: 'entry' | 'exit' | 'reconcile';
}

export interface LogRecord {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly meta?: Record<string, unknown>;
  readonly timestamp: number;
}
