import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Bot } from '../bot/Bot.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { StrategyRegistry } from '../strategy/StrategyRegistry.js';

export interface HttpServerDeps {
  readonly bot: Bot;
  readonly store: IStore;
  readonly strategies: StrategyRegistry;
  readonly logger: ILogger;
}

export function createHttpApp(deps: HttpServerDeps): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'live' });
  });

  app.get('/api/strategies', (_req, res) => {
    res.json({ strategies: deps.strategies.listIds() });
  });

  app.get('/api/deployments', async (_req, res) => {
    try {
      const list = await deps.store.loadDeployments();
      res.json({ deployments: list });
    } catch (e) {
      deps.logger.error('GET /api/deployments failed', { message: String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.post('/api/deployments', async (req, res) => {
    try {
      const body = req.body as {
        id?: string;
        symbol: string;
        strategyId: string;
        capital: number;
        /** Bybit kline interval (e.g. "60", "240", "D"). Omit to use engine default (`--interval` / `KLINE_INTERVAL`). */
        klineInterval?: string;
      };
      if (!body.symbol || !body.strategyId || typeof body.capital !== 'number') {
        res.status(400).json({ error: 'symbol, strategyId, capital required' });
        return;
      }
      const id = body.id ?? randomUUID();
      const { klineInterval } = await deps.bot.deploy({
        id,
        symbol: body.symbol,
        strategyId: body.strategyId,
        capital: body.capital,
        klineInterval: body.klineInterval,
      });
      res.status(201).json({ id, symbol: body.symbol, strategyId: body.strategyId, klineInterval });
    } catch (e) {
      deps.logger.error('POST /api/deployments failed', { message: String(e) });
      res.status(400).json({ error: String(e) });
    }
  });

  app.delete('/api/deployments/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!id) {
        res.status(400).json({ error: 'id required' });
        return;
      }
      await deps.bot.removeDeployment(id);
      res.status(204).send();
    } catch (e) {
      deps.logger.error('DELETE /api/deployments/:id failed', { message: String(e) });
      const msg = String(e);
      if (msg.includes('not found')) {
        res.status(404).json({ error: msg });
        return;
      }
      res.status(400).json({ error: msg });
    }
  });

  return app;
}

export function listenHttp(app: express.Express, port: number, logger: ILogger): Server {
  const server = app.listen(port, () => {
    logger.info('HTTP server listening', { port });
  });
  return server;
}
