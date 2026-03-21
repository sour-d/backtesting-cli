import type { Candle, EnrichedCandle } from "../../core/types.js";

/** True range (matches backtesting `calculateTR`). */
export function trueRange(c: Candle, prev: Candle | undefined): number {
  if (!prev) return c.high - c.low;
  const hl = c.high - c.low;
  const hc = Math.abs(c.high - prev.close);
  const lc = Math.abs(c.low - prev.close);
  return Math.max(hl, hc, lc);
}

const kForPeriod = (period: number) => 2 / (period + 1);

/**
 * One-step ATR (EMA on TR): `tr * k + lastAtr * (1 - k)` — same as backtesting-cli-old `atr.js`.
 */
export function atrEmaStep(
  candle: Candle,
  prev: Candle | undefined,
  lastAtr: number,
  period: number,
): number {
  const k = kForPeriod(period);
  const tr = trueRange(candle, prev);
  return tr * k + lastAtr * (1 - k);
}

/**
 * Current bar ATR using only the prior bar's stored `indicators.atr` (and OHLC), matching incremental `calculateATR`.
 */
export function atrEmaFromLast(
  candles: readonly EnrichedCandle[],
  candle: Candle,
  period: number,
): number {
  const prev = candles.length > 0 ? candles[candles.length - 1]! : undefined;
  const lastAtr =
    prev !== undefined && typeof prev.indicators.atr === "number"
      ? prev.indicators.atr
      : 0;
  return atrEmaStep(candle, prev, lastAtr, period);
}

/**
 * Full series (same recurrence as {@link atrEmaStep}) — useful for tests or batch charts.
 */
export function atrEmaSeries(
  candles: readonly Candle[],
  period: number,
): number[] {
  const n = candles.length;
  const out: number[] = new Array(n);
  let lastAtr = 0;
  for (let i = 0; i < n; i++) {
    lastAtr = atrEmaStep(
      candles[i]!,
      i > 0 ? candles[i - 1] : undefined,
      lastAtr,
      period,
    );
    out[i] = lastAtr;
  }
  return out;
}
