import type { OrderSide } from '../core/types.js';
import type { Instrument } from '../instrument/Instrument.js';

/** Options for {@link IBroker.syncPositionFromVenue}. */
export interface SyncPositionFromVenueOptions {
  /** When true, bypass per-symbol throttle (e.g. immediately after an order). */
  readonly force?: boolean;
}

export interface PlaceOrderInput {
  readonly instrument: Instrument;
  readonly side: OrderSide;
  readonly qty: number;
  readonly price?: number;
  /**
   * Initial stop-loss for this entry. Live: sent on `submitOrder` (linear/inverse) or stored only (spot/option).
   * Should match strategy signal `stopLoss` when opening.
   */
  readonly stopLoss?: number;
  /** Same id as `positions.id` / registry for this round-trip. */
  readonly roundTripId: string;
  readonly deploymentId: string;
}

/** Result of mutating broker calls — callers must not persist trades when `success` is false. */
export interface BrokerActionResult {
  readonly success: boolean;
  readonly orderId?: string;
  readonly error?: string;
}

export interface IBroker {
  placeOrder(input: PlaceOrderInput): Promise<BrokerActionResult>;
  /**
   * Omit `qty` to close the full position; pass a size for partial reduce-only close.
   * Optional `price` — backtest fill reference (e.g. strategy exit/stop); falls back to last bar close when omitted.
   */
  closePosition(
    symbol: string,
    roundTripId: string,
    qty?: number,
    price?: number,
  ): Promise<BrokerActionResult>;
  /**
   * Set position stop-loss on the venue (live: Bybit trading-stop; backtest: file store).
   * Pass `deploymentId` when the round-trip id may not exist yet in `order_history` (e.g. reconciled position row).
   */
  updateStopLoss(
    symbol: string,
    stopLoss: number,
    roundTripId: string,
    deploymentId?: string,
  ): Promise<BrokerActionResult>;
  /**
   * Live: pull the latest position for `symbol` from the venue into {@link Instrument}.
   * Omitted in backtest — live periodic sync is driven by {@link ReconciliationService}.
   */
  syncPositionFromVenue?(
    symbol: string,
    options?: SyncPositionFromVenueOptions,
  ): Promise<void>;
  /**
   * Live (linear/inverse): after the venue shows a full close, resolve exit order id, fee, and avg exit from Bybit closed PnL.
   * `positionSide` is the **position** side that was open (same as `positions.side`).
   */
  fetchVenueClosedFillMeta?(
    symbol: string,
    positionSide: OrderSide,
    closedQty: number,
    instrument: Instrument,
  ): Promise<{
    readonly venueExitOrderId: string;
    readonly exitFee: number;
    readonly exitPrice: number;
    readonly exitTimestampMs: number;
  } | null>;
  /**
   * Taker/maker fee rate for notional-based estimates (e.g. trade JSONL fee).
   * Live: may reflect exchange tier; backtest: fixed config. Fallback when omitted: caller default.
   */
  getFeeRate?(symbol: string): Promise<number>;
  start(): void;
  stop(): void;
}
