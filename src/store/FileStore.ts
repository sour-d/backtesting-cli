import fs from 'node:fs';
import path from 'node:path';
import type { Candle, TradeEntry, AggregatedTrade, PerformanceStats } from '../types/index.js';
import type { IStore } from './IStore.js';

export class FileStore implements IStore {
  private readonly baseDir: string;
  private readonly trades: TradeEntry[] = [];

  constructor(baseDir = '.data') {
    this.baseDir = baseDir;
    this.ensureDirs();
  }

  recordTrade(entry: TradeEntry): void {
    this.trades.push(entry);
  }

  getTrades(): readonly TradeEntry[] {
    return this.trades;
  }

  async saveResults(results: readonly AggregatedTrade[]): Promise<void> {
    const filePath = path.join(this.baseDir, 'transformedResult', 't_result.json');
    this.writeJSON(filePath, results);
  }

  async saveStats(stats: PerformanceStats): Promise<void> {
    const filePath = path.join(this.baseDir, 'resultsStats', 'stats_result.json');
    this.writeJSON(filePath, stats);
  }

  loadMarketData(label: string): Candle[] | null {
    const filePath = path.join(this.baseDir, 'market', `${label}.json`);
    return this.readJSON<Candle[]>(filePath);
  }

  async saveMarketData(label: string, data: readonly Candle[]): Promise<void> {
    const filePath = path.join(this.baseDir, 'market', `${label}.json`);
    this.writeJSON(filePath, data);
  }

  private readJSON<T>(filePath: string): T | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  private writeJSON(filePath: string, data: unknown): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private ensureDirs(): void {
    const dirs = ['market', 'technical', 'results', 'transformedResult', 'resultsStats'];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(this.baseDir, dir), { recursive: true });
    }
  }
}
