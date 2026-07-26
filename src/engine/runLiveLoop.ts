import type { Server } from 'node:http';
import { createHttpApp, listenHttp, stopLiveUrlPing } from '../api/httpServer.js';
import { EventBus } from './events/EventBus.js';
import type { LiveEngineConfig } from './liveConfig.js';
import { createLiveEngine } from './createLiveEngine.js';
import { RuntimeController } from './RuntimeController.js';

export interface RunLiveLoopResult {
  readonly server: Server;
  readonly shutdown: () => Promise<void>;
}

function envPositiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Connects candle handlers, restores state, starts market runtime, broker worker, and HTTP API.
 */
export async function runLiveLoop(config: LiveEngineConfig): Promise<RunLiveLoopResult> {
  const effective: LiveEngineConfig = {
    ...config,
    venueSyncMinIntervalMs:
      config.venueSyncMinIntervalMs ??
      envPositiveInt('VENUE_SYNC_MIN_INTERVAL_MS'),
    brokerFailureThreshold:
      config.brokerFailureThreshold ??
      envPositiveInt('BROKER_FAILURE_THRESHOLD'),
    brokerPauseCooldownMs:
      config.brokerPauseCooldownMs ??
      envPositiveInt('BROKER_PAUSE_COOLDOWN_MS'),
  };

  const { bot, broker, marketRuntime, logger, store, strategies, positionService } =
    createLiveEngine(effective);

  const bus = new EventBus(logger);
  const reconciliationService = bot.reconciliationService;
  const reconcileIntervalMs = effective.reconcileIntervalMs ?? 30_000;

  const runtime = new RuntimeController({
    marketRuntime,
    broker,
    bot,
    bus,
    positionService,
    reconciliationService,
    logger,
    reconcileIntervalMs,
  });

  await runtime.start();

  const app = createHttpApp({ bot, store, strategies, logger });
  const server = listenHttp(app, config.port, logger);

  const shutdown = async (): Promise<void> => {
    stopLiveUrlPing();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await runtime.stop();
  };

  return { server, shutdown };
}
