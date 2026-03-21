import type { StrategyFactory } from './types.js';

export class StrategyRegistry {
  private readonly factories = new Map<string, StrategyFactory>();

  register(strategyId: string, factory: StrategyFactory): void {
    this.factories.set(strategyId, factory);
  }

  resolve(strategyId: string): StrategyFactory | undefined {
    return this.factories.get(strategyId);
  }

  listIds(): string[] {
    return [...this.factories.keys()];
  }
}
