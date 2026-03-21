import { RestClientV5 } from 'bybit-api';
import type { CategoryV5 } from 'bybit-api';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { IPositionBook } from '../position/IPositionBook.js';
import type { IBroker, PlaceOrderInput } from './IBroker.js';

export interface LiveBrokerOptions {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly category: CategoryV5;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly testnet: boolean;
  readonly demoTrading: boolean;
  readonly feeRate: number;
  readonly reconcileIntervalMs: number;
  readonly getInstrument: (symbol: string) => Instrument | undefined;
  readonly getPositionBook: () => IPositionBook;
}

/**
 * Live execution against Bybit V5 — places orders and periodically reconciles positions into Instrument state.
 */
export class LiveBroker implements IBroker {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly category: CategoryV5;
  private readonly rest: RestClientV5;
  private readonly feeRate: number;
  private readonly getInstrument: (symbol: string) => Instrument | undefined;
  private readonly getPositionBook: () => IPositionBook;
  private readonly reconcileIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: LiveBrokerOptions) {
    this.logger = opts.logger;
    this.store = opts.store;
    this.category = opts.category;
    this.feeRate = opts.feeRate;
    this.getInstrument = opts.getInstrument;
    this.getPositionBook = opts.getPositionBook;
    this.reconcileIntervalMs = opts.reconcileIntervalMs;
    this.rest = new RestClientV5({
      key: opts.apiKey,
      secret: opts.apiSecret,
      testnet: opts.testnet,
      demoTrading: opts.demoTrading,
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.reconcileAll();
    }, this.reconcileIntervalMs);
    this.logger.info('LiveBroker reconciliation worker started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger.info('LiveBroker reconciliation worker stopped');
  }

  async placeOrder(input: PlaceOrderInput): Promise<void> {
    const { instrument, side, qty, price, roundTripId, deploymentId } = input;
    const q = instrument.roundQty(qty);
    const last = instrument.getCandles(1);
    const lastClose = last[last.length - 1]?.close;
    const refPrice = price ?? lastClose;
    if (refPrice === undefined || refPrice <= 0) {
      this.logger.warn('Order rejected: no reference price', { symbol: instrument.symbol });
      return;
    }
    if (!instrument.canOpenPosition(q, refPrice)) {
      this.logger.warn('Order rejected by instrument constraints', { symbol: instrument.symbol, qty: q });
      return;
    }

    const orderType = price !== undefined ? 'Limit' : 'Market';
    const res = await this.rest.submitOrder({
      category: this.category,
      symbol: instrument.symbol,
      side,
      orderType,
      qty: String(q),
      price: price !== undefined ? String(instrument.roundPrice(price)) : undefined,
    });

    const orderId = res.result?.orderId ?? 'unknown';
    const notional = Math.abs(q * refPrice);
    const entryFee = notional * this.feeRate;
    const now = Date.now();
    await this.store.upsertOrderHistory({
      id: roundTripId,
      deploymentId,
      symbol: instrument.symbol,
      status: 'open',
      updatedAtMs: now,
      entrySide: side,
      entryQty: q,
      entryPrice: price ?? refPrice,
      entryOrderType: orderType,
      venueEntryOrderId: orderId,
      entryAtMs: now,
      entryFee,
      entryTimestampMs: now,
      raw: res as unknown as Record<string, unknown>,
    });

    await this.syncPositionFromExchange(instrument.symbol);
    this.logger.info('Order submitted', { symbol: instrument.symbol, side, qty: q, orderType, orderId });
  }

  async closePosition(symbol: string, roundTripId: string, qty?: number, price?: number): Promise<void> {
    const instrument = this.getInstrument(symbol);
    if (!instrument) {
      this.logger.warn('closePosition: unknown symbol', { symbol });
      return;
    }
    const book = this.getPositionBook();
    const closeSide = book.getCloseOrderSide(symbol);
    if (!closeSide) return;

    const posAbs = Math.abs(book.getSnapshot(symbol).currentPositionQty);
    const requested =
      qty !== undefined && qty > 0
        ? Math.min(instrument.roundQty(qty), posAbs)
        : posAbs;
    const qClose = instrument.roundQty(requested);
    if (qClose <= 0) return;

    /** Live path: still market close; optional `price` is logged as strategy hint only. */
    const res = await this.rest.submitOrder({
      category: this.category,
      symbol,
      side: closeSide,
      orderType: 'Market',
      qty: String(qClose),
      reduceOnly: true,
    });
    await this.syncPositionFromExchange(symbol);
    const last = instrument.getCandles(1);
    const lastClose = last[last.length - 1]?.close;
    const exitPx = price ?? lastClose ?? 0;
    const exitFee = exitPx > 0 ? Math.abs(qClose * exitPx) * this.feeRate : 0;
    const exitOid = res.result?.orderId ?? null;
    const now = Date.now();
    await this.store.upsertOrderHistory({
      id: roundTripId,
      updatedAtMs: now,
      status: 'closed',
      venueExitOrderId: exitOid,
      exitAtMs: now,
      exitQty: qClose,
      exitPrice: exitPx > 0 ? exitPx : null,
      exitFee,
      exitTimestampMs: now,
      raw: res as unknown as Record<string, unknown>,
    });
    this.logger.info('Position close requested', {
      symbol,
      side: closeSide,
      qty: qClose,
      strategyPrice: price,
    });
  }

  async updateStopLoss(symbol: string, stopLoss: number, roundTripId: string): Promise<void> {
    if (this.category === 'spot' || this.category === 'option') {
      this.logger.warn('updateStopLoss: not supported for category', { category: this.category, symbol });
      return;
    }
    const instrument = this.getInstrument(symbol);
    if (!instrument) {
      this.logger.warn('updateStopLoss: unknown symbol', { symbol });
      return;
    }
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      this.logger.warn('updateStopLoss: invalid stopLoss', { symbol, stopLoss });
      return;
    }
    if (Math.abs(this.getPositionBook().getSnapshot(symbol).currentPositionQty) < 1e-12) {
      this.logger.debug('updateStopLoss ignored — flat', { symbol });
      return;
    }
    const sl = instrument.roundPrice(stopLoss);
    await this.rest.setTradingStop({
      category: this.category,
      symbol,
      stopLoss: String(sl),
      positionIdx: 0,
      slTriggerBy: 'LastPrice',
    });
    const now = Date.now();
    await this.store.upsertOrderHistory({
      id: roundTripId,
      updatedAtMs: now,
      stopLoss: sl,
    });
    this.logger.info('Trading stop updated', { symbol, stopLoss: sl });
  }

  async syncPositionFromVenue(symbol: string): Promise<void> {
    await this.syncPositionFromExchange(symbol);
  }

  private async reconcileAll(): Promise<void> {
    try {
      const res = await this.rest.getPositionInfo({
        category: this.category,
        limit: 200,
      });
      const list = res.result?.list ?? [];
      for (const p of list) {
        const sym = p.symbol;
        const inst = this.getInstrument(sym);
        if (!inst) continue;
        const side = String(p.side ?? '');
        const sizeAbs = Number(p.size ?? 0);
        const avg = Number(p.avgPrice ?? 0);
        const upnl = Number(p.unrealisedPnl ?? 0);
        this.getPositionBook().setPositionSnapshot(sym, side, sizeAbs, avg, upnl);
      }
    } catch (e) {
      this.logger.error('Reconciliation failed', { message: String(e) });
    }
  }

  private async syncPositionFromExchange(symbol: string): Promise<void> {
    const res = await this.rest.getPositionInfo({
      category: this.category,
      symbol,
    });
    const p = res.result?.list?.[0];
    if (!p) return;
    const side = String(p.side ?? '');
    const sizeAbs = Number(p.size ?? 0);
    const avg = Number(p.avgPrice ?? 0);
    const upnl = Number(p.unrealisedPnl ?? 0);
    this.getPositionBook().setPositionSnapshot(symbol, side, sizeAbs, avg, upnl);

    const fillFee = Math.abs(sizeAbs) * avg * this.feeRate;
    if (fillFee > 0) {
      this.logger.debug('Estimated fee accrual', { symbol, fillFee });
    }
  }
}
