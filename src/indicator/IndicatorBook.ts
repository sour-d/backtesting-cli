import type { Candle, EnrichedCandle } from "../core/types.js";
import type { IndicatorConfigType } from "./types.js";

/**
 * Pure in-memory analytics: OHLCV series + registered indicators.
 * No I/O, no feed logic — MarketRuntime is the only writer of candles.
 */
export class IndicatorBook {
  private readonly candles: EnrichedCandle[] = [];
  private readonly indicators = new Map<string, IndicatorConfigType>();
  private readonly values = new Map<string, unknown>();

  addCandle(candle: Candle): void {
    const enriched: EnrichedCandle = { ...candle, indicators: {} };
    this.candles.push(enriched);
    for (const [name, def] of this.indicators) {
      this.values.set(name, def.compute(this.candles, enriched));
    }
  }

  registerIndicator(name: string, config: IndicatorConfigType): void {
    this.indicators.set(name, config);
    const last = this.candles[this.candles.length - 1];
    if (last !== undefined) {
      this.values.set(name, config.compute(this.candles, last));
    }
  }

  getCandles(limit?: number): readonly EnrichedCandle[] {
    if (limit === undefined || limit >= this.candles.length) {
      return [...this.candles];
    }
    return this.candles.slice(-limit);
  }

  getIndicatorValue(name: string): unknown {
    return this.values.get(name);
  }

  snapshotIndicators(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }

  get length(): number {
    return this.candles.length;
  }
}
