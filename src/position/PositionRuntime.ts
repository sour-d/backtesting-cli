import type { FillRecord } from '../core/types.js';

/**
 * Signed position size, entry, PnL, and capital available for trading — updated by brokers on fills/sync.
 */
export class PositionRuntime {
  private _allocatedCapital = 0;
  private _availableCapital = 0;
  private _currentPositionQty = 0;
  private _avgEntryPrice = 0;
  private _unrealizedPnl = 0;

  get allocatedCapital(): number {
    return this._allocatedCapital;
  }

  get availableCapital(): number {
    return this._availableCapital;
  }

  /** Signed: positive = long, negative = short. */
  get currentPositionQty(): number {
    return this._currentPositionQty;
  }

  getCloseOrderSide(): 'Buy' | 'Sell' | null {
    const q = this._currentPositionQty;
    if (Math.abs(q) < 1e-12) return null;
    return q > 0 ? 'Sell' : 'Buy';
  }

  get avgEntryPrice(): number {
    return this._avgEntryPrice;
  }

  get unrealizedPnL(): number {
    return this._unrealizedPnl;
  }

  setCapitalAllocation(total: number, available: number): void {
    this._allocatedCapital = total;
    this._availableCapital = available;
  }

  setPositionSnapshot(
    side: string,
    sizeAbs: number,
    avgEntry: number,
    unrealized: number,
  ): void {
    const mag = Math.abs(sizeAbs);
    if (side === 'Buy') {
      this._currentPositionQty = mag;
    } else if (side === 'Sell') {
      this._currentPositionQty = -mag;
    } else {
      this._currentPositionQty = 0;
    }
    this._avgEntryPrice = avgEntry;
    this._unrealizedPnl = unrealized;
  }

  updateCapitalFromFill(fill: FillRecord): void {
    const notional = fill.qty * fill.price;
    const signed =
      fill.side === 'Buy' ? -notional - fill.fee : notional - fill.fee;
    this._availableCapital += signed;
  }

  applyEntry(
    side: 'Buy' | 'Sell',
    qty: number,
    price: number,
    fee: number,
  ): void {
    const signedQty = side === 'Buy' ? qty : -qty;
    const nextQty = this._currentPositionQty + signedQty;
    if (Math.abs(nextQty) < 1e-12) {
      this._currentPositionQty = 0;
      this._avgEntryPrice = 0;
    } else if (this._currentPositionQty === 0) {
      this._currentPositionQty = nextQty;
      this._avgEntryPrice = price;
    } else {
      const sameSign =
        (this._currentPositionQty > 0 && signedQty > 0) ||
        (this._currentPositionQty < 0 && signedQty < 0);
      if (sameSign) {
        const absOld = Math.abs(this._currentPositionQty);
        const absNew = Math.abs(signedQty);
        this._avgEntryPrice =
          (this._avgEntryPrice * absOld + price * absNew) / (absOld + absNew);
        this._currentPositionQty = nextQty;
      } else {
        this._currentPositionQty = nextQty;
        if (Math.abs(this._currentPositionQty) < 1e-12) {
          this._avgEntryPrice = 0;
        }
      }
    }
    this._availableCapital -= fee;
    if (side === 'Buy') {
      this._availableCapital -= qty * price;
    } else {
      this._availableCapital += qty * price;
    }
  }

  setUnrealizedPnl(pnl: number): void {
    this._unrealizedPnl = pnl;
  }

  /** Flatten open position but keep allocation + available capital (deploy / P&L trail). */
  clearOpenPositionKeepCapital(): void {
    this._currentPositionQty = 0;
    this._avgEntryPrice = 0;
    this._unrealizedPnl = 0;
  }
}
