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
  closePosition(symbol: string): Promise<void>;
  start(): void;
  stop(): void;
}
