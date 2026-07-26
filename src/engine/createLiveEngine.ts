import type { CategoryV5 } from "bybit-api";
import { createBot } from "../bot/createBot.js";
import { createBroker } from "../broker/createBroker.js";
import { PositionService } from "../position/PositionService.js";
import { parseKlineInterval } from "../config/klineInterval.js";
import { createLogger } from "../logger/createLogger.js";
import { createMarketRuntime } from "../market-runtime/createMarketRuntime.js";
import { createStore } from "../store/createStore.js";
import type { StrategyRegistry } from "../strategy/StrategyRegistry.js";
import { createStrategyRegistry } from "./createStrategyRegistry.js";
import type { LiveEngineConfig } from "./liveConfig.js";

const MODE = "live" as const;

export interface LiveEngineHandles {
  readonly store: ReturnType<typeof createStore>;
  readonly logger: ReturnType<typeof createLogger>;
  readonly marketRuntime: ReturnType<typeof createMarketRuntime>;
  readonly broker: ReturnType<typeof createBroker>;
  readonly bot: ReturnType<typeof createBot>;
  readonly strategies: StrategyRegistry;
  readonly positionService: PositionService;
}

/**
 * Composition root for live mode — wires shared strategy instances and registries.
 * Does not start IO (feed, HTTP, broker timers); callers own lifecycle.
 */
export function createLiveEngine(config: LiveEngineConfig): LiveEngineHandles {
  const store = createStore({
    mode: MODE,
    baseDir: config.dataDir,
    supabaseUrl: config.supabaseUrl,
    supabaseKey: config.supabaseKey,
  });

  const logTargets =
    config.logTargets && config.logTargets.length > 0
      ? config.logTargets
      : (["console", "db"] as const);
  const logger = createLogger({
    mode: MODE,
    logLevel: config.logLevel,
    targets: logTargets,
    baseDir: config.dataDir,
    store: logTargets.includes("db") ? store : undefined,
  });

  const strategies = createStrategyRegistry({ mode: MODE });
  const positionService = new PositionService({ feeRate: 0 });

  const marketRuntime = createMarketRuntime({
    mode: MODE,
    logger,
    store,
    category: config.category,
    klineInterval: parseKlineInterval(config.klineInterval),
    warmupCandles: config.warmupCandles,
    testnet: config.testnet,
    demoTrading: config.demoTrading,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
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
    venueSyncMinIntervalMs: config.venueSyncMinIntervalMs,
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
    defaultKlineInterval: config.klineInterval,
    brokerFailureThreshold: config.brokerFailureThreshold,
    brokerPauseCooldownMs: config.brokerPauseCooldownMs,
  });

  return { store, logger, marketRuntime, broker, bot, strategies, positionService };
}

/** Alias — composition root factory for the live engine. */
export const createEngine = createLiveEngine;
export type EngineHandles = LiveEngineHandles;
