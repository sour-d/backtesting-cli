/**
 * Persisted deployment — strategy is referenced by id resolved at runtime via StrategyRegistry.
 */
export interface DeploymentState {
  readonly id: string;
  readonly symbol: string;
  readonly strategyId: string;
  readonly capital: number;
  /** Bybit kline interval code (e.g. "60", "240", "D"). Omitted in legacy persisted rows — Bot uses engine default. */
  readonly klineInterval?: string;
  readonly createdAt: number;
  readonly status: 'active' | 'stopped';
}
