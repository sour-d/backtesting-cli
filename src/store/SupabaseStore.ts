import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Candle,
  LogRecord,
  OrderHistoryPatch,
  OrderHistoryRecord,
  OrderHistoryStatus,
  TradeRecord,
} from '../core/types.js';
import type { DeploymentState } from '../deployment/types.js';
import type { PositionRecord } from '../position/types.js';
import type { IStore, WarmupBarRow } from './IStore.js';
import { candleDatePartsIST } from './candleTime.js';
import { mergeOrderHistory } from './orderHistoryMerge.js';

function mapOrderHistoryRow(row: Record<string, unknown>): OrderHistoryRecord {
  const side = row.entry_side;
  return {
    id: String(row.id),
    deploymentId: String(row.deployment_id),
    symbol: String(row.symbol),
    status: row.status === 'closed' ? 'closed' : 'open',
    updatedAtMs: Number(row.updated_at_ms),
    entrySide: side === 'Sell' || side === 'Buy' ? side : undefined,
    entryQty: row.entry_qty != null && row.entry_qty !== '' ? Number(row.entry_qty) : undefined,
    entryPrice: row.entry_price != null && row.entry_price !== '' ? Number(row.entry_price) : null,
    entryOrderType: row.entry_order_type != null ? String(row.entry_order_type) : undefined,
    venueEntryOrderId: row.venue_entry_order_id != null ? String(row.venue_entry_order_id) : null,
    entryAtMs: row.entry_at_ms != null ? Number(row.entry_at_ms) : null,
    entryFee: row.entry_fee != null && row.entry_fee !== '' ? Number(row.entry_fee) : null,
    entryTimestampMs: row.entry_timestamp_ms != null ? Number(row.entry_timestamp_ms) : null,
    stopLoss: row.stop_loss != null && row.stop_loss !== '' ? Number(row.stop_loss) : null,
    venueExitOrderId: row.venue_exit_order_id != null ? String(row.venue_exit_order_id) : null,
    exitAtMs: row.exit_at_ms != null ? Number(row.exit_at_ms) : null,
    exitQty: row.exit_qty != null && row.exit_qty !== '' ? Number(row.exit_qty) : null,
    exitPrice: row.exit_price != null && row.exit_price !== '' ? Number(row.exit_price) : null,
    exitFee: row.exit_fee != null && row.exit_fee !== '' ? Number(row.exit_fee) : null,
    exitTimestampMs: row.exit_timestamp_ms != null ? Number(row.exit_timestamp_ms) : null,
    raw: row.raw != null && typeof row.raw === 'object' ? (row.raw as Record<string, unknown>) : null,
  };
}

function orderHistoryToRow(rec: OrderHistoryRecord): Record<string, unknown> {
  return {
    id: rec.id,
    deployment_id: rec.deploymentId,
    symbol: rec.symbol,
    status: rec.status,
    entry_side: rec.entrySide ?? null,
    entry_qty: rec.entryQty ?? null,
    entry_price: rec.entryPrice ?? null,
    entry_order_type: rec.entryOrderType ?? null,
    venue_entry_order_id: rec.venueEntryOrderId ?? null,
    entry_at_ms: rec.entryAtMs ?? null,
    entry_fee: rec.entryFee ?? null,
    entry_timestamp_ms: rec.entryTimestampMs ?? null,
    stop_loss: rec.stopLoss ?? null,
    venue_exit_order_id: rec.venueExitOrderId ?? null,
    exit_at_ms: rec.exitAtMs ?? null,
    exit_qty: rec.exitQty ?? null,
    exit_price: rec.exitPrice ?? null,
    exit_fee: rec.exitFee ?? null,
    exit_timestamp_ms: rec.exitTimestampMs ?? null,
    updated_at_ms: rec.updatedAtMs,
    raw: rec.raw ?? null,
  };
}

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
    const { date, time } = candleDatePartsIST(candle.dateUnix);
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
    if (bars.length === 0) return;
    /** Batched upserts — one row per candle was N sequential HTTP calls and dominated warmup time. */
    const BATCH = 150;
    for (let i = 0; i < bars.length; i += BATCH) {
      const slice = bars.slice(i, i + BATCH);
      const rows = slice.map(({ candle, indicators }) => {
        const { date, time } = candleDatePartsIST(candle.dateUnix);
        return {
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
        };
      });
      const { error } = await this.client.from('candles').upsert(rows, {
        onConflict: 'symbol,interval,date_unix',
      });
      if (error) throw new Error(`storeWarmupData: ${error.message}`);
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

  /** `live_trades` removed from schema; trade history will live in `order_history` when implemented. */
  async saveTrade(_record: TradeRecord): Promise<void> {
    /* no-op for Supabase */
  }

  async loadOpenOrderHistoryIdForDeployment(
    deploymentId: string,
    symbol: string,
  ): Promise<string | null> {
    const { data, error } = await this.client
      .from('order_history')
      .select('id')
      .eq('deployment_id', deploymentId)
      .eq('symbol', symbol)
      .eq('status', 'open')
      .order('updated_at_ms', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`loadOpenOrderHistoryIdForDeployment: ${error.message}`);
    if (!data || typeof (data as { id?: unknown }).id !== 'string') return null;
    return (data as { id: string }).id;
  }

  async upsertOrderHistory(patch: OrderHistoryPatch): Promise<void> {
    const { data } = await this.client.from('order_history').select('*').eq('id', patch.id).maybeSingle();
    const existing = data ? mapOrderHistoryRow(data as Record<string, unknown>) : null;
    const merged = mergeOrderHistory(existing, patch);
    const { error } = await this.client
      .from('order_history')
      .upsert(orderHistoryToRow(merged), { onConflict: 'id' });
    if (error) throw new Error(`upsertOrderHistory: ${error.message}`);
  }

  async listOrderHistory(filters?: {
    symbol?: string;
    status?: OrderHistoryStatus;
  }): Promise<OrderHistoryRecord[]> {
    let q = this.client.from('order_history').select('*');
    if (filters?.symbol) q = q.eq('symbol', filters.symbol);
    if (filters?.status) q = q.eq('status', filters.status);
    const { data, error } = await q
      .order('entry_timestamp_ms', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });
    if (error) throw new Error(`listOrderHistory: ${error.message}`);
    return (data ?? []).map((row) => mapOrderHistoryRow(row as Record<string, unknown>));
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
