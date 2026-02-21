import type { IndicatorFn } from './types.js';
import { field } from './utils.js';

export function bollingerBands(
  period = 20,
  multiplier = 2,
  source = 'close',
): IndicatorFn {
  return (candles, index): Record<string, number | string> => {
    const c = candles[index];
    if (!c) return {};

    const start = Math.max(0, index - period + 1);
    const slice = candles.slice(start, index + 1);
    const n = slice.length;

    const mean = slice.reduce((acc, q) => acc + field(q, source), 0) / n;
    const variance = slice.reduce((acc, q) => acc + (field(q, source) - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    const upper = mean + multiplier * stdDev;
    const lower = mean - multiplier * stdDev;
    const width = upper - lower;
    const percentB = width !== 0
      ? (field(c, source) - lower) / width
      : 0.5;

    return {
      bbUpper: upper,
      bbLower: lower,
      bbMiddle: mean,
      bbWidth: width,
      bbPercentB: percentB,
    };
  };
}
