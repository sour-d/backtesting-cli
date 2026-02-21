import type { EnrichedCandle } from '../../types/index.js';

export function num(value: unknown): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0;
}

export function numOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
}

export function field(candle: EnrichedCandle, key: string): number {
  switch (key) {
    case 'open': return candle.open;
    case 'high': return candle.high;
    case 'low': return candle.low;
    case 'close': return candle.close;
    case 'volume': return candle.volume;
    case 'dateUnix': return candle.dateUnix;
    default: return num((candle as Record<string, unknown>)[key]);
  }
}

export function prev(
  candles: readonly EnrichedCandle[],
  index: number,
  offset = 1,
): EnrichedCandle | undefined {
  return candles[index - offset];
}
