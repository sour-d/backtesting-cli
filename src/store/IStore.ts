import type { Candle, LogRecord, OrderRecord, TradeRecord } from '../core/types.js';
import type { DeploymentState } from '../deployment/types.js';

export interface IStore {
  saveCandle(symbol: string, candle: Candle, indicators: Record<string, unknown>): Promise<void>;
  loadRecentCandles(symbol: string, limit: number): Promise<Candle[]>;

  saveTrade(record: TradeRecord): Promise<void>;
  saveOrder(record: OrderRecord): Promise<void>;

  saveDeployment(state: DeploymentState): Promise<void>;
  loadDeployments(): Promise<DeploymentState[]>;
  deleteDeployment(id: string): Promise<void>;

  saveLog(record: LogRecord): Promise<void>;
}
