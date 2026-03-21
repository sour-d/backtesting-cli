import type { ILogger } from '../logger/ILogger.js';
import type { IStrategy } from './IStrategy.js';

export type TradingSignal =
  | { action: 'HOLD' }
  | { action: 'CLOSE' }
  | { action: 'BUY'; qty: number; price?: number }
  | { action: 'SELL'; qty: number; price?: number };

export type StrategyFactory = (ctx: StrategyContext) => IStrategy;

export interface StrategyContext {
  readonly logger: ILogger;
  readonly symbol: string;
  /** Optional MAV2 tuning — backtest passes values from quantlab config. */
  readonly strategyParams?: Partial<import('./mav2/evaluateMav2.js').Mav2Params>;
}
