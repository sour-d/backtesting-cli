import type { EnrichedCandle } from '../types/index.js';

export class OHLCStorage {
  private readonly candles: EnrichedCandle[];
  private cursor: number;
  private readonly symbol: string;

  constructor(candles: EnrichedCandle[] = [], startIndex = 0, symbol = '') {
    this.candles = [...candles];
    this.cursor = Math.max(0, Math.min(startIndex, candles.length - 1));
    this.symbol = symbol;
  }

  now(): EnrichedCandle {
    const c = this.candles[this.cursor];
    if (!c) throw new Error(`No candle at cursor ${this.cursor}`);
    return c;
  }

  prev(offset = 1): EnrichedCandle | undefined {
    return this.candles[this.cursor - offset];
  }

  advance(): boolean {
    if (!this.hasNext()) return false;
    this.cursor++;
    return true;
  }

  hasNext(): boolean {
    return this.cursor < this.candles.length - 1;
  }

  append(candle: EnrichedCandle): void {
    this.candles.push(candle);
    this.cursor = this.candles.length - 1;
  }

  get length(): number {
    return this.candles.length;
  }

  get currentIndex(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.candles.length - 1 - this.cursor;
  }

  get name(): string {
    return this.symbol;
  }

  slice(count: number): readonly EnrichedCandle[] {
    const start = Math.max(0, this.cursor - count + 1);
    return this.candles.slice(start, this.cursor + 1);
  }

  all(): readonly EnrichedCandle[] {
    return this.candles;
  }

  reset(index = 0): void {
    this.cursor = Math.max(0, Math.min(index, this.candles.length - 1));
  }
}
