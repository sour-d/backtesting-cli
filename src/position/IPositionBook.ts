import type { PositionBookSnapshot } from './types.js';

/**
 * Mutable position/capital book keyed by symbol — implemented by {@link PositionService}.
 * Brokers update this; strategies read snapshots only.
 */
export interface IPositionBook {
  applyEntry(
    symbol: string,
    side: 'Buy' | 'Sell',
    qty: number,
    price: number,
    fee: number,
  ): void;
  setPositionSnapshot(
    symbol: string,
    side: string,
    sizeAbs: number,
    avgEntry: number,
    unrealized: number,
  ): void;
  setCapitalAllocation(symbol: string, total: number, available: number): void;
  getSnapshot(symbol: string): PositionBookSnapshot;
  getCloseOrderSide(symbol: string): 'Buy' | 'Sell' | null;
}
