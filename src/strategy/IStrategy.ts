import type { Signal, Position } from '../types/index.js';
import type { OHLCStorage } from '../market/OHLCStorage.js';
import type { IndicatorFn } from '../market/indicators/types.js';

export interface IStrategy {
  readonly name: string;
  evaluate(stock: OHLCStorage, position: Position | null): Signal | null;
  getIndicators(): IndicatorFn[];
}
