import { randomUUID } from 'node:crypto';
import type { CategoryV5 } from 'bybit-api';
import type { OrderRecord } from '../core/types.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IPositionBook } from '../position/IPositionBook.js';
import type { IStore } from '../store/IStore.js';
import type { IBroker, PlaceOrderInput } from './IBroker.js';

export interface TestBrokerOptions {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly category: CategoryV5;
  readonly feeRate: number;
  readonly getInstrument: (symbol: string) => Instrument | undefined;
  readonly getPositionBook: () => IPositionBook;
}

/**
 * Deterministic fills for backtest — updates {@link IPositionBook} (PositionManager) on fills.
 */
export class TestBroker implements IBroker {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly category: CategoryV5;
  private readonly feeRate: number;
  private readonly getInstrument: (symbol: string) => Instrument | undefined;
  private readonly getPositionBook: () => IPositionBook;

  constructor(opts: TestBrokerOptions) {
    this.logger = opts.logger;
    this.store = opts.store;
    this.category = opts.category;
    this.feeRate = opts.feeRate;
    this.getInstrument = opts.getInstrument;
    this.getPositionBook = opts.getPositionBook;
  }

  start(): void {
    /* no timers */
  }

  stop(): void {
    /* no timers */
  }

  async placeOrder(input: PlaceOrderInput): Promise<void> {
    const { instrument, side, qty, price } = input;
    const q = instrument.roundQty(qty);
    const last = instrument.getCandles(1);
    if (last.length === 0) {
      this.logger.warn('TestBroker: order rejected — no candles on instrument', { symbol: instrument.symbol });
      return;
    }
    const lastClose = last[last.length - 1]?.close;
    const refPrice = price ?? lastClose;
    if (refPrice === undefined || refPrice <= 0) {
      this.logger.warn('TestBroker: order rejected — no reference price', { symbol: instrument.symbol });
      return;
    }
    if (!instrument.canOpenPosition(q, refPrice)) {
      this.logger.warn('TestBroker: order rejected by instrument constraints', { symbol: instrument.symbol, qty: q });
      return;
    }

    const fee = Math.abs(q * refPrice) * this.feeRate;
    this.getPositionBook().applyEntry(instrument.symbol, side, q, refPrice, fee);

    const orderType = price !== undefined ? 'Limit' : 'Market';
    const rec: OrderRecord = {
      id: randomUUID(),
      symbol: instrument.symbol,
      side,
      qty: String(q),
      price: price !== undefined ? String(price) : undefined,
      orderType,
      status: 'filled',
      createdAt: last[last.length - 1]?.dateUnix ?? Date.now(),
      raw: { mode: 'backtest', category: this.category },
    };
    await this.store.saveOrder(rec);
    this.logger.info('TestBroker fill', { symbol: instrument.symbol, side, qty: q, refPrice, fee });
  }

  async closePosition(symbol: string, qty?: number, price?: number): Promise<void> {
    const instrument = this.getInstrument(symbol);
    if (!instrument) {
      this.logger.warn('TestBroker.closePosition: unknown symbol', { symbol });
      return;
    }
    const book = this.getPositionBook();
    const closeSide = book.getCloseOrderSide(symbol);
    if (!closeSide) return;

    const last = instrument.getCandles(1);
    if (last.length === 0) {
      this.logger.warn('TestBroker: close rejected — no candles', { symbol });
      return;
    }
    const lastClose = last[last.length - 1]?.close;
    const refPrice = price ?? lastClose;
    if (refPrice === undefined || refPrice <= 0) {
      this.logger.warn('TestBroker: close rejected — no reference price', { symbol });
      return;
    }

    const posAbs = Math.abs(book.getSnapshot(symbol).currentPositionQty);
    const requested =
      qty !== undefined && qty > 0
        ? Math.min(instrument.roundQty(qty), posAbs)
        : posAbs;
    const rounded = instrument.roundQty(requested);
    if (rounded <= 0 || rounded > posAbs + 1e-12) return;
    const fee = Math.abs(rounded * refPrice) * this.feeRate;
    book.applyEntry(symbol, closeSide, rounded, refPrice, fee);

    const rec: OrderRecord = {
      id: randomUUID(),
      symbol,
      side: closeSide,
      qty: String(rounded),
      orderType: 'Market',
      status: 'filled',
      createdAt: last[last.length - 1]?.dateUnix ?? Date.now(),
      raw: { mode: 'backtest', reduceOnly: true },
    };
    await this.store.saveOrder(rec);
    this.logger.info('TestBroker position closed', { symbol, side: closeSide, qty: rounded, refPrice, fee });
  }

  async updateStopLoss(symbol: string, stopLoss: number): Promise<void> {
    const instrument = this.getInstrument(symbol);
    if (!instrument) {
      this.logger.warn('TestBroker.updateStopLoss: unknown symbol', { symbol });
      return;
    }
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      this.logger.warn('TestBroker.updateStopLoss: invalid stopLoss', { symbol, stopLoss });
      return;
    }
    const sl = instrument.roundPrice(stopLoss);
    this.logger.info('TestBroker updateStopLoss (no venue API)', { symbol, stopLoss: sl });
  }
}
