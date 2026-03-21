import type { Server } from 'node:http';
import { createHttpApp, listenHttp } from '../api/httpServer.js';
import type { LiveEngineConfig } from './liveConfig.js';
import { createLiveEngine } from './createLiveEngine.js';

export interface RunLiveLoopResult {
  readonly server: Server;
  readonly shutdown: () => Promise<void>;
}

/**
 * Connects candle handlers, restores state, starts market runtime, broker worker, and HTTP API.
 */
export async function runLiveLoop(config: LiveEngineConfig): Promise<RunLiveLoopResult> {
  const { bot, broker, marketRuntime, logger, store, strategies } = createLiveEngine(config);

  marketRuntime.onCandle((instrument, candle) => {
    void bot.onCandle(instrument, candle);
  });

  await marketRuntime.start();
  await bot.restoreDeployments();
  broker.start();

  const app = createHttpApp({ bot, store, strategies, logger });
  const server = listenHttp(app, config.port, logger);

  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    broker.stop();
    await marketRuntime.stop();
    logger.info('Engine shutdown complete');
  };

  return { server, shutdown };
}
