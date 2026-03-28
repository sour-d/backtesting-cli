import type { RunMode } from '../core/mode.js';
import type { CategoryV5 } from 'bybit-api';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IPositionBook } from '../position/IPositionBook.js';
import type { IStore } from '../store/IStore.js';
import type { IBroker } from './IBroker.js';
import { LiveBroker, type LiveBrokerOptions } from './LiveBroker.js';
import { TestBroker, type TestBrokerOptions } from './TestBroker.js';

export interface CreateBrokerConfig {
  readonly mode: RunMode;
  readonly logger: ILogger;
  readonly store: IStore;
  readonly category: CategoryV5;
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly testnet?: boolean;
  readonly demoTrading?: boolean;
  /** Live: `LiveBroker` fee estimate; backtest: `TestBroker` fill fee. */
  readonly feeRate?: number;
  readonly getInstrument: (symbol: string) => Instrument | undefined;
  /** Runtime position book — {@link PositionManager} after `Bot` wiring. */
  readonly getPositionBook: () => IPositionBook;
}

export function createBroker(config: CreateBrokerConfig): IBroker {
  switch (config.mode) {
    case 'live': {
      if (!config.apiKey || !config.apiSecret) {
        throw new Error('createBroker(live): apiKey and apiSecret are required');
      }
      const opts: LiveBrokerOptions = {
        logger: config.logger,
        store: config.store,
        category: config.category,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        testnet: config.testnet ?? false,
        demoTrading: config.demoTrading ?? false,
        feeRate: config.feeRate ?? 0.0006,
        getInstrument: config.getInstrument,
        getPositionBook: config.getPositionBook,
      };
      return new LiveBroker(opts);
    }
    case 'paper':
      throw new Error('createBroker: mode "paper" is not implemented yet');
    case 'backtest': {
      const opts: TestBrokerOptions = {
        logger: config.logger,
        store: config.store,
        category: config.category,
        feeRate: config.feeRate ?? 0.001,
        getInstrument: config.getInstrument,
        getPositionBook: config.getPositionBook,
      };
      return new TestBroker(opts);
    }
    default: {
      const _e: never = config.mode;
      return _e;
    }
  }
}
