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

export interface OrderRecord {
  readonly id: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly qty: string;
  readonly price?: string;
  readonly orderType: string;
  readonly status: string;
  readonly createdAt: number;
  readonly raw?: Record<string, unknown>;
}

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
