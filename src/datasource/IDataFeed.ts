import type { Candle } from '../types/index.js';

export type CandleHandler = (symbol: string, candle: Candle) => void;

export interface IDataFeed {
  start(): Promise<void>;
  stop(): void;
  onCandle(handler: CandleHandler): void;
}
