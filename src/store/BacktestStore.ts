import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Candle, LogRecord, OrderRecord, TradeRecord } from '../core/types.js';
import type { DeploymentState } from '../deployment/types.js';
import type { IStore } from './IStore.js';

/**
 * File-backed persistence for backtest: per-symbol trades, deployments under `backtest/`.
 */
export class BacktestStore implements IStore {
  private readonly root: string;
  private readonly tradesRoot: string;

  constructor(baseDir: string) {
    this.root = join(baseDir, 'backtest');
    this.tradesRoot = join(baseDir, 'trades');
  }

  private async ensureDir(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
  }

  async saveCandle(_symbol: string, _candle: Candle, _indicators: Record<string, unknown>): Promise<void> {
    /* no-op — avoid huge I/O during replay */
  }

  async loadRecentCandles(_symbol: string, _limit: number): Promise<Candle[]> {
    return [];
  }

  async saveTrade(record: TradeRecord): Promise<void> {
    const file = join(this.tradesRoot, `${record.symbol}.jsonl`);
    await this.ensureDir(file);
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async saveOrder(record: OrderRecord): Promise<void> {
    const file = join(this.root, 'orders.jsonl');
    await this.ensureDir(file);
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async saveDeployment(state: DeploymentState): Promise<void> {
    const all = await this.loadDeployments();
    const next = all.filter((d) => d.id !== state.id).concat(state);
    const file = join(this.root, 'deployments.json');
    await this.ensureDir(file);
    await writeFile(file, JSON.stringify(next, null, 2), 'utf8');
  }

  async loadDeployments(): Promise<DeploymentState[]> {
    const file = join(this.root, 'deployments.json');
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as DeploymentState[]) : [];
    } catch {
      return [];
    }
  }

  async deleteDeployment(id: string): Promise<void> {
    const all = await this.loadDeployments();
    const next = all.map((d) => (d.id === id ? { ...d, status: 'stopped' as const } : d));
    const file = join(this.root, 'deployments.json');
    await this.ensureDir(file);
    await writeFile(file, JSON.stringify(next, null, 2), 'utf8');
  }

  async saveLog(record: LogRecord): Promise<void> {
    const file = join(this.root, 'logs', 'app.jsonl');
    await this.ensureDir(file);
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }
}
