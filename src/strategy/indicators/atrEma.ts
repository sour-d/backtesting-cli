import type { Candle } from '../../core/types.js';

/** True range (matches backtesting `calculateTR`). */
export function trueRange(c: Candle, prev: Candle | undefined): number {
  if (!prev) return c.high - c.low;
  const hl = c.high - c.low;
  const hc = Math.abs(c.high - prev.close);
  const lc = Math.abs(c.low - prev.close);
  return Math.max(hl, hc, lc);
}

/**
 * ATR via EMA on TR with alpha = 2/(period+1) — same recurrence as backtesting `atr.js` (range=10).
 */
export function atrEmaSeries(candles: readonly Candle[], period: number): number[] {
  const n = candles.length;
  const k = 2 / (period + 1);
  const out = new Array<number>(n).fill(NaN);
  let prevAtr = 0;
  for (let i = 0; i < n; i++) {
    const tr = trueRange(candles[i]!, i > 0 ? candles[i - 1] : undefined);
    const atr = tr * k + prevAtr * (1 - k);
    prevAtr = atr;
    out[i] = atr;
  }
  return out;
}
