import type { CategoryV5 } from 'bybit-api';
import { createBot } from '../bot/createBot.js';
import { createBroker } from '../broker/createBroker.js';
import { parseKlineInterval } from '../config/klineInterval.js';
import { createLogger } from '../logger/createLogger.js';
import { FileMarketRuntime } from '../market-runtime/FileMarketRuntime.js';
import { createStore } from '../store/createStore.js';
import { createNoopStrategy } from '../strategy/builtin/noopStrategy.js';
import { createMovingAverageV2Strategy } from '../strategy/mav2/createMovingAverageV2Strategy.js';
import { StrategyRegistry } from '../strategy/StrategyRegistry.js';
import type { StrategyContext } from '../strategy/types.js';
import type { BacktestEngineConfig } from './backtestConfig.js';

const MODE = 'backtest' as const;

export interface BacktestEngineHandles {
  readonly store: ReturnType<typeof createStore>;
  readonly logger: ReturnType<typeof createLogger>;
  readonly marketRuntime: FileMarketRuntime;
  readonly broker: ReturnType<typeof createBroker>;
  readonly bot: ReturnType<typeof createBot>;
  readonly strategies: StrategyRegistry;
}

export function createBacktestEngine(config: BacktestEngineConfig): BacktestEngineHandles {
  const store = createStore({ mode: MODE, baseDir: config.dataDir });

  const logger = createLogger({
    mode: MODE,
    logLevel: config.logLevel,
    targets: ['console', 'file'],
    baseDir: config.dataDir,
  });

  const strategies = new StrategyRegistry();
  const mav2Factory = (ctx: StrategyContext) =>
    createMovingAverageV2Strategy({
      ...ctx,
      strategyParams: {
        riskPercentage: config.mav2RiskPercentage,
        maxAllocation: config.mav2MaxAllocation,
      },
    });
  strategies.register('noop', createNoopStrategy);
  strategies.register('mav2', mav2Factory);
  strategies.register('MovingAverage_v2', mav2Factory);

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
  });

  const bot = createBot(MODE, {
    logger,
    store,
    broker,
    marketRuntime,
    strategies,
    feeRate: config.feeRate,
  });

  return { store, logger, marketRuntime, broker, bot, strategies };
}
