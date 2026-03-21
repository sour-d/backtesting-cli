import type { IStrategy } from './IStrategy.js';

/** Shared strategy instances keyed by id — Bot resolves by deployment’s `strategyId` on each candle. */
export class StrategyRegistry {
  private readonly strategies = new Map<string, IStrategy>();

  register(strategyId: string, strategy: IStrategy): void {
    this.strategies.set(strategyId, strategy);
  }

  resolve(strategyId: string): IStrategy | undefined {
    return this.strategies.get(strategyId);
  }

  listIds(): string[] {
    return [...this.strategies.keys()];
  }
}
