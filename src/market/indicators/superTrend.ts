import type { IndicatorFn } from './types.js';
import { num, prev } from './utils.js';

export function superTrend(atrPeriod: number, multiplier: number): IndicatorFn {
  return (candles, index): Record<string, number | string> => {
    const c = candles[index];
    if (!c) return {};

    const atrValue = num((c as Record<string, unknown>)['atr']);
    const hl2 = (c.high + c.low) / 2;

    let upperBand = hl2 + multiplier * atrValue;
    let lowerBand = hl2 - multiplier * atrValue;

    const last = prev(candles, index);
    const prevLowerBand = last ? num((last as Record<string, unknown>)['finalLowerBand']) : lowerBand;
    const prevUpperBand = last ? num((last as Record<string, unknown>)['finalUpperBand']) : upperBand;
    const prevSuperTrend = last ? num((last as Record<string, unknown>)['superTrend']) : 0;
    const prevClose = last?.close ?? c.close;

    lowerBand = (lowerBand > prevLowerBand || prevClose < prevLowerBand)
      ? lowerBand
      : prevLowerBand;

    upperBand = (upperBand < prevUpperBand || prevClose > prevUpperBand)
      ? upperBand
      : prevUpperBand;

    let direction: number;
    if (!last) {
      direction = 1;
    } else if (prevSuperTrend === prevUpperBand) {
      direction = c.close > upperBand ? -1 : 1;
    } else {
      direction = c.close < lowerBand ? 1 : -1;
    }

    const superTrendValue = direction === -1 ? lowerBand : upperBand;
    const superTrendDirection = direction === -1 ? 'Buy' : 'Sell';

    return {
      superTrend: superTrendValue,
      finalUpperBand: upperBand,
      finalLowerBand: lowerBand,
      superTrendDirection,
    };
  };
}
