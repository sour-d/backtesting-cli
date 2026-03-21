import type { OrderSide } from '../core/types.js';
import type { Instrument } from '../instrument/Instrument.js';

export interface PlaceOrderInput {
  readonly instrument: Instrument;
  readonly side: OrderSide;
  readonly qty: number;
  readonly price?: number;
}

export interface IBroker {
  placeOrder(input: PlaceOrderInput): Promise<void>;
  /**
   * Omit `qty` to close the full position; pass a size for partial reduce-only close.
   * Optional `price` — backtest fill reference (e.g. strategy exit/stop); falls back to last bar close when omitted.
   */
  closePosition(symbol: string, qty?: number, price?: number): Promise<void>;
  start(): void;
  stop(): void;
}
