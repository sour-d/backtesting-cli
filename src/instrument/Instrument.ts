import type { Candle, EnrichedCandle, FillRecord } from "../core/types.js";
import type {
  IndicatorCompute,
  IndicatorConfigType,
} from "../indicator/types.js";
import { roundToPrecision } from "../utils/decimal.js";
import type { InstrumentCategory, InstrumentStatic } from "./types.js";

/**
 * Per-symbol trading context: exchange constraints + runtime position/capital.
 * All market series and indicators are updated through {@link addCandle} — callers do not touch the book directly.
 */
export class Instrument {
  private readonly staticFields: InstrumentStatic;

  private _allocatedCapital = 0;
  private _availableCapital = 0;
  private _currentPositionQty = 0;
  private _avgEntryPrice = 0;
  private _unrealizedPnl = 0;
  private _ready = false;
  private _indicators: IndicatorConfigType[] = [];
  private _candles: EnrichedCandle[] = [];

  constructor(spec: InstrumentStatic, indicators: IndicatorConfigType[]) {
    this.staticFields = spec;
    this._indicators = indicators;
  }

  /**
   * Append a candle, recompute registered indicators, return the enriched bar.
   * Warmup and live ingress both use this — persistence is MarketRuntime's job for live bars only.
   */
  addCandle(candle: Candle): EnrichedCandle {
    const indicatorsValue: Record<string, unknown> = {};
    this._indicators.forEach(
      ({ compute, name }: { compute: IndicatorCompute; name: string }) => {
        indicatorsValue[name] = compute(this._candles, candle);
      },
    );
    const enrichedCandle = {
      ...candle,
      indicators: indicatorsValue,
    };
    this._candles.push(enrichedCandle);
    return enrichedCandle;
  }

  getCandles(limit?: number): readonly EnrichedCandle[] {
    if (limit === undefined || limit >= this._candles.length) {
      return [...this._candles];
    }
    return this._candles.slice(-limit);
  }

  registerIndicator(name: string, config: IndicatorConfigType): void {
    this._indicators.push({ compute: config.compute, name });
  }

  get spec(): InstrumentStatic {
    return this.staticFields;
  }

  get symbol(): string {
    return this.staticFields.symbol;
  }

  get category(): InstrumentCategory {
    return this.staticFields.category;
  }

  get tickSize(): number {
    return this.staticFields.tickSize;
  }

  get stepSize(): number {
    return this.staticFields.stepSize;
  }

  get minQty(): number {
    return this.staticFields.minQty;
  }

  get minNotional(): number {
    return this.staticFields.minNotional;
  }

  get pricePrecision(): number {
    return this.staticFields.pricePrecision;
  }

  get qtyPrecision(): number {
    return this.staticFields.qtyPrecision;
  }

  get allocatedCapital(): number {
    return this._allocatedCapital;
  }

  get availableCapital(): number {
    return this._availableCapital;
  }

  /**
   * Signed position size: positive = long, negative = short (from exchange `side` + absolute `size`).
   */
  get currentPositionQty(): number {
    return this._currentPositionQty;
  }

  /**
   * Order side that closes the current position (Sell closes long, Buy closes short), or null if flat.
   */
  getCloseOrderSide(): "Buy" | "Sell" | null {
    const q = this._currentPositionQty;
    if (Math.abs(q) < 1e-12) return null;
    return q > 0 ? "Sell" : "Buy";
  }

  get avgEntryPrice(): number {
    return this._avgEntryPrice;
  }

  get unrealizedPnL(): number {
    return this._unrealizedPnl;
  }

  get ready(): boolean {
    return this._ready;
  }

  setReady(value: boolean): void {
    this._ready = value;
  }

  setCapitalAllocation(total: number, available: number): void {
    this._allocatedCapital = total;
    this._availableCapital = available;
  }

  /**
   * Exchange APIs (e.g. Bybit V5) return a positive `size` and a separate `side` (`Buy` = long, `Sell` = short).
   * We normalize to signed qty internally so strategy/bot logic stays consistent.
   */
  setPositionSnapshot(
    side: string,
    sizeAbs: number,
    avgEntry: number,
    unrealized: number,
  ): void {
    const mag = Math.abs(sizeAbs);
    if (side === "Buy") {
      this._currentPositionQty = mag;
    } else if (side === "Sell") {
      this._currentPositionQty = -mag;
    } else {
      this._currentPositionQty = 0;
    }
    this._avgEntryPrice = avgEntry;
    this._unrealizedPnl = unrealized;
  }

  roundQty(qty: number): number {
    return roundToPrecision(qty, this.qtyPrecision);
  }

  roundPrice(price: number): number {
    return roundToPrecision(price, this.pricePrecision);
  }

  canOpenPosition(qty: number, price: number): boolean {
    if (qty < this.minQty) return false;
    const notional = qty * price;
    if (notional < this.minNotional) return false;
    const rounded = this.roundQty(qty);
    return rounded >= this.minQty;
  }

  updateCapitalFromFill(fill: FillRecord): void {
    const notional = fill.qty * fill.price;
    const signed =
      fill.side === "Buy" ? -notional - fill.fee : notional - fill.fee;
    this._availableCapital += signed;
  }

  applyEntry(
    side: "Buy" | "Sell",
    qty: number,
    price: number,
    fee: number,
  ): void {
    const signedQty = side === "Buy" ? qty : -qty;
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
    if (side === "Buy") {
      this._availableCapital -= qty * price;
    } else {
      this._availableCapital += qty * price;
    }
  }

  setUnrealizedPnl(pnl: number): void {
    this._unrealizedPnl = pnl;
  }
}
