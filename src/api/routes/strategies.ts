import type { Express } from 'express';
import { getStrategyDefinitions } from '../../strategy/index.js';

export function registerStrategyRoutes(app: Express): void {
  app.get('/api/strategies', (_req, res) => {
    const defs = getStrategyDefinitions();
    const result: Record<string, unknown> = {};

    for (const [name, def] of Object.entries(defs)) {
      result[name] = {
        name: def.name,
        description: def.description,
        deploymentDefaults: def.defaultDeploymentConfig,
        strategyParams: def.strategyParams,
      };
    }

    res.json(result);
  });
}
