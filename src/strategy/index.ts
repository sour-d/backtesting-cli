export type { IStrategy } from './IStrategy.js';
export { MovingAverageStrategy } from './MovingAverageStrategy.js';
export { MovingAverageV2Strategy } from './MovingAverageV2Strategy.js';

import type { IStrategy } from './IStrategy.js';
import type { DeploymentConfig } from '../types/deployment.js';
import { MovingAverageStrategy } from './MovingAverageStrategy.js';
import { MovingAverageV2Strategy } from './MovingAverageV2Strategy.js';

export interface StrategyParamDef {
  readonly default: number;
  readonly label: string;
}

export interface StrategyDefinition {
  readonly name: string;
  readonly description: string;
  readonly defaultDeploymentConfig: DeploymentConfig;
  readonly strategyParams: Readonly<Record<string, StrategyParamDef>>;
  create(params?: Record<string, number>): IStrategy;
}

const STRATEGY_DEFS: Record<string, StrategyDefinition> = {
  MovingAverage: {
    name: 'MovingAverage',
    description: 'Channel breakout strategy with SuperTrend filter',
    defaultDeploymentConfig: { capital: 100000, riskPercentage: 5, maxAllocation: 0.8, feeRate: 0.001 },
    strategyParams: {
      maPeriod: { default: 20, label: 'MA Period' },
      atrPeriod: { default: 10, label: 'ATR Period' },
      superTrendPeriod: { default: 10, label: 'SuperTrend Period' },
      superTrendMultiplier: { default: 2, label: 'SuperTrend Multiplier' },
      stopLossPct: { default: 0.04, label: 'Stop Loss %' },
    },
    create: (params) => new MovingAverageStrategy(params),
  },
  MovingAverage_v2: {
    name: 'MovingAverage_v2',
    description: 'Channel breakout with SMA trend filter',
    defaultDeploymentConfig: { capital: 100000, riskPercentage: 5, maxAllocation: 0.8, feeRate: 0.001 },
    strategyParams: {
      maPeriod: { default: 50, label: 'MA Period' },
      trendMaPeriod: { default: 200, label: 'Trend MA Period' },
      atrPeriod: { default: 10, label: 'ATR Period' },
      superTrendPeriod: { default: 10, label: 'SuperTrend Period' },
      superTrendMultiplier: { default: 2, label: 'SuperTrend Multiplier' },
      stopLossPct: { default: 0.04, label: 'Stop Loss %' },
    },
    create: (params) => new MovingAverageV2Strategy(params),
  },
};

export function getStrategyDefinitions(): Record<string, StrategyDefinition> {
  return { ...STRATEGY_DEFS };
}

export function resolveStrategy(name: string, params?: Record<string, number>): IStrategy {
  const def = STRATEGY_DEFS[name];
  if (!def) {
    const available = Object.keys(STRATEGY_DEFS).join(', ');
    throw new Error(`Unknown strategy "${name}". Available: ${available}`);
  }
  return def.create(params);
}
