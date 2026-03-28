import { RestClientV5 } from 'bybit-api';
import type { CategoryV5 } from 'bybit-api';
import type { OrderHistoryPatch } from '../core/types.js';
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

type ParsedPositionList =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'flat' }
  | {
      readonly kind: 'open';
      readonly side: string;
      readonly sizeAbs: number;
      readonly avg: number;
      readonly upnl: number;
    };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
 *
 * `BrokerActionResult.success === true` means the exchange accepted the HTTP/API request (e.g. order ack), not that
 * the order is filled or that local position state is final. Position truth comes from venue sync
 * (`syncPositionFromVenue`) and reconciliation against the store.
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
  /** In-memory fallback when `upsertOrderHistory` fails after the venue accepted the action. */
  private readonly pendingOrderHistoryPatches: OrderHistoryPatch[] = [];

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

  private parseGetPositionInfoList(
    res: { result?: { list?: unknown } },
    symbol: string,
  ): ParsedPositionList {
    const list = res.result?.list;
    if (!Array.isArray(list)) {
      this.logger.warn(
        'DEBUG:: getPositionInfo: invalid shape (list missing or not array) — skipping position book update',
        { symbol },
      );
      return { kind: 'invalid' };
    }
    if (list.length === 0) {
      return { kind: 'flat' };
    }
    const p = list[0];
    if (p === null || p === undefined || typeof p !== 'object') {
      this.logger.warn(
        'DEBUG:: getPositionInfo: invalid shape (first list entry) — skipping position book update',
        { symbol },
      );
      return { kind: 'invalid' };
    }
    const raw = p as { side?: unknown; size?: unknown; avgPrice?: unknown; unrealisedPnl?: unknown };
    const side = String(raw.side ?? '');
    const sizeAbs = Number(raw.size ?? 0);
    if (!Number.isFinite(sizeAbs) || sizeAbs <= 0) {
      this.logger.warn(
        'DEBUG:: getPositionInfo: non-empty list but size missing or non-positive — skipping position book update (not flattening)',
        { symbol, sizeAbs },
      );
      return { kind: 'invalid' };
    }
    if (side !== 'Buy' && side !== 'Sell') {
      this.logger.warn(
        'DEBUG:: getPositionInfo: invalid side — skipping position book update',
        { symbol, side },
      );
      return { kind: 'invalid' };
    }
    const avg = Number(raw.avgPrice ?? 0);
    const upnl = Number(raw.unrealisedPnl ?? 0);
    if (!Number.isFinite(avg)) {
      this.logger.warn(
        'DEBUG:: getPositionInfo: invalid avgPrice — skipping position book update',
        { symbol },
      );
      return { kind: 'invalid' };
    }
    return { kind: 'open', side, sizeAbs, avg, upnl };
  }

  private async tryUpsertOrderHistoryWithBackoff(patch: OrderHistoryPatch): Promise<boolean> {
    const backoffMs = [0, 120, 280];
    let lastErr: unknown;
    for (let i = 0; i < backoffMs.length; i++) {
      if (backoffMs[i]! > 0) {
        await sleep(backoffMs[i]!);
      }
      try {
        await this.store.upsertOrderHistory(patch);
        return true;
      } catch (e) {
        lastErr = e;
      }
    }
    this.logger.warn('DEBUG:: upsertOrderHistory failed after retries', {
      patchId: patch.id,
      message: String(lastErr),
    });
    return false;
  }

  /**
   * Persists `order_history` after the venue accepted the action. Retries then queues on failure;
   * does not change {@link BrokerActionResult.success}.
   */
  private async persistOrderHistoryAfterVenueAccept(
    patch: OrderHistoryPatch,
    criticalLabel: string,
    criticalMeta: Record<string, unknown>,
  ): Promise<void> {
    const ok = await this.tryUpsertOrderHistoryWithBackoff(patch);
    if (ok) {
      return;
    }
    this.logger.error(`CRITICAL:: ${criticalLabel}`, {
      ...criticalMeta,
      patchId: patch.id,
    });
    this.pendingOrderHistoryPatches.push(patch);
    this.logger.warn('DEBUG:: order_history queued for recoverMissingOrderHistory', {
      patchId: patch.id,
    });
  }

  private async flushPendingOrderHistoryPatchesForSymbol(symbol: string): Promise<void> {
    const keep: OrderHistoryPatch[] = [];
    const mine: OrderHistoryPatch[] = [];
    for (const p of this.pendingOrderHistoryPatches) {
      let sym: string | undefined = p.symbol;
      if (sym === undefined) {
        const row = await this.store.loadPositionById(p.id);
        sym = row?.symbol;
      }
      if (sym === symbol) {
        mine.push(p);
      } else {
        keep.push(p);
      }
    }
    this.pendingOrderHistoryPatches.length = 0;
    this.pendingOrderHistoryPatches.push(...keep);
    for (const patch of mine) {
      const ok = await this.tryUpsertOrderHistoryWithBackoff(patch);
      if (!ok) {
        this.pendingOrderHistoryPatches.push(patch);
        this.logger.error(
          'CRITICAL:: persistence failure — order_history still pending after recover retry',
          { patchId: patch.id, symbol },
        );
      }
    }
  }

  /**
   * Call only inside the engine per-symbol mutex. Flushes pending patches for `symbol`, then backfills
   * missing open `order_history` when a DB position row exists and the venue reports open size.
   */
  async recoverMissingOrderHistoryForSymbol(
    symbol: string,
    deploymentId: string,
  ): Promise<void> {
    await this.flushPendingOrderHistoryPatchesForSymbol(symbol);
    try {
      await this.recoverOpenOrderHistoryFromVenueIfMissing(symbol, deploymentId);
    } catch (e) {
      this.logger.warn('DEBUG:: recoverOpenOrderHistoryFromVenueIfMissing failed', {
        symbol,
        deploymentId,
        message: String(e),
      });
    }
  }

  reportPendingOrderHistoryPatchesIfAny(): void {
    if (this.pendingOrderHistoryPatches.length > 0) {
      this.logger.error(
        'CRITICAL:: exchange/DB order_history may be inconsistent — pending patches remain',
        { count: this.pendingOrderHistoryPatches.length },
      );
    }
  }

  private async recoverOpenOrderHistoryFromVenueIfMissing(
    symbol: string,
    deploymentId: string,
  ): Promise<void> {
    const row = await this.store.loadPositionByDeploymentId(deploymentId);
    if (!row || row.symbol !== symbol) {
      return;
    }
    const openId = await this.store.loadOpenOrderHistoryIdForDeployment(deploymentId, symbol);
    if (openId !== null) {
      return;
    }
    const res = await this.rest.getPositionInfo({
      category: this.category,
      symbol,
    });
    assertBybitOk(res, 'getPositionInfo(recover)');
    const parsed = this.parseGetPositionInfoList(res, symbol);
    if (parsed.kind !== 'open') {
      return;
    }
    const instrument = this.getInstrument(symbol);
    const now = Date.now();
    const entryPx = row.avgEntryPrice ?? parsed.avg;
    const feeRate = await this.getFeeRate(symbol);
    const entryFee =
      instrument && entryPx > 0
        ? Math.abs(row.qty * entryPx) * feeRate
        : 0;
    await this.persistOrderHistoryAfterVenueAccept(
      {
        id: row.id,
        deploymentId,
        symbol,
        status: 'open',
        updatedAtMs: now,
        entrySide: row.side,
        entryQty: row.qty,
        entryPrice: entryPx > 0 ? entryPx : parsed.avg,
        entryOrderType: 'reconcile',
        entryAtMs: now,
        entryTimestampMs: now,
        entryFee,
        raw: { recovered: true, source: 'recoverMissingOrderHistory' },
      },
      'failed to persist recovered order_history after venue check',
      { symbol, deploymentId, positionId: row.id },
    );
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

    let res: Awaited<ReturnType<RestClientV5['submitOrder']>>;
    try {
      res = await this.rest.submitOrder({
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
    } catch (e) {
      const msg = String(e);
      this.logger.warn('DEBUG:: placeOrder failed (exchange rejected or transport error)', {
        symbol: sym,
        message: msg,
      });
      return { success: false, error: msg };
    }

    const orderId = String(res.result?.orderId ?? '').trim() || 'unknown';
    const result: BrokerActionResult = { success: true, orderId };

    const notional = Math.abs(q * refPrice);
    const feeRate = await this.getFeeRate(sym);
    const entryFee = notional * feeRate;
    const now = Date.now();
    await this.persistOrderHistoryAfterVenueAccept(
      {
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
      },
      'failed to persist order_history after submitOrder accepted',
      { symbol: sym, roundTripId, orderId },
    );

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
    return result;
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

    let res: Awaited<ReturnType<RestClientV5['submitOrder']>>;
    try {
      res = await this.rest.submitOrder({
        category: this.category,
        symbol,
        side: closeSide,
        orderType: 'Market',
        qty: String(qClose),
        reduceOnly: true,
      });
      assertBybitOk(res, 'submitOrder(close)');
    } catch (e) {
      const msg = String(e);
      this.logger.warn('DEBUG:: closePosition failed (exchange rejected or transport error)', {
        symbol,
        message: msg,
      });
      return { success: false, error: msg };
    }

    const exitOid = res.result?.orderId ?? null;
    const orderId = String(exitOid ?? '').trim() || undefined;
    const result: BrokerActionResult = { success: true, orderId };

    const last = instrument.getCandles(1);
    const lastClose = last[last.length - 1]?.close;
    const exitPx = price ?? lastClose ?? 0;
    const feeRate = await this.getFeeRate(symbol);
    const exitFee = exitPx > 0 ? Math.abs(qClose * exitPx) * feeRate : 0;
    const now = Date.now();
    await this.persistOrderHistoryAfterVenueAccept(
      {
        id: roundTripId,
        symbol,
        updatedAtMs: now,
        status: 'closed',
        venueExitOrderId: exitOid,
        exitAtMs: now,
        exitQty: qClose,
        exitPrice: exitPx > 0 ? exitPx : null,
        exitFee,
        exitTimestampMs: now,
        raw: res as unknown as Record<string, unknown>,
      },
      'failed to persist order_history after close accepted',
      { symbol, roundTripId, orderId },
    );

    await this.syncPositionFromExchangeBestEffort(symbol);
    this.logger.info('Position close requested', {
      symbol,
      side: closeSide,
      qty: qClose,
      strategyPrice: price,
    });
    return result;
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
    } catch (e) {
      const msg = String(e);
      this.logger.warn('DEBUG:: updateStopLoss failed (exchange rejected or transport error)', {
        symbol,
        message: msg,
      });
      return { success: false, error: msg };
    }

    const result: BrokerActionResult = { success: true };

    const nowSl = Date.now();
    await this.persistOrderHistoryAfterVenueAccept(
      {
        id: roundTripId,
        symbol,
        updatedAtMs: nowSl,
        stopLoss: sl,
        /** First upsert for this id (e.g. position id from reconcile) requires these — see mergeOrderHistory. */
        ...(deploymentId !== undefined
          ? { deploymentId, status: 'open' as const }
          : {}),
      },
      'failed to persist order_history after setTradingStop accepted',
      { symbol, roundTripId },
    );

    await this.syncPositionFromExchangeBestEffort(symbol);
    this.logger.info('Trading stop updated', { symbol, stopLoss: sl });
    return result;
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
    const parsed = this.parseGetPositionInfoList(res, symbol);
    if (parsed.kind === 'invalid') {
      return;
    }
    if (parsed.kind === 'flat') {
      this.getPositionBook().setPositionSnapshot(symbol, '', 0, 0, 0);
      return;
    }
    this.getPositionBook().setPositionSnapshot(
      symbol,
      parsed.side,
      parsed.sizeAbs,
      parsed.avg,
      parsed.upnl,
    );

    const feeRate = await this.getFeeRate(symbol);
    const fillFee = Math.abs(parsed.sizeAbs) * parsed.avg * feeRate;
    if (fillFee > 0) {
      this.logger.debug('Estimated fee accrual', { symbol, fillFee });
    }
  }
}
