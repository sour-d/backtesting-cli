import type { RunMode } from '../core/types.js';
import type { IDataFeed } from './IDataFeed.js';
import type { IStore } from '../store/IStore.js';
import type { ILogger } from '../logger/ILogger.js';
import { HistoricalFeed } from './feeds/HistoricalFeed.js';
import { LiveFeed } from './feeds/LiveFeed.js';

export interface CreateDataFeedOptionsBacktest {
  mode: 'backtest';
  symbols: readonly string[];
  store: IStore;
  interval: string;
}

export interface CreateDataFeedOptionsStream {
  mode: 'paper' | 'live';
  interval: string;
  category?: 'linear' | 'spot' | 'inverse';
  testnet?: boolean;
  logger: ILogger;
}

export type CreateDataFeedOptions = CreateDataFeedOptionsBacktest | CreateDataFeedOptionsStream;

/**
 * Create data feed for the given mode.
 * - backtest: HistoricalFeed (load candles from store by symbol, sync by index)
 * - paper | live: LiveFeed (Bybit kline WebSocket, push confirmed candles to handler)
 */
export function createDataFeed(options: CreateDataFeedOptions): IDataFeed {
  if (options.mode === 'backtest') {
    const { symbols, store, interval } = options;
    return new HistoricalFeed({
      symbols,
      loadCandles: (symbol) => {
        const label = `${symbol}_${interval}`;
        return store.loadMarketData(label);
      },
    });
  }

  const { interval, category = 'linear', testnet = false, logger } = options;
  return new LiveFeed({
    interval,
    category,
    testnet,
    logger,
  });
}
