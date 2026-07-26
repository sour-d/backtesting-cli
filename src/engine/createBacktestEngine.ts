import type { CategoryV5 } from 'bybit-api';
import { createBot } from '../bot/createBot.js';
import { createBroker } from '../broker/createBroker.js';
import { PositionService } from '../position/PositionService.js';
import { parseKlineInterval } from '../config/klineInterval.js';
import { createLogger } from '../logger/createLogger.js';
import { FileMarketRuntime } from '../market-runtime/FileMarketRuntime.js';
import { createStore } from '../store/createStore.js';
import type { StrategyRegistry } from '../strategy/StrategyRegistry.js';
import { createStrategyRegistry } from './createStrategyRegistry.js';
import type { BacktestEngineConfig } from './backtestConfig.js';

const MODE = 'backtest' as const;

export interface BacktestEngineHandles {
  readonly store: ReturnType<typeof createStore>;
  readonly logger: ReturnType<typeof createLogger>;
  readonly marketRuntime: FileMarketRuntime;
  readonly broker: ReturnType<typeof createBroker>;
  readonly bot: ReturnType<typeof createBot>;
  readonly strategies: StrategyRegistry;
  readonly positionService: PositionService;
}

export function createBacktestEngine(config: BacktestEngineConfig): BacktestEngineHandles {
  const store = createStore({ mode: MODE, baseDir: config.dataDir });

  const logger = createLogger({
    mode: MODE,
    logLevel: config.logLevel,
    /** No file sink — backtest replay can emit hundreds of thousands of lines. */
    targets: config.quiet ? [] : ['console'],
    baseDir: config.dataDir,
  });

  const strategies = createStrategyRegistry({ mode: MODE, logger });
  const positionService = new PositionService({ feeRate: config.feeRate });

  const marketRuntime = new FileMarketRuntime({
    logger,
    store,
    dataDir: config.dataDir,
    category: config.category,
    klineInterval: parseKlineInterval(config.klineInterval),
    warmupCandles: config.warmupCandles,
    rangeStartMs: config.rangeStartMs,
    rangeEndMs: config.rangeEndMs,
  });

  const broker = createBroker({
    mode: MODE,
    logger,
    store,
    category: config.category as CategoryV5,
    feeRate: config.feeRate,
    getInstrument: (symbol) => marketRuntime.getInstrument(symbol),
    getPositionBook: () => positionService,
  });

  const bot = createBot(MODE, {
    logger,
    store,
    broker,
    marketRuntime,
    strategies,
    positionService,
    feeRate: config.feeRate,
    defaultKlineInterval: config.klineInterval,
  });

  return { store, logger, marketRuntime, broker, bot, strategies, positionService };
}
