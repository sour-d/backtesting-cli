import type { EnrichedCandle } from '../../core/types.js';
import type { Instrument } from '../../instrument/Instrument.js';
import type { ILogger } from '../../logger/ILogger.js';
import type { IStrategy } from '../IStrategy.js';
import type { TradingSignal } from '../types.js';

/** Default strategy — never acts (useful for connectivity / plumbing tests). */
export class NoopStrategy implements IStrategy {
  readonly strategyId = 'noop';

  constructor(private readonly logger: ILogger) {}

  async evaluate(_instrument: Instrument, _candle: EnrichedCandle): Promise<TradingSignal | TradingSignal[]> {
    this.logger.debug('noop evaluate');
    return { action: 'HOLD' };
  }
}
