import type { Candle } from "../core/types.js";
import type { IndicatorConfigType } from "./types.js";

/**
 * Pure in-memory analytics: OHLCV series + registered indicators.
 * No I/O, no feed logic — MarketRuntime is the only writer of candles.
 */
export class IndicatorBook {
  private readonly candles: Candle[] = [];
  private readonly indicators = new Map<string, IndicatorConfigType>();
  private readonly values = new Map<string, unknown>();

  addCandle(candle: Candle): void {
    this.candles.push(candle);
    for (const [name, def] of this.indicators) {
      this.values.set(name, def.compute(this.candles));
    }
  }

  registerIndicator(name: string, config: IndicatorConfigType): void {
    this.indicators.set(name, config);
    this.values.set(name, config.compute(this.candles));
  }

  getCandles(limit?: number): readonly Candle[] {
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
