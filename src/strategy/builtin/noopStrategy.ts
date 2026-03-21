import type { EnrichedCandle } from '../../core/types.js';
import type { Instrument } from '../../instrument/Instrument.js';
import type { IStrategy } from '../IStrategy.js';
import type { StrategyContext } from '../types.js';
import type { TradingSignal } from '../types.js';

/** Default strategy — never acts (useful for connectivity / plumbing tests). */
export function createNoopStrategy(ctx: StrategyContext): IStrategy {
  return {
    strategyId: 'noop',
    async evaluate(_instrument: Instrument, _candle: EnrichedCandle): Promise<TradingSignal | TradingSignal[]> {
      ctx.logger.debug('noop evaluate');
      return { action: 'HOLD' };
    },
  };
}
