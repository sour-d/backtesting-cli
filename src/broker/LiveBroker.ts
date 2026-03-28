import { RestClientV5 } from 'bybit-api';
import type { CategoryV5 } from 'bybit-api';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { IPositionBook } from '../position/IPositionBook.js';
import type {
  IBroker,
  BrokerActionResult,
  PlaceOrderInput,
  SyncPositionFromVenueOptions,
} from './IBroker.js';

/** Requires present, numeric `retCode === 0`; otherwise throws (malformed = failure). */
function assertBybitOk(
  res: { retCode?: unknown; retMsg?: unknown },
  context: string,
): void {
  const raw = res.retCode;
  if (raw === undefined || raw === null) {
    throw new Error(`${context}: missing retCode`);
  }
  const code =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(String(raw).trim())
        : Number.NaN;
  if (!Number.isFinite(code)) {
    throw new Error(`${context}: invalid retCode (${String(raw)})`);
  }
  if (code !== 0) {
    const msg = res.retMsg;
    const detail =
      typeof msg === 'string' && msg.length > 0 ? msg : `retCode=${code}`;
    throw new Error(`${context}: ${detail}`);
  }
}

export interface LiveBrokerOptions {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly category: CategoryV5;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly testnet: boolean;
  readonly demoTrading: boolean;
  readonly feeRate: number;
  readonly getInstrument: (symbol: string) => Instrument | undefined;
  readonly getPositionBook: () => IPositionBook;
  /**
   * Minimum ms between throttled {@link syncPositionFromVenue} calls per symbol.
   * Direct post-order sync uses {@link syncPositionFromExchange} and ignores this.
   */
  readonly venueSyncMinIntervalMs?: number;
}

/**
 * Live execution against Bybit V5 — places orders; periodic venue sync is owned by {@link ReconciliationService}.
 */
export class LiveBroker implements IBroker {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly category: CategoryV5;
  private readonly rest: RestClientV5;
  private readonly feeRate: number;
  private readonly getInstrument: (symbol: string) => Instrument | undefined;
  private readonly getPositionBook: () => IPositionBook;
  private readonly venueSyncMinIntervalMs: number;
  private readonly lastVenueSyncAtMs = new Map<string, number>();

  constructor(opts: LiveBrokerOptions) {
    this.logger = opts.logger;
    this.store = opts.store;
    this.category = opts.category;
    this.feeRate = opts.feeRate;
    this.getInstrument = opts.getInstrument;
    this.getPositionBook = opts.getPositionBook;
    this.venueSyncMinIntervalMs = opts.venueSyncMinIntervalMs ?? 800;
    this.rest = new RestClientV5({
      key: opts.apiKey,
      secret: opts.apiSecret,
      testnet: opts.testnet,
      demoTrading: opts.demoTrading,
    });
  }

  start(): void {
    /* periodic reconcile: ReconciliationService */
  }

  stop(): void {
    /* periodic reconcile: ReconciliationService */
  }

  /** Configured default; exchange-specific fee API can be wired here later. */
  async getFeeRate(symbol: string): Promise<number> {
    void symbol;
    return this.feeRate;
  }

  /** After exchange confirms an order; failures are logged only — never flip {@link BrokerActionResult.success}. */
  private async syncPositionFromExchangeBestEffort(symbol: string): Promise<void> {
    try {
      await this.syncPositionFromExchange(symbol);
    } catch (e) {
      this.logger.warn('DEBUG:: syncPositionFromExchange best-effort failed after venue call', {
        symbol,
        message: String(e),
      });
    }
  }

  async placeOrder(input: PlaceOrderInput): Promise<BrokerActionResult> {
    const { instrument, side, qty, price, stopLoss, roundTripId, deploymentId } = input;
    const sym = instrument.symbol;
    const q = instrument.roundQty(qty);
    const last = instrument.getCandles(1);
    const lastClose = last[last.length - 1]?.close;
    const refPrice = price ?? lastClose;
    if (refPrice === undefined || refPrice <= 0) {
      this.logger.warn('Order rejected: no reference price', { symbol: sym });
      return { success: false, error: 'no reference price' };
    }
    if (!instrument.canOpenPosition(q, refPrice)) {
      this.logger.warn('Order rejected by instrument constraints', { symbol: sym, qty: q });
      return { success: false, error: 'instrument constraints rejected order' };
    }

    const orderType = price !== undefined ? 'Limit' : 'Market';
    const venueSlSupported = this.category !== 'spot' && this.category !== 'option';
    const slRounded =
      stopLoss !== undefined && Number.isFinite(stopLoss) && stopLoss > 0
        ? instrument.roundPrice(stopLoss)
        : undefined;

    try {
      const res = await this.rest.submitOrder({
        category: this.category,
        symbol: sym,
        side,
        orderType,
        qty: String(q),
        price: price !== undefined ? String(instrument.roundPrice(price)) : undefined,
        ...(venueSlSupported && slRounded !== undefined
          ? { stopLoss: String(slRounded), slTriggerBy: 'LastPrice' as const }
          : {}),
      });
      assertBybitOk(res, 'submitOrder');

      const orderId = String(res.result?.orderId ?? '').trim() || 'unknown';
      const notional = Math.abs(q * refPrice);
      const feeRate = await this.getFeeRate(sym);
      const entryFee = notional * feeRate;
      const now = Date.now();
      await this.store.upsertOrderHistory({
        id: roundTripId,
        deploymentId,
        symbol: sym,
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
        ...(slRounded !== undefined ? { stopLoss: slRounded } : {}),
        raw: res as unknown as Record<string, unknown>,
      });

      await this.syncPositionFromExchangeBestEffort(sym);
      this.logger.info('Order submitted', {
        symbol: sym,
        side,
        qty: q,
        orderType,
        orderId,
        stopLoss: slRounded,
        stopLossOnOrder: venueSlSupported && slRounded !== undefined,
      });
      return { success: true, orderId };
    } catch (e) {
      const msg = String(e);
      this.logger.warn('DEBUG:: placeOrder failed', { symbol: sym, message: msg });
      return { success: false, error: msg };
    }
  }

  async closePosition(
    symbol: string,
    roundTripId: string,
    qty?: number,
    price?: number,
  ): Promise<BrokerActionResult> {
    const instrument = this.getInstrument(symbol);
    if (!instrument) {
      this.logger.warn('closePosition: unknown symbol', { symbol });
      return { success: false, error: 'unknown symbol' };
    }
    const book = this.getPositionBook();
    const closeSide = book.getCloseOrderSide(symbol);
    if (!closeSide) {
      return { success: false, error: 'flat position' };
    }

    const posAbs = Math.abs(book.getSnapshot(symbol).currentPositionQty);
    const requested =
      qty !== undefined && qty > 0
        ? Math.min(instrument.roundQty(qty), posAbs)
        : posAbs;
    const qClose = instrument.roundQty(requested);
    if (qClose <= 0) {
      return { success: false, error: 'zero close qty' };
    }

    try {
      const res = await this.rest.submitOrder({
        category: this.category,
        symbol,
        side: closeSide,
        orderType: 'Market',
        qty: String(qClose),
        reduceOnly: true,
      });
      assertBybitOk(res, 'submitOrder(close)');

      const last = instrument.getCandles(1);
      const lastClose = last[last.length - 1]?.close;
      const exitPx = price ?? lastClose ?? 0;
      const feeRate = await this.getFeeRate(symbol);
      const exitFee = exitPx > 0 ? Math.abs(qClose * exitPx) * feeRate : 0;
      const exitOid = res.result?.orderId ?? null;
      const orderId = String(exitOid ?? '').trim() || undefined;
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

      await this.syncPositionFromExchangeBestEffort(symbol);
      this.logger.info('Position close requested', {
        symbol,
        side: closeSide,
        qty: qClose,
        strategyPrice: price,
      });
      return { success: true, orderId };
    } catch (e) {
      const msg = String(e);
      this.logger.warn('DEBUG:: closePosition failed', { symbol, message: msg });
      return { success: false, error: msg };
    }
  }

  async updateStopLoss(
    symbol: string,
    stopLoss: number,
    roundTripId: string,
    deploymentId?: string,
  ): Promise<BrokerActionResult> {
    if (this.category === 'spot' || this.category === 'option') {
      this.logger.warn('updateStopLoss: not supported for category', {
        category: this.category,
        symbol,
      });
      return { success: false, error: 'category not supported' };
    }
    const instrument = this.getInstrument(symbol);
    if (!instrument) {
      this.logger.warn('updateStopLoss: unknown symbol', { symbol });
      return { success: false, error: 'unknown symbol' };
    }
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      this.logger.warn('updateStopLoss: invalid stopLoss', { symbol, stopLoss });
      return { success: false, error: 'invalid stopLoss' };
    }
    if (Math.abs(this.getPositionBook().getSnapshot(symbol).currentPositionQty) < 1e-12) {
      this.logger.debug('updateStopLoss ignored — flat', { symbol });
      return { success: false, error: 'flat position' };
    }
    const sl = instrument.roundPrice(stopLoss);
    try {
      const res = await this.rest.setTradingStop({
        category: this.category,
        symbol,
        stopLoss: String(sl),
        positionIdx: 0,
        slTriggerBy: 'LastPrice',
      });
      assertBybitOk(res, 'setTradingStop');
      const now = Date.now();
      await this.store.upsertOrderHistory({
        id: roundTripId,
        updatedAtMs: now,
        stopLoss: sl,
        /** First upsert for this id (e.g. position id from reconcile) requires these — see mergeOrderHistory. */
        ...(deploymentId !== undefined
          ? { deploymentId, symbol, status: 'open' as const }
          : {}),
      });
      await this.syncPositionFromExchangeBestEffort(symbol);
      this.logger.info('Trading stop updated', { symbol, stopLoss: sl });
      return { success: true };
    } catch (e) {
      const msg = String(e);
      this.logger.warn('DEBUG:: updateStopLoss failed', { symbol, message: msg });
      return { success: false, error: msg };
    }
  }

  async syncPositionFromVenue(
    symbol: string,
    options?: SyncPositionFromVenueOptions,
  ): Promise<void> {
    const now = Date.now();
    if (!options?.force) {
      const last = this.lastVenueSyncAtMs.get(symbol);
      if (
        last !== undefined &&
        now - last < this.venueSyncMinIntervalMs
      ) {
        this.logger.debug('DEBUG:: syncPositionFromVenue skipped (throttled)', {
          symbol,
          minIntervalMs: this.venueSyncMinIntervalMs,
        });
        return;
      }
    }

    const run = async (): Promise<void> => {
      await this.syncPositionFromExchange(symbol);
      this.lastVenueSyncAtMs.set(symbol, Date.now());
    };

    try {
      await run();
    } catch (e) {
      this.logger.warn('DEBUG:: syncPositionFromVenue failed, retrying once', {
        symbol,
        message: String(e),
      });
      try {
        await run();
      } catch (e2) {
        this.logger.warn('DEBUG:: syncPositionFromVenue failed after retry', {
          symbol,
          message: String(e2),
        });
      }
    }
  }

  /**
   * Match the most recent closed-PnL record for this symbol (last ~14d) to recover real exit order id, close fee, avg exit.
   */
  async fetchVenueClosedFillMeta(
    symbol: string,
    positionSide: 'Buy' | 'Sell',
    closedQty: number,
    instrument: Instrument,
  ): Promise<{
    readonly venueExitOrderId: string;
    readonly exitFee: number;
    readonly exitPrice: number;
    readonly exitTimestampMs: number;
  } | null> {
    if (this.category === 'spot' || this.category === 'option') {
      return null;
    }
    const targetQty = instrument.roundQty(closedQty);
    const qtyEps = Math.max(1e-12, instrument.stepSize * 0.5);
    const startTime = Date.now() - 14 * 86_400_000;
    try {
      const res = await this.rest.getClosedPnL({
        category: this.category,
        symbol,
        startTime,
        limit: 100,
      });
      const list = res.result?.list ?? [];
      const sorted = [...list].sort(
        (a, b) => Number(b.updatedTime) - Number(a.updatedTime),
      );
      for (const p of sorted) {
        if (String(p.side) !== positionSide) continue;
        const closedSize = instrument.roundQty(Number(p.closedSize));
        if (Math.abs(closedSize - targetQty) > qtyEps) continue;
        const orderId = String(p.orderId ?? '').trim();
        const exitPrice = Number(p.avgExitPrice);
        const exitFee = Math.abs(Number(p.closeFee));
        const exitTimestampMs = Number(p.updatedTime || p.createdTime);
        if (!orderId || !Number.isFinite(exitPrice) || exitPrice <= 0) continue;
        return {
          venueExitOrderId: orderId,
          exitFee: Number.isFinite(exitFee) ? exitFee : 0,
          exitPrice,
          exitTimestampMs: Number.isFinite(exitTimestampMs)
            ? exitTimestampMs
            : Date.now(),
        };
      }
    } catch (e) {
      this.logger.warn('fetchVenueClosedFillMeta failed', {
        symbol,
        message: String(e),
      });
    }
    return null;
  }

  private async syncPositionFromExchange(symbol: string): Promise<void> {
    const res = await this.rest.getPositionInfo({
      category: this.category,
      symbol,
    });
    assertBybitOk(res, 'getPositionInfo');
    const list = res.result?.list ?? [];
    if (list.length === 0) {
      this.getPositionBook().setPositionSnapshot(symbol, '', 0, 0, 0);
      return;
    }
    const p = list[0]!;
    const side = String(p.side ?? '');
    const sizeAbs = Number(p.size ?? 0);
    if (!Number.isFinite(sizeAbs) || sizeAbs <= 0) {
      this.getPositionBook().setPositionSnapshot(symbol, '', 0, 0, 0);
      return;
    }
    const avg = Number(p.avgPrice ?? 0);
    const upnl = Number(p.unrealisedPnl ?? 0);
    this.getPositionBook().setPositionSnapshot(symbol, side, sizeAbs, avg, upnl);

    const feeRate = await this.getFeeRate(symbol);
    const fillFee = Math.abs(sizeAbs) * avg * feeRate;
    if (fillFee > 0) {
      this.logger.debug('Estimated fee accrual', { symbol, fillFee });
    }
  }
}
