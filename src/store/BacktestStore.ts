import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Candle, LogRecord, OrderHistoryPatch, TradeRecord } from '../core/types.js';
import { backtestTradeFileName } from '../engine/backtestSummary.js';
import type { DeploymentState } from '../deployment/types.js';
import type { PositionRecord } from '../position/types.js';
import type { IStore, WarmupBarRow } from './IStore.js';

/**
 * File-backed persistence for backtest: `deployments.json`, `positions.json`, and
 * per-symbol `{SYMBOL}_{INTERVAL}.jsonl` trade lines under `backtest/trades/` (reset at each run — see prepareBacktestRun).
 */
export class BacktestStore implements IStore {
  private readonly root: string;

  constructor(baseDir: string) {
    this.root = join(baseDir, 'backtest');
  }

  private async ensureDir(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
  }

  private positionsPath(): string {
    return join(this.root, 'positions.json');
  }

  private async readPositions(): Promise<PositionRecord[]> {
    const file = this.positionsPath();
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as PositionRecord[]) : [];
    } catch {
      return [];
    }
  }

  private async writePositions(rows: PositionRecord[]): Promise<void> {
    const file = this.positionsPath();
    await this.ensureDir(file);
    await writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
  }

  async saveCandle(
    _symbol: string,
    _klineInterval: string,
    _candle: Candle,
    _indicators: Record<string, unknown>,
  ): Promise<void> {
    /* no-op — avoid huge I/O during replay */
  }

  async truncateCandleTail(_symbol: string, _klineInterval: string, _lineCount: number): Promise<void> {
    /* no-op — live only */
  }

  async storeWarmupData(
    _symbol: string,
    _klineInterval: string,
    _tailLineCount: number,
    _bars: readonly WarmupBarRow[],
  ): Promise<void> {
    /* no-op — backtest avoids candle I/O */
  }

  async loadRecentCandles(_symbol: string, _klineInterval: string, _limit: number): Promise<Candle[]> {
    return [];
  }

  async saveTrade(record: TradeRecord): Promise<void> {
    const file = join(this.root, 'trades', backtestTradeFileName(record.symbol, record.klineInterval));
    await this.ensureDir(file);
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async upsertOrderHistory(_patch: OrderHistoryPatch): Promise<void> {
    /* no-op — backtest avoids order_history I/O */
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
    const next = all.filter((d) => d.id !== id);
    const file = join(this.root, 'deployments.json');
    await this.ensureDir(file);
    await writeFile(file, JSON.stringify(next, null, 2), 'utf8');
    const pos = (await this.readPositions()).filter((p) => p.deploymentId !== id);
    await this.writePositions(pos);
  }

  async createPosition(record: PositionRecord): Promise<void> {
    const rows = await this.readPositions();
    const next = rows.filter((p) => p.id !== record.id && p.deploymentId !== record.deploymentId);
    next.push(record);
    await this.writePositions(next);
  }

  async updatePositionStopLoss(id: string, stopLoss: number, updatedAtMs: number): Promise<void> {
    const rows = await this.readPositions();
    const i = rows.findIndex((p) => p.id === id);
    if (i < 0) return;
    const cur = rows[i]!;
    rows[i] = { ...cur, stopLoss, updatedAtMs };
    await this.writePositions(rows);
  }

  async updatePositionOpenSnapshot(
    id: string,
    fields: {
      readonly qty: number;
      readonly avgEntryPrice: number | undefined;
      readonly side: 'Buy' | 'Sell';
      readonly updatedAtMs: number;
    },
  ): Promise<void> {
    const rows = await this.readPositions();
    const i = rows.findIndex((p) => p.id === id);
    if (i < 0) return;
    const cur = rows[i]!;
    rows[i] = {
      ...cur,
      qty: fields.qty,
      avgEntryPrice: fields.avgEntryPrice,
      side: fields.side,
      updatedAtMs: fields.updatedAtMs,
    };
    await this.writePositions(rows);
  }

  async deletePosition(id: string): Promise<void> {
    const rows = (await this.readPositions()).filter((p) => p.id !== id);
    await this.writePositions(rows);
  }

  async loadPositionByDeploymentId(deploymentId: string): Promise<PositionRecord | null> {
    const rows = await this.readPositions();
    return rows.find((p) => p.deploymentId === deploymentId) ?? null;
  }

  async saveLog(_record: LogRecord): Promise<void> {
    /* no-op — backtest does not persist logger rows to disk (avoids huge JSONL). */
  }
}
