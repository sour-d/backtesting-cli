import type { IndicatorFn } from './types.js';
import { num, prev } from './utils.js';

function trueRange(
  high: number,
  low: number,
  prevClose: number | undefined,
): number {
  if (prevClose === undefined) return high - low;

  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose),
  );
}

export function atr(period: number): IndicatorFn {
  const k = 2 / (period + 1);

  return (candles, index): Record<string, number | string> => {
    const c = candles[index];
    if (!c) return {};

    const previous = prev(candles, index);
    const trValue = trueRange(c.high, c.low, previous?.close);
    const prevAtr = num(previous ? (previous as Record<string, unknown>)['atr'] : 0);

    const atrValue = trValue * k + prevAtr * (1 - k);

    return { trValue, atr: atrValue };
  };
}
