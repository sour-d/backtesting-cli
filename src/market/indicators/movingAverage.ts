import type { IndicatorFn } from './types.js';
import { field } from './utils.js';

export function movingAverage(period: number, source: string, outputKey?: string): IndicatorFn {
  const key = outputKey ?? `ma${period}${source}`;

  return (candles, index) => {
    const slice = candles.slice(Math.max(0, index - period), index);

    if (slice.length === 0) return { [key]: 0 };

    const sum = slice.reduce((acc, c) => acc + field(c, source), 0);
    return { [key]: sum / period };
  };
}
