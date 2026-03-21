import type { Candle, EnrichedCandle } from "../core/types.js";

export type IndicatorCompute = (
  candles: readonly EnrichedCandle[],
  candle: Candle,
) => unknown;

export type IndicatorConfigType = {
  compute: IndicatorCompute;
  name: string;
};
