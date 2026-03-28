import type { Server } from 'node:http';
import { createHttpApp, listenHttp, stopLiveUrlPing } from '../api/httpServer.js';
import { PositionManager } from '../position/PositionManager.js';
import type { LiveEngineConfig } from './liveConfig.js';
import { createLiveEngine } from './createLiveEngine.js';
import { ReconciliationService } from './ReconciliationService.js';
import { RuntimeController } from './RuntimeController.js';

export interface RunLiveLoopResult {
  readonly server: Server;
  readonly shutdown: () => Promise<void>;
}

/**
 * Connects candle handlers, restores state, starts market runtime, broker worker, and HTTP API.
 */
export async function runLiveLoop(config: LiveEngineConfig): Promise<RunLiveLoopResult> {
  const { bot, broker, marketRuntime, logger, store, strategies } = createLiveEngine(config);

  const positionService = PositionManager.getInstance();
  const reconciliationService = new ReconciliationService(
    broker,
    positionService,
    store,
    logger,
  );
  const reconcileIntervalMs = config.reconcileIntervalMs ?? 30_000;

  const runtime = new RuntimeController({
    marketRuntime,
    broker,
    bot,
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
