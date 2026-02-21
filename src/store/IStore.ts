import type { Candle, TradeEntry, AggregatedTrade, PerformanceStats } from '../types/index.js';

export interface IStore {
  recordTrade(entry: TradeEntry): void;
  getTrades(): readonly TradeEntry[];
  saveResults(results: readonly AggregatedTrade[]): Promise<void>;
  saveStats(stats: PerformanceStats): Promise<void>;
  loadMarketData(label: string): Candle[] | null;
  saveMarketData(label: string, data: readonly Candle[]): Promise<void>;
}
