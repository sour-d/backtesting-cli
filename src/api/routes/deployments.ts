import type { Express, Request, Response } from 'express';
import type { DeploymentManager } from '../../deployment/DeploymentManager.js';
import type { DeployRequest, DeploymentConfig } from '../../types/deployment.js';

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0]! : id!;
}

export function registerDeploymentRoutes(app: Express, dm: DeploymentManager): void {

  app.post('/api/deployments', async (req: Request, res: Response) => {
    const body = req.body as DeployRequest;

    if (!body.symbols || !Array.isArray(body.symbols) || body.symbols.length === 0) {
      res.status(400).json({ error: 'symbols must be a non-empty array' });
      return;
    }
    if (!body.strategy || typeof body.strategy !== 'string') {
      res.status(400).json({ error: 'strategy is required' });
      return;
    }
    if (!body.capital || typeof body.capital !== 'number' || body.capital <= 0) {
      res.status(400).json({ error: 'capital must be a positive number' });
      return;
    }
    if (!body.riskPercentage || typeof body.riskPercentage !== 'number') {
      res.status(400).json({ error: 'riskPercentage is required' });
      return;
    }
    if (!body.maxAllocation || typeof body.maxAllocation !== 'number') {
      res.status(400).json({ error: 'maxAllocation is required' });
      return;
    }

    try {
      const deployments = await dm.deploy(body);
      res.status(201).json({ deployments });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/deployments', async (_req: Request, res: Response) => {
    const deployments = await dm.list();
    res.json({ deployments });
  });

  app.get('/api/deployments/:id', async (req: Request, res: Response) => {
    const info = await dm.get(paramId(req));
    if (!info) {
      res.status(404).json({ error: 'Deployment not found' });
      return;
    }
    res.json(info);
  });

  app.delete('/api/deployments/:id', async (req: Request, res: Response) => {
    try {
      const returnedCapital = await dm.stop(paramId(req));
      res.json({ success: true, returnedCapital });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.patch('/api/deployments/:id', async (req: Request, res: Response) => {
    try {
      const deployment = await dm.update(paramId(req), req.body as Partial<DeploymentConfig>);
      res.json(deployment);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/deployments/:id/pause', async (req: Request, res: Response) => {
    try {
      await dm.pause(paramId(req));
      res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/deployments/:id/resume', async (req: Request, res: Response) => {
    try {
      await dm.resume(paramId(req));
      res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/deployments/:id/trades', async (req: Request, res: Response) => {
    try {
      const trades = await dm['store'].loadTrades(paramId(req));
      res.json({ trades });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });
}
