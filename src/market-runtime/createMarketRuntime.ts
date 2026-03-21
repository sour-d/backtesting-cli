import type { RunMode } from '../core/mode.js';
import type { KlineIntervalV3 } from 'bybit-api';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { InstrumentCategory } from '../instrument/types.js';
import type { IMarketRuntime } from './IMarketRuntime.js';
import { LiveMarketRuntime } from './LiveMarketRuntime.js';

export interface CreateMarketRuntimeConfig {
  readonly mode: RunMode;
  readonly logger: ILogger;
  readonly store: IStore;
  readonly category: InstrumentCategory;
  readonly klineInterval: KlineIntervalV3;
  readonly warmupCandles: number;
  readonly testnet: boolean;
}

export function createMarketRuntime(config: CreateMarketRuntimeConfig): IMarketRuntime {
  switch (config.mode) {
    case 'live':
      return new LiveMarketRuntime({
        logger: config.logger,
        store: config.store,
        category: config.category,
        klineInterval: config.klineInterval,
        warmupCandles: config.warmupCandles,
        testnet: config.testnet,
      });
    case 'paper':
      throw new Error('createMarketRuntime: mode "paper" is not implemented yet');
    case 'backtest':
      throw new Error('createMarketRuntime: mode "backtest" is not implemented yet');
    default: {
      const _e: never = config.mode;
      return _e;
    }
  }
}
