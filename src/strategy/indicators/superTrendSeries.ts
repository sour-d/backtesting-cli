import type { Candle, EnrichedCandle } from "../../core/types.js";
import { atrEmaFromLast } from "./atrEma.js";

/** One bar of SuperTrend state — matches backtesting-cli-old `superTrend.js` fields on the quote. */
export type SuperTrendState = {
  readonly direction: "Buy" | "Sell";
  readonly finalUpperBand: number;
  readonly finalLowerBand: number;
  readonly superTrend: number;
};

/**
 * Single-bar SuperTrend (hl2 bands + ATR) — same logic as `calculateSuperTrendForQuote` in `superTrend.js`.
 * ATR must already be computed for this bar (`quote.atr` in legacy).
 */
export function superTrendStep(
  quote: Candle,
  atr: number,
  multiplier: number,
  prev: SuperTrendState | undefined,
  prevLastQuoteClose: number | undefined,
): SuperTrendState {
  const src = (quote.high + quote.low) / 2;
  let upperBand = src + multiplier * atr;
  let lowerBand = src - multiplier * atr;

  const prevLowerBand = prev ? prev.finalLowerBand : lowerBand;
  const prevUpperBand = prev ? prev.finalUpperBand : upperBand;
  const prevSuperTrend = prev ? prev.superTrend : null;
  const prevClose =
    prevLastQuoteClose !== undefined ? prevLastQuoteClose : quote.close;

  lowerBand =
    lowerBand > prevLowerBand || prevClose < prevLowerBand
      ? lowerBand
      : prevLowerBand;
  upperBand =
    upperBand < prevUpperBand || prevClose > prevUpperBand
      ? upperBand
      : prevUpperBand;

  let direction: 1 | -1;
  if (!prev) {
    direction = 1;
  } else if (prevSuperTrend === prevUpperBand) {
    direction = quote.close > upperBand ? -1 : 1;
  } else {
    direction = quote.close < lowerBand ? 1 : -1;
  }

  const superTrend = direction === -1 ? lowerBand : upperBand;

  return {
    direction: direction === -1 ? "Buy" : "Sell",
    finalUpperBand: upperBand,
    finalLowerBand: lowerBand,
    superTrend,
  };
}

/**
 * Current bar using prior bar’s stored `indicators.superTrend` (and OHLC / ATR), matching incremental legacy flow.
 * ATR for this bar is computed here via {@link atrEmaFromLast}.
 */
export function superTrendFromPrev(
  candles: readonly EnrichedCandle[],
  candle: Candle,
  atrPeriod: number,
  multiplier: number,
): SuperTrendState {
  const atr = atrEmaFromLast(candles, candle, atrPeriod);
  const last = candles.length > 0 ? candles[candles.length - 1]! : undefined;
  const prev =
    last !== undefined && last.indicators.superTrend !== undefined
      ? (last.indicators.superTrend as SuperTrendState)
      : undefined;
  const prevClose = last !== undefined ? last.close : undefined;
  return superTrendStep(candle, atr, multiplier, prev, prevClose);
}

/**
 * Full series — each step uses {@link superTrendStep} so batch matches incremental / legacy.
 */
export function superTrendDirections(
  candles: readonly Candle[],
  atr: readonly number[],
  multiplier: number,
): ("Buy" | "Sell")[] {
  const n = candles.length;
  const dir: ("Buy" | "Sell")[] = new Array(n);
  let prevState: SuperTrendState | undefined;
  for (let i = 0; i < n; i++) {
    const prevClose = i > 0 ? candles[i - 1]!.close : undefined;
    prevState = superTrendStep(
      candles[i]!,
      atr[i]!,
      multiplier,
      prevState,
      prevClose,
    );
    dir[i] = prevState.direction;
  }
  return dir;
}
