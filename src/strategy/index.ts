export type { IStrategy } from './IStrategy.js';
export { MovingAverageStrategy } from './MovingAverageStrategy.js';
export { MovingAverageV2Strategy } from './MovingAverageV2Strategy.js';

import type { IStrategy } from './IStrategy.js';
import { MovingAverageStrategy } from './MovingAverageStrategy.js';
import { MovingAverageV2Strategy } from './MovingAverageV2Strategy.js';

type StrategyConstructor = new () => IStrategy;

const STRATEGIES: Record<string, StrategyConstructor> = {
  MovingAverage: MovingAverageStrategy,
  MovingAverage_v2: MovingAverageV2Strategy,
};

export function resolveStrategy(name: string): IStrategy {
  const Ctor = STRATEGIES[name];
  if (!Ctor) {
    const available = Object.keys(STRATEGIES).join(', ');
    throw new Error(`Unknown strategy "${name}". Available: ${available}`);
  }
  return new Ctor();
}

export { STRATEGIES };
