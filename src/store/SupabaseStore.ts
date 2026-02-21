import type { SupabaseClient } from '@supabase/supabase-js';
import type { Candle, TradeEntry, AggregatedTrade, PerformanceStats, Position } from '../types/index.js';
import type { Deployment, StoredTrade } from '../types/deployment.js';
import type { IStore, LogEntry } from './IStore.js';

export class SupabaseStore implements IStore {
  private readonly client: SupabaseClient;
  private readonly trades: TradeEntry[] = [];
  private candleBuffer: Map<string, Candle[]> = new Map();
  private readonly candleFlushThreshold: number;

  constructor(client: SupabaseClient, candleFlushThreshold = 10) {
    this.client = client;
    this.candleFlushThreshold = candleFlushThreshold;
  }

  // --- Trade recording (in-memory for current session) ---

  recordTrade(entry: TradeEntry): void {
    this.trades.push(entry);
  }

  getTrades(): readonly TradeEntry[] {
    return this.trades;
  }

  async saveResults(_results: readonly AggregatedTrade[]): Promise<void> {
    // Aggregated results are not persisted to DB -- recompute from trades
  }

  async saveStats(_stats: PerformanceStats): Promise<void> {
    // Stats are not persisted to DB -- compute on demand
  }

  // --- Market data ---

  loadMarketData(label: string): Candle[] | null {
    // For live mode, market data comes from the feed, not preloaded files
    return null;
  }

  async saveMarketData(_label: string, _data: readonly Candle[]): Promise<void> {
    // Not used in live mode
  }

  // --- Deployment persistence ---

  async saveDeployment(deployment: Deployment): Promise<void> {
    const { error } = await this.client.from('deployments').upsert({
      id: deployment.id,
      symbol: deployment.symbol,
      strategy_name: deployment.strategyName,
      capital: deployment.config.capital,
      risk_pct: deployment.config.riskPercentage,
      max_allocation: deployment.config.maxAllocation,
      fee_rate: deployment.config.feeRate,
      strategy_params: deployment.strategyParams,
      status: deployment.status,
      current_capital: deployment.currentCapital,
      created_at: new Date(deployment.createdAt).toISOString(),
    });
    if (error) throw new Error(`Failed to save deployment: ${error.message}`);
  }

  async updateDeployment(id: string, patch: Partial<Deployment>): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.currentCapital !== undefined) update.current_capital = patch.currentCapital;
    if (patch.config) {
      if (patch.config.capital !== undefined) update.capital = patch.config.capital;
      if (patch.config.riskPercentage !== undefined) update.risk_pct = patch.config.riskPercentage;
      if (patch.config.maxAllocation !== undefined) update.max_allocation = patch.config.maxAllocation;
      if (patch.config.feeRate !== undefined) update.fee_rate = patch.config.feeRate;
    }
    update.updated_at = new Date().toISOString();

    const { error } = await this.client.from('deployments').update(update).eq('id', id);
    if (error) throw new Error(`Failed to update deployment: ${error.message}`);
  }

  async loadActiveDeployments(): Promise<Deployment[]> {
    const { data, error } = await this.client
      .from('deployments')
      .select('*')
      .in('status', ['active', 'paused']);

    if (error) throw new Error(`Failed to load deployments: ${error.message}`);
    if (!data) return [];

    return data.map((row) => ({
      id: row.id as string,
      symbol: row.symbol as string,
      strategyName: row.strategy_name as string,
      config: {
        capital: row.capital as number,
        riskPercentage: row.risk_pct as number,
        maxAllocation: row.max_allocation as number,
        feeRate: row.fee_rate as number,
      },
      strategyParams: (row.strategy_params ?? {}) as Record<string, number>,
      status: row.status as Deployment['status'],
      currentCapital: row.current_capital as number,
      createdAt: new Date(row.created_at as string).getTime(),
    }));
  }

  async removeDeployment(id: string): Promise<void> {
    const { error } = await this.client.from('deployments').update({
      status: 'stopped',
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new Error(`Failed to remove deployment: ${error.message}`);
  }

  // --- Position recovery ---

  async savePosition(deploymentId: string, position: Position): Promise<void> {
    const { error } = await this.client.from('positions').upsert({
      deployment_id: deploymentId,
      symbol: position.symbol,
      side: position.side,
      entry_price: position.entryPrice,
      quantity: position.quantity,
      stop_loss: position.stopLoss,
      entry_time: new Date(position.entryTime).toISOString(),
    });
    if (error) throw new Error(`Failed to save position: ${error.message}`);
  }

  async loadPosition(deploymentId: string): Promise<Position | null> {
    const { data, error } = await this.client
      .from('positions')
      .select('*')
      .eq('deployment_id', deploymentId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load position: ${error.message}`);
    if (!data) return null;

    return {
      symbol: data.symbol as string,
      side: data.side as Position['side'],
      entryPrice: data.entry_price as number,
      quantity: data.quantity as number,
      stopLoss: data.stop_loss as number,
      entryTime: new Date(data.entry_time as string).getTime(),
    };
  }

  async removePosition(deploymentId: string): Promise<void> {
    const { error } = await this.client
      .from('positions')
      .delete()
      .eq('deployment_id', deploymentId);
    if (error) throw new Error(`Failed to remove position: ${error.message}`);
  }

  // --- Completed trade storage (slim, no running-state fields) ---

  async saveTrade(trade: StoredTrade): Promise<void> {
    const { error } = await this.client.from('trades').insert({
      id: trade.id,
      deployment_id: trade.deploymentId,
      symbol: trade.symbol,
      side: trade.side,
      entry_price: trade.entryPrice,
      exit_price: trade.exitPrice,
      quantity: trade.quantity,
      entry_time: new Date(trade.entryTime).toISOString(),
      exit_time: new Date(trade.exitTime).toISOString(),
      gross_pnl: trade.grossPnl,
      fee: trade.fee,
      net_pnl: trade.netPnl,
      risk: trade.risk,
      result: trade.result,
      exit_type: trade.exitType,
    });
    if (error) throw new Error(`Failed to save trade: ${error.message}`);
  }

  async loadTrades(deploymentId: string): Promise<StoredTrade[]> {
    const { data, error } = await this.client
      .from('trades')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('exit_time', { ascending: true });

    if (error) throw new Error(`Failed to load trades: ${error.message}`);
    if (!data) return [];

    return data.map((row) => ({
      id: row.id as string,
      deploymentId: row.deployment_id as string,
      symbol: row.symbol as string,
      side: row.side as StoredTrade['side'],
      entryPrice: row.entry_price as number,
      exitPrice: row.exit_price as number,
      quantity: row.quantity as number,
      entryTime: new Date(row.entry_time as string).getTime(),
      exitTime: new Date(row.exit_time as string).getTime(),
      grossPnl: row.gross_pnl as number,
      fee: row.fee as number,
      netPnl: row.net_pnl as number,
      risk: row.risk as number,
      result: row.result as StoredTrade['result'],
      exitType: row.exit_type as StoredTrade['exitType'],
    }));
  }

  // --- Live candle buffering (batch inserts) ---

  async saveCandles(symbol: string, interval: string, candles: readonly Candle[]): Promise<void> {
    const key = `${symbol}_${interval}`;
    let buffer = this.candleBuffer.get(key);
    if (!buffer) {
      buffer = [];
      this.candleBuffer.set(key, buffer);
    }

    buffer.push(...candles);

    if (buffer.length >= this.candleFlushThreshold) {
      await this.flushCandles(symbol, interval, buffer);
      this.candleBuffer.set(key, []);
    }
  }

  async flushAllCandles(): Promise<void> {
    for (const [key, buffer] of this.candleBuffer) {
      if (buffer.length === 0) continue;
      const [symbol, interval] = key.split('_');
      if (symbol && interval) {
        await this.flushCandles(symbol, interval, buffer);
      }
    }
    this.candleBuffer.clear();
  }

  private async flushCandles(symbol: string, interval: string, candles: Candle[]): Promise<void> {
    const rows = candles.map((c) => ({
      symbol,
      interval,
      date_unix: c.dateUnix,
      date: c.date,
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    const { error } = await this.client
      .from('candles')
      .upsert(rows, { onConflict: 'symbol,interval,date_unix' });
    if (error) throw new Error(`Failed to flush candles: ${error.message}`);
  }

  // --- Application log persistence ---

  async saveLogBatch(entries: readonly LogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const rows = entries.map((e) => ({
      session_id: e.sessionId,
      timestamp: e.timestamp,
      level: e.level,
      component: e.component,
      message: e.message,
      data: e.data ?? null,
      context: e.context ?? null,
    }));

    const { error } = await this.client.from('logs').insert(rows);
    if (error) throw new Error(`Failed to save log batch: ${error.message}`);
  }
}
