import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Candle, LogRecord, OrderRecord, TradeRecord } from '../core/types.js';
import type { DeploymentState } from '../deployment/types.js';
import type { PositionRecord } from '../position/types.js';
import type { IStore, WarmupBarRow } from './IStore.js';

function mapPositionRow(row: Record<string, unknown>): PositionRecord {
  return {
    id: String(row.id),
    deploymentId: String(row.deployment_id),
    symbol: String(row.symbol),
    side: row.side === 'Sell' ? 'Sell' : 'Buy',
    qty: Number(row.qty),
    avgEntryPrice:
      row.avg_entry_price != null && row.avg_entry_price !== ''
        ? Number(row.avg_entry_price)
        : undefined,
    stopLoss:
      row.stop_loss != null && row.stop_loss !== '' ? Number(row.stop_loss) : null,
    openedAtMs: Number(row.opened_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function candleDateParts(dateUnix: number): { date: string; time: string } {
  const ms = dateUnix < 1e12 ? dateUnix * 1000 : dateUnix;
  const d = new Date(ms);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

export class SupabaseStore implements IStore {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async saveCandle(
    symbol: string,
    klineInterval: string,
    candle: Candle,
    indicators: Record<string, unknown>,
  ): Promise<void> {
    const { date, time } = candleDateParts(candle.dateUnix);
    const { error } = await this.client.from('candles').upsert(
      {
        symbol,
        interval: klineInterval,
        date_unix: candle.dateUnix,
        date,
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        technicals: indicators,
      },
      { onConflict: 'symbol,interval,date_unix' },
    );
    if (error) throw new Error(`saveCandle: ${error.message}`);
  }

  async truncateCandleTail(symbol: string, klineInterval: string, lineCount: number): Promise<void> {
    if (lineCount <= 0) return;
    const { data, error } = await this.client
      .from('candles')
      .select('date_unix')
      .eq('symbol', symbol)
      .eq('interval', klineInterval)
      .order('date_unix', { ascending: false })
      .limit(lineCount);
    if (error) throw new Error(`truncateCandleTail(select): ${error.message}`);
    if (!data?.length) return;
    const keys = data.map((r) => r.date_unix as number);
    const { error: delErr } = await this.client
      .from('candles')
      .delete()
      .eq('symbol', symbol)
      .eq('interval', klineInterval)
      .in('date_unix', keys);
    if (delErr) throw new Error(`truncateCandleTail(delete): ${delErr.message}`);
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
    const { data, error } = await this.client
      .from('candles')
      .select('date_unix, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('interval', klineInterval)
      .order('date_unix', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`loadRecentCandles: ${error.message}`);
    if (!data?.length) return [];
    return [...data]
      .reverse()
      .map((r) => ({
        dateUnix: Number(r.date_unix),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));
  }

  async saveTrade(record: TradeRecord): Promise<void> {
    const { error } = await this.client.from('live_trades').insert({
      id: record.id,
      symbol: record.symbol,
      side: record.side,
      qty: record.qty,
      price: record.price,
      fee: record.fee,
      timestamp_ms: record.timestamp,
      kind: record.kind,
    });
    if (error) throw new Error(`saveTrade: ${error.message}`);
  }

  async saveOrder(record: OrderRecord): Promise<void> {
    const { error } = await this.client.from('live_orders').insert({
      id: record.id,
      symbol: record.symbol,
      side: record.side,
      qty: record.qty,
      price: record.price ?? null,
      order_type: record.orderType,
      status: record.status,
      created_at_ms: record.createdAt,
      raw: record.raw ?? null,
    });
    if (error) throw new Error(`saveOrder: ${error.message}`);
  }

  async saveDeployment(state: DeploymentState): Promise<void> {
    const { error } = await this.client.from('deployments').upsert(
      {
        id: state.id,
        symbol: state.symbol,
        strategy_id: state.strategyId,
        capital: state.capital,
        kline_interval: state.klineInterval ?? null,
        created_at_ms: state.createdAt,
        status: state.status,
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error(`saveDeployment: ${error.message}`);
  }

  async loadDeployments(): Promise<DeploymentState[]> {
    const { data, error } = await this.client
      .from('deployments')
      .select('*')
      .order('created_at_ms', { ascending: true });
    if (error) throw new Error(`loadDeployments: ${error.message}`);
    if (!data?.length) return [];
    return data.map((row) => ({
      id: row.id as string,
      symbol: row.symbol as string,
      strategyId: row.strategy_id as string,
      capital: Number(row.capital),
      klineInterval: row.kline_interval != null ? String(row.kline_interval) : undefined,
      createdAt: Number(row.created_at_ms),
      status: row.status as 'active' | 'stopped',
    }));
  }

  async deleteDeployment(id: string): Promise<void> {
    const { error } = await this.client.from('deployments').delete().eq('id', id);
    if (error) throw new Error(`deleteDeployment: ${error.message}`);
  }

  async createPosition(record: PositionRecord): Promise<void> {
    const { error } = await this.client.from('positions').insert({
      id: record.id,
      deployment_id: record.deploymentId,
      symbol: record.symbol,
      side: record.side,
      qty: record.qty,
      avg_entry_price: record.avgEntryPrice ?? null,
      stop_loss: record.stopLoss,
      opened_at_ms: record.openedAtMs,
      updated_at_ms: record.updatedAtMs,
    });
    if (error) throw new Error(`createPosition: ${error.message}`);
  }

  async updatePositionStopLoss(id: string, stopLoss: number, updatedAtMs: number): Promise<void> {
    const { error } = await this.client
      .from('positions')
      .update({ stop_loss: stopLoss, updated_at_ms: updatedAtMs })
      .eq('id', id);
    if (error) throw new Error(`updatePositionStopLoss: ${error.message}`);
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
    const { error } = await this.client
      .from('positions')
      .update({
        qty: fields.qty,
        avg_entry_price: fields.avgEntryPrice ?? null,
        side: fields.side,
        updated_at_ms: fields.updatedAtMs,
      })
      .eq('id', id);
    if (error) throw new Error(`updatePositionOpenSnapshot: ${error.message}`);
  }

  async deletePosition(id: string): Promise<void> {
    const { error } = await this.client.from('positions').delete().eq('id', id);
    if (error) throw new Error(`deletePosition: ${error.message}`);
  }

  async loadPositionByDeploymentId(deploymentId: string): Promise<PositionRecord | null> {
    const { data, error } = await this.client
      .from('positions')
      .select('*')
      .eq('deployment_id', deploymentId)
      .maybeSingle();
    if (error) throw new Error(`loadPositionByDeploymentId: ${error.message}`);
    if (!data) return null;
    return mapPositionRow(data as Record<string, unknown>);
  }

  async saveLog(record: LogRecord): Promise<void> {
    const { error } = await this.client.from('logs').insert({
      session_id: 'live',
      level: record.level,
      component: 'quantlab',
      message: record.message,
      data: record.meta ?? null,
      timestamp: new Date(record.timestamp).toISOString(),
    });
    if (error) throw new Error(`saveLog: ${error.message}`);
  }
}
