import type { Candle } from '../core/types.js';

export type IndicatorCompute = (candles: readonly Candle[]) => unknown;

export interface IndicatorDefinition {
  readonly compute: IndicatorCompute;
}
