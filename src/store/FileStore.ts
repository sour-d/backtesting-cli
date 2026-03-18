import fs from 'node:fs';
import path from 'node:path';
import type { Candle, TradeEntry, AggregatedTrade, PerformanceStats, Position } from '../types/index.js';
import type { Deployment, StoredTrade } from '../types/deployment.js';
import type {
  IStore,
  LiveEvent,
  LogEntry,
  TradeQueryFilters,
  DeploymentQueryFilters,
  CandleQueryFilters,
  LogQueryFilters,
  PositionWithDeployment,
} from './IStore.js';

export class FileStore implements IStore {
  private readonly baseDir: string;
  private readonly trades: TradeEntry[] = [];

  constructor(baseDir = '.data') {
    this.baseDir = baseDir;
    this.ensureDirs();
  }

  // --- Trade recording (backtest in-memory) ---

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

  // --- Market data ---

  loadMarketData(label: string): Candle[] | null {
    const filePath = path.join(this.baseDir, 'market', `${label}.json`);
    return this.readJSON<Candle[]>(filePath);
  }

  async saveMarketData(label: string, data: readonly Candle[]): Promise<void> {
    const filePath = path.join(this.baseDir, 'market', `${label}.json`);
    this.writeJSON(filePath, data);
  }

  // --- Deployment persistence (file-based for live) ---

  async saveDeployment(deployment: Deployment): Promise<void> {
    const all = this.loadAllDeployments();
    all[deployment.id] = deployment;
    this.writeJSON(this.deploymentsPath(), all);
  }

  async updateDeployment(id: string, patch: Partial<Deployment>): Promise<void> {
    const all = this.loadAllDeployments();
    if (all[id]) {
      all[id] = { ...all[id], ...patch } as Deployment;
      this.writeJSON(this.deploymentsPath(), all);
    }
  }

  async loadActiveDeployments(): Promise<Deployment[]> {
    const all = this.loadAllDeployments();
    return Object.values(all).filter(
      (d) => d.status === 'active' || d.status === 'paused',
    );
  }

  async removeDeployment(id: string): Promise<void> {
    const all = this.loadAllDeployments();
    delete all[id];
    this.writeJSON(this.deploymentsPath(), all);
  }

  // --- Position recovery (file-based for live) ---

  async savePosition(deploymentId: string, position: Position): Promise<void> {
    const all = this.loadAllPositions();
    all[deploymentId] = position;
    this.writeJSON(this.positionsPath(), all);
  }

  async loadPosition(deploymentId: string): Promise<Position | null> {
    const all = this.loadAllPositions();
    return all[deploymentId] ?? null;
  }

  async removePosition(deploymentId: string): Promise<void> {
    const all = this.loadAllPositions();
    delete all[deploymentId];
    this.writeJSON(this.positionsPath(), all);
  }

  // --- Completed trade storage (file-based for live) ---

  async saveTrade(trade: StoredTrade): Promise<void> {
    const all = this.loadStoredTrades();
    all.push(trade);
    this.writeJSON(this.storedTradesPath(), all);
  }

  async loadTrades(deploymentId: string): Promise<StoredTrade[]> {
    const all = this.loadStoredTrades();
    return all.filter((t) => t.deploymentId === deploymentId);
  }

  // --- Live candle buffering (append to file) ---

  async saveCandles(symbol: string, interval: string, candles: readonly Candle[]): Promise<void> {
    const label = `${symbol}_${interval}`;
    const existing = this.loadMarketData(label) ?? [];
    const seen = new Set(existing.map((c) => c.dateUnix));
    const newCandles = candles.filter((c) => !seen.has(c.dateUnix));
    if (newCandles.length === 0) return;
    existing.push(...newCandles);
    existing.sort((a, b) => a.dateUnix - b.dateUnix);
    await this.saveMarketData(label, existing);
  }

  // --- Application log persistence (no-op for file mode) ---

  async saveLogBatch(_entries: readonly LogEntry[]): Promise<void> {}

  async saveLiveEvent(_event: LiveEvent): Promise<void> {}

  // --- Dashboard query methods (no-op for file mode) ---

  async queryTrades(_filters: TradeQueryFilters): Promise<StoredTrade[]> { return []; }
  async queryDeployments(_filters: DeploymentQueryFilters): Promise<Deployment[]> { return []; }
  async queryAllPositions(): Promise<PositionWithDeployment[]> { return []; }
  async queryCandles(_filters: CandleQueryFilters): Promise<Candle[]> { return []; }
  async queryLogs(_filters: LogQueryFilters): Promise<LogEntry[]> { return []; }

  // --- Cleanup ---

  cleanLiveData(): void {
    const dirs = ['live', 'market'];
    for (const dir of dirs) {
      const dirPath = path.join(this.baseDir, dir);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true });
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
  }

  // --- Private helpers ---

  private deploymentsPath(): string {
    return path.join(this.baseDir, 'live', 'deployments.json');
  }

  private positionsPath(): string {
    return path.join(this.baseDir, 'live', 'positions.json');
  }

  private storedTradesPath(): string {
    return path.join(this.baseDir, 'live', 'trades.json');
  }

  private loadAllDeployments(): Record<string, Deployment> {
    return this.readJSON<Record<string, Deployment>>(this.deploymentsPath()) ?? {};
  }

  private loadAllPositions(): Record<string, Position> {
    return this.readJSON<Record<string, Position>>(this.positionsPath()) ?? {};
  }

  private loadStoredTrades(): StoredTrade[] {
    return this.readJSON<StoredTrade[]>(this.storedTradesPath()) ?? [];
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
    const dirs = ['market', 'technical', 'results', 'transformedResult', 'resultsStats', 'live'];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(this.baseDir, dir), { recursive: true });
    }
  }
}
