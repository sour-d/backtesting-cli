import type { Express, Request, Response } from 'express';
import type { IStore } from '../../store/IStore.js';
import type { StoredTrade } from '../../types/deployment.js';
import type {
  TradeQueryFilters,
  DeploymentQueryFilters,
  CandleQueryFilters,
  LogQueryFilters,
} from '../../store/IStore.js';
import { safeErrorMessage } from '../../utils/safeErrorMessage.js';

function strParam(req: Request, key: string): string | undefined {
  const val = req.query[key];
  return typeof val === 'string' ? val : undefined;
}

function intParam(req: Request, key: string): number | undefined {
  const val = req.query[key];
  if (typeof val !== 'string') return undefined;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function registerDashboardRoutes(app: Express, store: IStore): void {

  // GET /api/dashboard/trades
  app.get('/api/dashboard/trades', async (req: Request, res: Response) => {
    try {
      const filters: TradeQueryFilters = {
        symbol: strParam(req, 'symbol'),
        side: strParam(req, 'side'),
        result: strParam(req, 'result'),
        exitType: strParam(req, 'exitType'),
        deploymentId: strParam(req, 'deploymentId'),
        from: strParam(req, 'from'),
        to: strParam(req, 'to'),
        limit: intParam(req, 'limit') ?? 100,
        offset: intParam(req, 'offset') ?? 0,
      };
      const trades = await store.queryTrades(filters);
      res.json({ trades, count: trades.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // GET /api/dashboard/trades/stats
  app.get('/api/dashboard/trades/stats', async (req: Request, res: Response) => {
    try {
      const filters: TradeQueryFilters = {
        symbol: strParam(req, 'symbol'),
        deploymentId: strParam(req, 'deploymentId'),
        from: strParam(req, 'from'),
        to: strParam(req, 'to'),
        limit: 10_000,
      };
      const trades = await store.queryTrades(filters);
      res.json(computeTradeStats(trades));
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // GET /api/dashboard/deployments
  app.get('/api/dashboard/deployments', async (req: Request, res: Response) => {
    try {
      const filters: DeploymentQueryFilters = {
        status: strParam(req, 'status'),
        symbol: strParam(req, 'symbol'),
        strategyName: strParam(req, 'strategyName'),
      };
      const deployments = await store.queryDeployments(filters);
      res.json({ deployments, count: deployments.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // GET /api/dashboard/positions
  app.get('/api/dashboard/positions', async (_req: Request, res: Response) => {
    try {
      const positions = await store.queryAllPositions();
      res.json({ positions, count: positions.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // GET /api/dashboard/candles
  app.get('/api/dashboard/candles', async (req: Request, res: Response) => {
    const symbol = strParam(req, 'symbol');
    const interval = strParam(req, 'interval');

    if (!symbol || !interval) {
      res.status(400).json({ error: 'symbol and interval query params are required' });
      return;
    }

    try {
      const filters: CandleQueryFilters = {
        symbol,
        interval,
        from: strParam(req, 'from'),
        to: strParam(req, 'to'),
        limit: intParam(req, 'limit') ?? 1000,
        offset: intParam(req, 'offset') ?? 0,
      };
      const candles = await store.queryCandles(filters);
      res.json({ candles, count: candles.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // GET /api/dashboard/logs
  app.get('/api/dashboard/logs', async (req: Request, res: Response) => {
    try {
      const filters: LogQueryFilters = {
        sessionId: strParam(req, 'sessionId'),
        level: strParam(req, 'level'),
        component: strParam(req, 'component'),
        from: strParam(req, 'from'),
        to: strParam(req, 'to'),
        limit: intParam(req, 'limit') ?? 100,
        offset: intParam(req, 'offset') ?? 0,
      };
      const logs = await store.queryLogs(filters);
      res.json({ logs, count: logs.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // GET /api/dashboard/equity
  app.get('/api/dashboard/equity', async (req: Request, res: Response) => {
    try {
      const filters: TradeQueryFilters = {
        symbol: strParam(req, 'symbol'),
        deploymentId: strParam(req, 'deploymentId'),
        from: strParam(req, 'from'),
        to: strParam(req, 'to'),
        limit: 10_000,
      };
      const trades = await store.queryTrades(filters);

      const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
      let cumulative = 0;
      const curve = sorted.map((t) => {
        cumulative += t.netPnl;
        return { time: t.exitTime, cumulativePnl: Math.round(cumulative * 100) / 100 };
      });

      res.json({ curve, points: curve.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}

function errorMessage(err: unknown): string {
  return safeErrorMessage(err);
}

interface SymbolStats {
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
}

function computeTradeStats(trades: StoredTrade[]) {
  const total = trades.length;
  if (total === 0) {
    return {
      total: 0, wins: 0, losses: 0, winRate: 0,
      grossPnl: 0, totalFees: 0, netPnl: 0,
      avgWin: 0, avgLoss: 0, bestTrade: 0, worstTrade: 0,
      bySymbol: {},
    };
  }

  let wins = 0;
  let losses = 0;
  let grossPnl = 0;
  let totalFees = 0;
  let netPnl = 0;
  let winSum = 0;
  let lossSum = 0;
  let best = -Infinity;
  let worst = Infinity;
  const bySymbol = new Map<string, SymbolStats>();

  for (const t of trades) {
    grossPnl += t.grossPnl;
    totalFees += t.fee;
    netPnl += t.netPnl;

    if (t.netPnl > best) best = t.netPnl;
    if (t.netPnl < worst) worst = t.netPnl;

    if (t.result === 'Profit') {
      wins++;
      winSum += t.netPnl;
    } else {
      losses++;
      lossSum += t.netPnl;
    }

    let sym = bySymbol.get(t.symbol);
    if (!sym) {
      sym = { trades: 0, wins: 0, losses: 0, netPnl: 0 };
      bySymbol.set(t.symbol, sym);
    }
    sym.trades++;
    sym.netPnl += t.netPnl;
    if (t.result === 'Profit') sym.wins++;
    else sym.losses++;
  }

  const r = (n: number) => Math.round(n * 100) / 100;
  const symbolObj: Record<string, SymbolStats> = {};
  for (const [k, v] of bySymbol) {
    symbolObj[k] = { trades: v.trades, wins: v.wins, losses: v.losses, netPnl: r(v.netPnl) };
  }

  return {
    total,
    wins,
    losses,
    winRate: r((wins / total) * 100),
    grossPnl: r(grossPnl),
    totalFees: r(totalFees),
    netPnl: r(netPnl),
    avgWin: wins > 0 ? r(winSum / wins) : 0,
    avgLoss: losses > 0 ? r(lossSum / losses) : 0,
    bestTrade: r(best),
    worstTrade: r(worst),
    bySymbol: symbolObj,
  };
}
