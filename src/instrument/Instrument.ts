import type { Candle, EnrichedCandle } from "../core/types.js";
import type {
  IndicatorCompute,
  IndicatorConfigType,
} from "../indicator/types.js";
import { roundToPrecision } from "../utils/decimal.js";
import type { InstrumentCategory, InstrumentStatic } from "./types.js";

/**
 * Per-symbol **market** context: exchange constraints + candle book + indicators.
 * Position, capital, and fills live in {@link PositionService} / `IPositionBook` only.
 */
export class Instrument {
  private readonly staticFields: InstrumentStatic;

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

  get ready(): boolean {
    return this._ready;
  }

  setReady(value: boolean): void {
    this._ready = value;
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
}
