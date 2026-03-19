/**
 * Live broker that places real orders on Bybit (linear perpetual).
 * Pattern and API usage aligned with ../practice/trading/backtesting exchange module.
 */
import { RestClientV5 } from 'bybit-api';
import type { Signal, Position, TradeEntry, Result, Candle } from '../types/index.js';
import { ok, err } from '../types/result.js';
import type { IBroker } from './IBroker.js';
import type { LiveEvent } from '../store/IStore.js';
import { calculateQuantity } from './riskManager.js';
import { safeErrorMessage } from '../utils/safeErrorMessage.js';
import type { ILogger } from '../logger/ILogger.js';

const CATEGORY = 'linear';
const POSITION_IDX_ONE_WAY = 0;

function roundQty(qty: number, step = 0.001): number {
  const s = Number(step);
  return Math.floor(qty / s) * s;
}

export interface BybitBrokerConfig {
  riskPercentage: number;
  maxAllocation: number;
  category?: 'linear' | 'spot' | 'inverse';
}

export class BybitBroker implements IBroker {
  private readonly client: RestClientV5;
  private readonly config: BybitBrokerConfig;
  private readonly logger: ILogger | null;
  private readonly capitalPool: Map<string, number> = new Map();
  private readonly symbolConfigs: Map<string, { riskPercentage: number; maxAllocation: number }> = new Map();

  /** Called when stop-loss exit fails (so caller can persist to live_events). Caller adds sessionId. */
  private readonly onLiveEvent?: (event: Omit<LiveEvent, 'sessionId'>) => void;

  constructor(opts: {
    apiKey?: string;
    apiSecret?: string;
    testnet?: boolean;
    demoTrading?: boolean;
    config: BybitBrokerConfig;
    logger?: ILogger;
    onLiveEvent?: (event: Omit<LiveEvent, 'sessionId'>) => void;
  }) {
    this.client = new RestClientV5({
      key: opts.apiKey,
      secret: opts.apiSecret,
      testnet: opts.testnet ?? false,
      demoTrading: opts.demoTrading ?? false,
    });
    this.config = opts.config;
    this.logger = opts.logger ?? null;
    this.onLiveEvent = opts.onLiveEvent;
  }

  allocateCapital(symbols: string[], totalCapital: number): void {
    const perSymbol = totalCapital / symbols.length;
    for (const symbol of symbols) {
      this.capitalPool.set(symbol, perSymbol);
    }
  }

  allocateCapitalForSymbol(symbol: string, amount: number): void {
    this.capitalPool.set(symbol, (this.capitalPool.get(symbol) ?? 0) + amount);
  }

  deallocateCapitalForSymbol(symbol: string): Result<number> {
    const pos = this.getPositionSync(symbol);
    if (pos) return err(`Cannot deallocate: open position in ${symbol}`);
    const remaining = this.capitalPool.get(symbol) ?? 0;
    this.capitalPool.delete(symbol);
    this.symbolConfigs.delete(symbol);
    return ok(remaining);
  }

  restorePosition(_symbol: string, _position: Position): void {
    // Live positions come from exchange; no local restore
  }

  setSymbolConfig(symbol: string, config: { riskPercentage: number; maxAllocation: number }): void {
    this.symbolConfigs.set(symbol, config);
  }

  placeOrder(symbol: string, signal: Signal & { action: 'BUY' | 'SELL' }, timestamp: number): Result<Position> | Promise<Result<Position>> {
    return this.placeOrderAsync(symbol, signal, timestamp);
  }

  private async placeOrderAsync(
    symbol: string,
    signal: Signal & { action: 'BUY' | 'SELL' },
    timestamp: number,
  ): Promise<Result<Position>> {
    const category = this.config.category ?? CATEGORY;
    const capital = this.getCapital(symbol);
    if (capital <= 0) return err('No capital available');

    const symConfig = this.symbolConfigs.get(symbol);
    const riskPercentage = symConfig?.riskPercentage ?? this.config.riskPercentage;
    const maxAllocation = symConfig?.maxAllocation ?? this.config.maxAllocation;

    const quantity = calculateQuantity({
      capital,
      riskPerStock: signal.risk,
      price: signal.price,
      riskPercentage,
      maxAllocation,
    });
    const qtyStr = roundQty(Math.max(0.001, quantity)).toFixed(3);

    this.logger?.info('Placing order (live)', {
      flow: 'broker_place_order',
      symbol,
      side: signal.action,
      price: signal.price,
      qty: qtyStr,
      stopLoss: String(signal.stopLoss),
      capital,
      riskPercentage: riskPercentage,
      maxAllocation: maxAllocation,
    });

    const orderRes = await this.client
      .submitOrder({
        category,
        symbol,
        side: signal.action === 'BUY' ? 'Buy' : 'Sell',
        orderType: 'Market',
        qty: qtyStr,
        stopLoss: signal.stopLoss.toString(),
        timeInForce: 'GTC',
      })
      .catch((e) => {
        const msg = safeErrorMessage(e);
        this.logger?.error('submitOrder failed', { symbol, error: msg });
        return { retCode: -1, retMsg: msg, result: null };
      });

    if (!orderRes || orderRes.retCode !== 0) {
      const msg = orderRes?.retMsg != null ? safeErrorMessage(orderRes.retMsg) : 'Order failed';
      this.logger?.error('Place order failed', {
        flow: 'broker_place_order_result',
        symbol,
        success: false,
        error: msg,
        retCode: orderRes?.retCode,
      });
      return err(msg);
    }

    this.logger?.info('Place order success', {
      flow: 'broker_place_order_result',
      symbol,
      success: true,
      side: signal.action,
      entryPrice: signal.price,
      quantity: qtyStr,
      stopLoss: String(signal.stopLoss),
    });

    const position: Position = {
      symbol,
      side: signal.action === 'BUY' ? 'Buy' : 'Sell',
      entryPrice: signal.price,
      quantity: Number(qtyStr),
      stopLoss: signal.stopLoss,
      entryTime: timestamp,
    };
    return ok(position);
  }

  exitPosition(symbol: string, exitPrice: number, timestamp: number): Result<TradeEntry> | Promise<Result<TradeEntry>> {
    return this.exitPositionAsync(symbol, exitPrice, timestamp);
  }

  private async exitPositionAsync(symbol: string, exitPrice: number, timestamp: number): Promise<Result<TradeEntry>> {
    const category = this.config.category ?? CATEGORY;
    const pos = await this.fetchPosition(symbol);
    if (!pos) return err(`No position in ${symbol}`);

    const closeSide = pos.side === 'Buy' ? 'Sell' : 'Buy';
    this.logger?.info('Exiting position (live)', {
      flow: 'broker_exit_request',
      symbol,
      side: closeSide,
      exitPrice,
      positionSide: pos.side,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
    });

    const res = await this.client
      .submitOrder({
        category,
        symbol,
        side: closeSide,
        orderType: 'Market',
        reduceOnly: true,
        qty: '0',
      })
      .catch((e) => {
        const msg = safeErrorMessage(e);
        this.logger?.error('exitPosition submitOrder failed', { symbol, error: msg });
        return { retCode: -1, retMsg: msg, result: null };
      });

    if (!res || res.retCode !== 0) {
      const msg = res?.retMsg != null ? safeErrorMessage(res.retMsg) : 'Exit failed';
      this.logger?.error('Exit position failed', {
        flow: 'broker_exit_result',
        symbol,
        success: false,
        error: msg,
        retCode: res?.retCode,
      });
      return err(msg);
    }

    this.logger?.info('Exit position success', {
      flow: 'broker_exit_result',
      symbol,
      success: true,
      side: pos.side,
      exitPrice,
      quantity: pos.quantity,
    });

    const entry: TradeEntry = {
      timestamp,
      symbol,
      side: pos.side,
      price: exitPrice,
      quantity: pos.quantity,
      risk: 0,
      type: 'EXIT',
    };
    return ok(entry);
  }

  getPosition(symbol: string): Position | null | Promise<Position | null> {
    return this.fetchPosition(symbol);
  }

  private getPositionSync(symbol: string): Position | null {
    return null;
  }

  private async fetchPosition(symbol: string): Promise<Position | null> {
    const category = this.config.category ?? CATEGORY;
    const res = await this.client.getPositionInfo({ category, symbol }).catch(() => null);
    const list = res?.result?.list;
    if (!list?.length) return null;
    const p = list[0]!;
    const size = Number(p.size);
    if (size <= 0) return null;
    const stopLoss = p.stopLoss ? Number(p.stopLoss) : 0;
    return {
      symbol: p.symbol,
      side: p.side as 'Buy' | 'Sell',
      entryPrice: Number(p.avgPrice),
      quantity: size,
      stopLoss,
      entryTime: Number(p.createdTime ?? 0),
    };
  }

  checkStopLoss(symbol: string, candle: Candle): TradeEntry | null | Promise<TradeEntry | null> {
    return this.checkStopLossAsync(symbol, candle);
  }

  private async checkStopLossAsync(symbol: string, candle: Candle): Promise<TradeEntry | null> {
    const pos = await this.fetchPosition(symbol);
    if (!pos) return null;
    let triggered = false;
    if (pos.side === 'Buy' && candle.low <= pos.stopLoss) triggered = true;
    if (pos.side === 'Sell' && candle.high >= pos.stopLoss) triggered = true;
    if (!triggered) return null;
    const result = await this.exitPositionAsync(symbol, pos.stopLoss, candle.dateUnix);
    if (!result.ok) {
      this.logger?.error('Stop-loss exit failed', { symbol, error: safeErrorMessage(result.error) });
      this.onLiveEvent?.({
        eventType: 'stop_loss_exit_failed',
        symbol,
        message: result.error,
        payload: { stopLoss: pos.stopLoss, side: pos.side },
      });
      return null;
    }
    return { ...result.value, type: 'STOP_LOSS' as const };
  }

  getCapital(symbol: string): number {
    return this.capitalPool.get(symbol) ?? 0;
  }

  getTotalCapital(): number {
    let total = 0;
    for (const c of this.capitalPool.values()) total += c;
    return total;
  }

  getTotalEquity(_prices: ReadonlyMap<string, number>): number {
    return this.getTotalCapital();
  }

  getAllPositions(): ReadonlyMap<string, Position> {
    return new Map();
  }
}
