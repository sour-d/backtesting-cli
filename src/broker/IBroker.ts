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
  /** Set position stop-loss on the venue (live: Bybit trading-stop; backtest: no-op log). */
  updateStopLoss(symbol: string, stopLoss: number): Promise<void>;
  /**
   * Live: pull the latest position for `symbol` from the venue into {@link Instrument}.
   * Omitted in backtest — {@link PositionManager} skips periodic venue reconciliation.
   */
  syncPositionFromVenue?(symbol: string): Promise<void>;
  start(): void;
  stop(): void;
}
