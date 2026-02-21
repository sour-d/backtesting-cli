import type { IndicatorFn } from './types.js';
import { numOrUndefined, prev } from './utils.js';

export function ema(period: number, outputKey?: string): IndicatorFn {
  const key = outputKey ?? `ema${period}`;
  const k = 2 / (period + 1);

  return (candles, index) => {
    const c = candles[index];
    if (!c) return {};

    const last = prev(candles, index);
    const prevEma = last ? numOrUndefined((last as Record<string, unknown>)[key]) : undefined;

    if (prevEma !== undefined) {
      return { [key]: c.close * k + prevEma * (1 - k) };
    }

    const start = Math.max(0, index - period + 1);
    const slice = candles.slice(start, index + 1);
    if (slice.length < period) {
      return { [key]: c.close };
    }

    const sum = slice.reduce((acc, q) => acc + q.close, 0);
    return { [key]: sum / period };
  };
}
