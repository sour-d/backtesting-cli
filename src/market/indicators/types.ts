import type { EnrichedCandle } from '../../types/index.js';

export type IndicatorFn = (
  candles: readonly EnrichedCandle[],
  index: number,
) => Record<string, number | string>;
