import http from 'node:http';
import express from 'express';
import type { DeploymentManager } from '../deployment/DeploymentManager.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import { registerStrategyRoutes } from './routes/strategies.js';
import { registerDeploymentRoutes } from './routes/deployments.js';
import { registerDashboardRoutes } from './routes/dashboard.js';

export interface ServerConfig {
  port: number;
  host?: string;
}

export function createServer(
  dm: DeploymentManager,
  store: IStore,
  logger: ILogger,
  config: ServerConfig,
): Promise<http.Server> {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    logger.debug('Incoming request', { method: req.method, url: req.url });
    next();
  });

  registerStrategyRoutes(app);
  registerDeploymentRoutes(app, dm);
  registerDashboardRoutes(app, store);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/api/ping', (_req, res) => {
    res.status(200).json({ pong: true });
  });

  const host = config.host ?? '0.0.0.0';

  return new Promise((resolve) => {
    const server = app.listen(config.port, host, () => {
      logger.info('API server started', { port: String(config.port), host });
      resolve(server);
    });
  });
}

const PING_INTERVAL_MS = 60_000; // 1 min

/**
 * Start a loop that GETs baseUrl/api/ping every minute (e.g. to keep Render free tier awake).
 * Returns a cleanup function to clear the interval.
 */
export function startKeepAlivePing(baseUrl: string, logger?: ILogger): () => void {
  const url = baseUrl.replace(/\/$/, '') + '/api/ping';
  const timer = setInterval(() => {
    fetch(url)
      .then((res) => {
        if (logger && !res.ok) logger.warn('Keep-alive ping failed', { url, status: res.status });
      })
      .catch((err) => {
        if (logger) logger.warn('Keep-alive ping error', { url, error: String(err) });
      });
  }, PING_INTERVAL_MS);
  return () => clearInterval(timer);
}
