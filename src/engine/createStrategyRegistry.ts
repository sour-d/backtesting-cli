import type { RunMode } from '../core/mode.js';
import type { ILogger } from '../logger/ILogger.js';
import { NoopStrategy } from '../strategy/builtin/NoopStrategy.js';
import { MovingAverageV2Strategy } from '../strategy/mav2/MovingAverageV2Strategy.js';
import { StrategyRegistry } from '../strategy/StrategyRegistry.js';

export function createStrategyRegistry(opts: {
  readonly mode: RunMode;
  readonly logger?: ILogger;
}): StrategyRegistry {
  const registry = new StrategyRegistry();
  const mav2 = new MovingAverageV2Strategy();
  registry.register('mav2', mav2);
  registry.register('MovingAverage_v2', mav2);
  if (opts.mode === 'backtest') {
    if (!opts.logger) {
      throw new Error('createStrategyRegistry(backtest): logger is required for noop strategy');
    }
    registry.register('noop', new NoopStrategy(opts.logger));
  } else if (opts.mode === 'paper') {
    throw new Error('createStrategyRegistry: mode "paper" is not implemented yet');
  }
  return registry;
}
