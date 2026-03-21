/**
 * Persisted deployment — strategy is referenced by id resolved at runtime via StrategyRegistry.
 */
export interface DeploymentState {
  readonly id: string;
  readonly symbol: string;
  readonly strategyId: string;
  readonly capital: number;
  readonly createdAt: number;
  readonly status: 'active' | 'stopped';
}
