import { randomUUID } from 'node:crypto';
import type { CategoryV5 } from 'bybit-api';
import type { OrderRecord } from '../core/types.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { IBroker, PlaceOrderInput } from './IBroker.js';

export interface TestBrokerOptions {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly category: CategoryV5;
  readonly feeRate: number;
  readonly getInstrument: (symbol: string) => Instrument | undefined;
}

/**
 * Deterministic fills for backtest — updates {@link Instrument} via {@link Instrument.applyEntry}.
 */
export class TestBroker implements IBroker {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly category: CategoryV5;
  private readonly feeRate: number;
  private readonly getInstrument: (symbol: string) => Instrument | undefined;

  constructor(opts: TestBrokerOptions) {
    this.logger = opts.logger;
    this.store = opts.store;
    this.category = opts.category;
    this.feeRate = opts.feeRate;
    this.getInstrument = opts.getInstrument;
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
    instrument.applyEntry(side, q, refPrice, fee);

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

  async closePosition(symbol: string): Promise<void> {
    const instrument = this.getInstrument(symbol);
    if (!instrument) {
      this.logger.warn('TestBroker.closePosition: unknown symbol', { symbol });
      return;
    }
    const closeSide = instrument.getCloseOrderSide();
    if (!closeSide) return;

    const last = instrument.getCandles(1);
    if (last.length === 0) {
      this.logger.warn('TestBroker: close rejected — no candles', { symbol });
      return;
    }
    const refPrice = last[last.length - 1]?.close;
    if (refPrice === undefined || refPrice <= 0) {
      this.logger.warn('TestBroker: close rejected — no reference price', { symbol });
      return;
    }

    const qty = Math.abs(instrument.currentPositionQty);
    const rounded = instrument.roundQty(qty);
    const fee = Math.abs(rounded * refPrice) * this.feeRate;
    instrument.applyEntry(closeSide, rounded, refPrice, fee);

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
}
