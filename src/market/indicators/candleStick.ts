import type { IndicatorFn } from './types.js';

export function candleStick(): IndicatorFn {
  return (candles, index): Record<string, number | string> => {
    const c = candles[index];
    if (!c) return {};

    const body = c.close - c.open;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    return { body, upperWick, lowerWick };
  };
}
