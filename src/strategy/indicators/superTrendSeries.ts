import type { Candle } from '../../core/types.js';

/**
 * SuperTrend direction per bar — ported from backtesting `technicalIndicators/superTrend.js`
 * (ATR precomputed per bar; multiplier default 2 in legacy stack).
 */
export function superTrendDirections(
  candles: readonly Candle[],
  atr: readonly number[],
  multiplier: number,
): ('Buy' | 'Sell')[] {
  const n = candles.length;
  const finalU: number[] = new Array(n);
  const finalL: number[] = new Array(n);
  const st: number[] = new Array(n);
  const dir: ('Buy' | 'Sell')[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const q = candles[i]!;
    const a = atr[i]!;
    const src = (q.high + q.low) / 2;

    let upperBand = src + multiplier * a;
    let lowerBand = src - multiplier * a;

    const prevLowerBand = i > 0 ? finalL[i - 1]! : lowerBand;
    const prevUpperBand = i > 0 ? finalU[i - 1]! : upperBand;
    const prevClose = i > 0 ? candles[i - 1]!.close : q.close;

    lowerBand =
      lowerBand > prevLowerBand || prevClose < prevLowerBand ? lowerBand : prevLowerBand;
    upperBand =
      upperBand < prevUpperBand || prevClose > prevUpperBand ? upperBand : prevUpperBand;

    let direction: 1 | -1;
    if (i === 0) {
      direction = 1;
    } else if (st[i - 1] === finalU[i - 1]) {
      direction = q.close > upperBand ? -1 : 1;
    } else {
      direction = q.close < lowerBand ? 1 : -1;
    }

    const superTrend = direction === -1 ? lowerBand : upperBand;
    finalU[i] = upperBand;
    finalL[i] = lowerBand;
    st[i] = superTrend;
    dir[i] = direction === -1 ? 'Buy' : 'Sell';
  }

  return dir;
}
