import type { CategoryV5 } from 'bybit-api';
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
    const { instrument, side, qty, price, roundTripId, deploymentId } = input;
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
    const barUnix = last[last.length - 1]!.dateUnix;
    const tsMs = barUnix < 1e12 ? barUnix * 1000 : barUnix;
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
      venueEntryOrderId: 'backtest',
      entryAtMs: tsMs,
      entryFee: fee,
      entryTimestampMs: tsMs,
      raw: { mode: 'backtest', category: this.category },
    });
    this.logger.info('TestBroker fill', { symbol: instrument.symbol, side, qty: q, refPrice, fee });
  }

  async closePosition(symbol: string, roundTripId: string, qty?: number, price?: number): Promise<void> {
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

    const barUnix = last[last.length - 1]!.dateUnix;
    const tsMs = barUnix < 1e12 ? barUnix * 1000 : barUnix;
    const now = Date.now();
    await this.store.upsertOrderHistory({
      id: roundTripId,
      updatedAtMs: now,
      status: 'closed',
      venueExitOrderId: 'backtest',
      exitAtMs: tsMs,
      exitQty: rounded,
      exitPrice: refPrice,
      exitFee: fee,
      exitTimestampMs: tsMs,
      raw: { mode: 'backtest', reduceOnly: true },
    });
    this.logger.info('TestBroker position closed', { symbol, side: closeSide, qty: rounded, refPrice, fee });
  }

  async updateStopLoss(
    symbol: string,
    stopLoss: number,
    roundTripId: string,
    deploymentId?: string,
  ): Promise<void> {
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
    await this.store.upsertOrderHistory({
      id: roundTripId,
      updatedAtMs: Date.now(),
      stopLoss: sl,
      ...(deploymentId !== undefined
        ? { deploymentId, symbol, status: 'open' as const }
        : {}),
    });
    this.logger.info('TestBroker updateStopLoss (no venue API)', { symbol, stopLoss: sl });
  }
}
