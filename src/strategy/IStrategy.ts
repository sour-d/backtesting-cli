import type { EnrichedCandle } from '../core/types.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { TradingSignal } from './types.js';

export interface IStrategy {
  readonly strategyId: string;
  /** Single action, or multiple (e.g. CLOSE then reversal entry on the same bar). */
  evaluate(instrument: Instrument, candle: EnrichedCandle): Promise<TradingSignal | TradingSignal[]>;
}
