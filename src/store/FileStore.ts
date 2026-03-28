import { mkdir, appendFile, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Candle, LogRecord, OrderHistoryPatch, OrderHistoryRecord, TradeRecord } from '../core/types.js';
import type { DeploymentState } from '../deployment/types.js';
import type { PositionRecord } from '../position/types.js';
import type { IStore, WarmupBarRow } from './IStore.js';
import { mergeOrderHistory } from './orderHistoryMerge.js';

export class FileStore implements IStore {
  private readonly root: string;

  /** `paper` → `.data/paper/…`; legacy `live` file layout under `.data/live/…` (not used when live uses Supabase). */
  constructor(baseDir: string, subdir: 'live' | 'paper' = 'paper') {
    this.root = join(baseDir, subdir);
  }

  private async ensureDir(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
  }

  private positionsPath(): string {
    return join(this.root, 'positions.json');
  }

  private orderHistoryPath(): string {
    return join(this.root, 'order_history.json');
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

  async loadTradeById(id: string): Promise<TradeRecord | null> {
    const file = join(this.root, 'trades.jsonl');
    let lines: string[] = [];
    try {
      const raw = await readFile(file, 'utf8');
      lines = raw.trim() ? raw.trim().split('\n').filter(Boolean) : [];
    } catch {
      return null;
    }
    for (const line of lines) {
      try {
        const o = JSON.parse(line) as TradeRecord;
        if (o?.id === id) {
          return o;
        }
      } catch {
        /* skip */
      }
    }
    return null;
  }

  async upsertTrade(record: TradeRecord): Promise<void> {
    const file = join(this.root, 'trades.jsonl');
    await this.ensureDir(file);
    let lines: string[] = [];
    try {
      const raw = await readFile(file, 'utf8');
      lines = raw.trim() ? raw.trim().split('\n').filter(Boolean) : [];
    } catch {
      lines = [];
    }
    const byId = new Map<string, TradeRecord>();
    for (const line of lines) {
      try {
        const o = JSON.parse(line) as TradeRecord;
        if (typeof o?.id === 'string') {
          byId.set(o.id, o);
        }
      } catch {
        /* skip corrupt line */
      }
    }
    byId.set(record.id, record);
    const merged = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
    await writeFile(
      file,
      merged.length > 0 ? `${merged.map((r) => JSON.stringify(r)).join('\n')}\n` : '',
      'utf8',
    );
  }

  async loadOpenOrderHistoryIdForDeployment(
    deploymentId: string,
    symbol: string,
  ): Promise<string | null> {
    const file = this.orderHistoryPath();
    let map: Record<string, OrderHistoryRecord> = {};
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        map = parsed as Record<string, OrderHistoryRecord>;
      }
    } catch {
      return null;
    }
    let best: OrderHistoryRecord | null = null;
    for (const rec of Object.values(map)) {
      if (
        rec.deploymentId !== deploymentId ||
        rec.symbol !== symbol ||
        rec.status !== 'open'
      ) {
        continue;
      }
      if (!best || rec.updatedAtMs > best.updatedAtMs) best = rec;
    }
    return best?.id ?? null;
  }

  async upsertOrderHistory(patch: OrderHistoryPatch): Promise<void> {
    const file = this.orderHistoryPath();
    let map: Record<string, OrderHistoryRecord> = {};
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        map = parsed as Record<string, OrderHistoryRecord>;
      }
    } catch {
      /* empty file */
    }
    const existing = map[patch.id] ?? null;
    const merged = mergeOrderHistory(existing, patch);
    map[patch.id] = merged;
    await this.ensureDir(file);
    await writeFile(file, JSON.stringify(map, null, 2), 'utf8');
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

  async loadPositionById(id: string): Promise<PositionRecord | null> {
    const rows = await this.readPositions();
    return rows.find((p) => p.id === id) ?? null;
  }

  async saveLog(record: LogRecord): Promise<void> {
    const file = join(this.root, 'logs', 'app.jsonl');
    await this.ensureDir(file);
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }
}
