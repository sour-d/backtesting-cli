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

  const host = config.host ?? '0.0.0.0';

  return new Promise((resolve) => {
    const server = app.listen(config.port, host, () => {
      logger.info('API server started', { port: String(config.port), host });
      resolve(server);
    });
  });
}
