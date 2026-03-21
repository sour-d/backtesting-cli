import type { EnrichedCandle } from '../../core/types.js';
import type { Instrument } from '../../instrument/Instrument.js';
import type { IStrategy } from '../IStrategy.js';
import type { StrategyContext } from '../types.js';
import type { TradingSignal } from '../types.js';
import { evaluateMav2 } from './evaluateMav2.js';

export function createMovingAverageV2Strategy(_ctx: StrategyContext): IStrategy {
  return {
    strategyId: 'mav2',
    async evaluate(instrument: Instrument, _candle: EnrichedCandle): Promise<TradingSignal | TradingSignal[]> {
      const candles = instrument.getCandles(400);
      const signals = evaluateMav2({ instrument, candles });
      const flat = signals.filter((s) => s.action !== 'HOLD');
      if (flat.length === 0) return { action: 'HOLD' };
      return flat.length === 1 ? flat[0]! : flat;
    },
  };
}
