import type { EnrichedCandle } from '../core/types.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { TradingSignal } from './types.js';

export interface IStrategy {
  readonly strategyId: string;
  evaluate(instrument: Instrument, candle: EnrichedCandle): Promise<TradingSignal>;
}
