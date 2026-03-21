import type { CategoryV5 } from 'bybit-api';
import { createBot } from '../bot/createBot.js';
import { createBroker } from '../broker/createBroker.js';
import { parseKlineInterval } from '../config/klineInterval.js';
import { createLogger } from '../logger/createLogger.js';
import { createMarketRuntime } from '../market-runtime/createMarketRuntime.js';
import { createStore } from '../store/createStore.js';
import { createNoopStrategy } from '../strategy/builtin/noopStrategy.js';
import { StrategyRegistry } from '../strategy/StrategyRegistry.js';
import type { LiveEngineConfig } from './liveConfig.js';

const MODE = 'live' as const;

export interface LiveEngineHandles {
  readonly store: ReturnType<typeof createStore>;
  readonly logger: ReturnType<typeof createLogger>;
  readonly marketRuntime: ReturnType<typeof createMarketRuntime>;
  readonly broker: ReturnType<typeof createBroker>;
  readonly bot: ReturnType<typeof createBot>;
  readonly strategies: StrategyRegistry;
}

/**
 * Composition root for live mode — wires factories and shared registries.
 * Does not start IO (feed, HTTP, broker timers); callers own lifecycle.
 */
export function createLiveEngine(config: LiveEngineConfig): LiveEngineHandles {
  const store = createStore({ mode: MODE, baseDir: config.dataDir });

  const logTargets =
    config.logTargets && config.logTargets.length > 0 ? config.logTargets : (['console', 'file'] as const);
  const logger = createLogger({
    mode: MODE,
    logLevel: config.logLevel,
    targets: logTargets,
    baseDir: config.dataDir,
    store: logTargets.includes('db') ? store : undefined,
  });

  const strategies = new StrategyRegistry();
  strategies.register('noop', createNoopStrategy);

  const marketRuntime = createMarketRuntime({
    mode: MODE,
    logger,
    store,
    category: config.category,
    klineInterval: parseKlineInterval(config.klineInterval), // why need this? can we pass the candle details from quant lab directly?
    warmupCandles: config.warmupCandles,
    testnet: config.testnet,
  });

  const broker = createBroker({
    mode: MODE,
    logger,
    store,
    category: config.category as CategoryV5,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    testnet: config.testnet,
    demoTrading: config.demoTrading,
    getInstrument: (symbol) => marketRuntime.getInstrument(symbol),
  });

  const bot = createBot(MODE, {
    logger,
    store,
    broker,
    marketRuntime,
    strategies,
  });

  return { store, logger, marketRuntime, broker, bot, strategies };
}

/** Alias — composition root factory for the live engine. */
export const createEngine = createLiveEngine;
export type EngineHandles = LiveEngineHandles;
