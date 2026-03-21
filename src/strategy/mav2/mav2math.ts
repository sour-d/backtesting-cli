import type { Candle } from '../../core/types.js';
import { atrEmaSeries } from '../indicators/atrEma.js';
import { smaAt } from '../indicators/rollingSma.js';
import { superTrendDirections } from '../indicators/superTrendSeries.js';

export interface Mav2BarComputed {
  readonly close: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly body: number;
  readonly maHigh: number;
  readonly maLow: number;
  readonly maTrendClose: number;
  readonly superTrendDirection: 'Buy' | 'Sell';
}

export interface Mav2SeriesParams {
  readonly maPeriod: number;
  readonly trendMaPeriod: number;
  readonly atrPeriod: number;
  readonly superTrendMultiplier: number;
}

const defaultSeries: Mav2SeriesParams = {
  maPeriod: 50,
  trendMaPeriod: 200,
  atrPeriod: 10,
  superTrendMultiplier: 2,
};

/** Precompute channel MAs, trend MA, ATR→SuperTrend — aligned with legacy backtesting stack. */
export function computeMav2Series(
  candles: readonly Candle[],
  params: Partial<Mav2SeriesParams> = {},
): {
  readonly today: Mav2BarComputed;
  readonly yesterday: Mav2BarComputed;
} | null {
  const p = { ...defaultSeries, ...params };
  const n = candles.length;
  const minLen = Math.max(p.trendMaPeriod, p.maPeriod) + 2;
  if (n < minLen) return null;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  const maHigh: number[] = new Array(n);
  const maLow: number[] = new Array(n);
  const maTrend: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    maHigh[i] = smaAt(highs, i, p.maPeriod) ?? NaN;
    maLow[i] = smaAt(lows, i, p.maPeriod) ?? NaN;
    maTrend[i] = smaAt(closes, i, p.trendMaPeriod) ?? NaN;
  }

  const atr = atrEmaSeries(candles, p.atrPeriod);
  const stDir = superTrendDirections(candles, atr, p.superTrendMultiplier);

  const pack = (idx: number): Mav2BarComputed => {
    const c = candles[idx]!;
    return {
      close: c.close,
      open: c.open,
      high: c.high,
      low: c.low,
      body: c.close - c.open,
      maHigh: maHigh[idx]!,
      maLow: maLow[idx]!,
      maTrendClose: maTrend[idx]!,
      superTrendDirection: stDir[idx]!,
    };
  };

  const yi = n - 2;
  const ti = n - 1;
  const today = pack(ti);
  const yesterday = pack(yi);

  if (
    ![today, yesterday].every(
      (b) =>
        Number.isFinite(b.maHigh) &&
        Number.isFinite(b.maLow) &&
        Number.isFinite(b.maTrendClose) &&
        b.superTrendDirection,
    )
  ) {
    return null;
  }

  return { today, yesterday };
}
