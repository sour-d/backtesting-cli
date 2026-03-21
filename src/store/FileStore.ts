import { mkdir, appendFile, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Candle, LogRecord, OrderRecord, TradeRecord } from '../core/types.js';
import type { DeploymentState } from '../deployment/types.js';
import type { IStore, WarmupBarRow } from './IStore.js';

export class FileStore implements IStore {
  private readonly root: string;

  /** `paper` → `.data/paper/…`; legacy `live` file layout under `.data/live/…` (not used when live uses Supabase). */
  constructor(baseDir: string, subdir: 'live' | 'paper' = 'paper') {
    this.root = join(baseDir, subdir);
  }

  private async ensureDir(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
  }

  async saveCandle(
    symbol: string,
    klineInterval: string,
    candle: Candle,
    indicators: Record<string, unknown>,
  ): Promise<void> {
    const file = join(this.root, 'candles', `${symbol}_${klineInterval}.jsonl`);
    await this.ensureDir(file);
    const line = JSON.stringify({
      ...candle,
      indicators,
      savedAt: Date.now(),
    });
    await appendFile(file, `${line}\n`, 'utf8');
  }

  async truncateCandleTail(symbol: string, klineInterval: string, lineCount: number): Promise<void> {
    if (lineCount <= 0) return;
    const file = join(this.root, 'candles', `${symbol}_${klineInterval}.jsonl`);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      return;
    }
    const lines = raw.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return;
    const keep = Math.max(0, lines.length - lineCount);
    const next = lines.slice(0, keep);
    if (next.length === 0) {
      try {
        await unlink(file);
      } catch {
        /* ignore */
      }
      return;
    }
    await writeFile(file, `${next.join('\n')}\n`, 'utf8');
  }

  async storeWarmupData(
    symbol: string,
    klineInterval: string,
    tailLineCount: number,
    bars: readonly WarmupBarRow[],
  ): Promise<void> {
    await this.truncateCandleTail(symbol, klineInterval, tailLineCount);
    for (const { candle, indicators } of bars) {
      await this.saveCandle(symbol, klineInterval, candle, indicators);
    }
  }

  async loadRecentCandles(symbol: string, klineInterval: string, limit: number): Promise<Candle[]> {
    const file = join(this.root, 'candles', `${symbol}_${klineInterval}.jsonl`);
    try {
      const raw = await readFile(file, 'utf8');
      const lines = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit);
      return lines.map((line) => {
        const o = JSON.parse(line) as Candle & { indicators?: unknown; savedAt?: number };
        const { indicators: _i, savedAt: _s, ...c } = o;
        return c as Candle;
      });
    } catch {
      return [];
    }
  }

  async saveTrade(record: TradeRecord): Promise<void> {
    const file = join(this.root, 'trades.jsonl');
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
    const next = all.filter((d) => d.id !== id);
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
