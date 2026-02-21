import type { Candle, EnrichedCandle } from '../types/index.js';
import type { IndicatorFn } from './indicators/types.js';

export function enrichCandle(
  history: EnrichedCandle[],
  index: number,
  indicators: readonly IndicatorFn[],
): EnrichedCandle {
  let candle = history[index]!;

  for (const indicator of indicators) {
    const values = indicator(history, index);
    candle = { ...candle, ...values };
    history[index] = candle;
  }

  return candle;
}

export function enrichAll(
  rawCandles: readonly Candle[],
  indicators: readonly IndicatorFn[],
): EnrichedCandle[] {
  const enriched: EnrichedCandle[] = rawCandles.map((c) => ({ ...c }));

  for (let i = 0; i < enriched.length; i++) {
    enrichCandle(enriched, i, indicators);
  }

  return enriched;
}

export function enrichSingle(
  history: EnrichedCandle[],
  newCandle: Candle,
  indicators: readonly IndicatorFn[],
): EnrichedCandle {
  const index = history.length;
  history.push({ ...newCandle } as EnrichedCandle);
  return enrichCandle(history, index, indicators);
}
