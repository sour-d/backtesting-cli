import { randomUUID } from 'node:crypto';
import type { TradeRecord } from '../core/types.js';
import type { IBroker } from '../broker/IBroker.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { ITradingContextProvider } from '../bot/ITradingContextProvider.js';
import type { PositionService } from '../position/PositionService.js';
import type { PositionRecord } from '../position/types.js';
import type { IStore } from '../store/IStore.js';

export interface ReconciliationServiceDeps {
  readonly broker: IBroker;
  readonly positionService: PositionService;
  readonly store: IStore;
  readonly logger: ILogger;
  /** Fallback when {@link IBroker.getFeeRate} is missing or fails. */
  readonly defaultFeeRate: number;
  readonly getInstrument: (symbol: string) => Instrument | undefined;
  readonly tradingContext: ITradingContextProvider;
}

/**
 * Exchange sync + DB/registry alignment. Periodic tick and restore-time hooks only — no signal execution.
 */
export class ReconciliationService {
  private readonly broker: IBroker;
  private readonly positionService: PositionService;
  private readonly store: IStore;
  private readonly logger: ILogger;
  private readonly defaultFeeRate: number;
  private readonly getInstrument: (symbol: string) => Instrument | undefined;
  private readonly tradingContext: ITradingContextProvider;
  private timer: ReturnType<typeof setInterval> | undefined;
  private reconcileRunning = false;

  constructor(deps: ReconciliationServiceDeps) {
    this.broker = deps.broker;
    this.positionService = deps.positionService;
    this.store = deps.store;
    this.logger = deps.logger;
    this.defaultFeeRate = deps.defaultFeeRate;
    this.getInstrument = deps.getInstrument;
    this.tradingContext = deps.tradingContext;
  }

  private async resolveFeeRate(symbol: string): Promise<number> {
    try {
      const r = await this.broker.getFeeRate?.(symbol);
      if (typeof r === 'number' && Number.isFinite(r) && r >= 0) {
        return r;
      }
    } catch {
      /* fall through */
    }
    return this.defaultFeeRate;
  }

  private async reconcileLoop(): Promise<void> {
    if (this.reconcileRunning) return;
    this.reconcileRunning = true;
    try {
      await this.reconcileTrackedSymbolsFromVenue();
    } finally {
      this.reconcileRunning = false;
    }
  }

  start(intervalMs: number): void {
    if (intervalMs <= 0 || this.timer) return;
    if (typeof this.broker.syncPositionFromVenue !== 'function') {
      this.logger.warn('DEBUG:: ReconciliationService not started — broker has no syncPositionFromVenue', {});
      return;
    }
    this.timer = setInterval(() => {
      void this.reconcileLoop();
    }, intervalMs);
    this.logger.info('DEBUG:: ReconciliationService started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger.info('DEBUG:: ReconciliationService stopped', {});
  }

  /**
   * After hydrate/register on `PositionService`, pull venue size, create missing `positions` row, align DB/registry.
   */
  async syncAfterRestore(
    instrument: Instrument,
    deploymentId: string,
    klineInterval: string,
  ): Promise<void> {
    const sync = this.broker.syncPositionFromVenue;
    if (typeof sync !== 'function') return;
    const symbol = instrument.symbol;
    await sync.call(this.broker, symbol, { force: true });
    await this.reconcileMissingRowIfNeeded(instrument, deploymentId, klineInterval);
    if (this.positionService.getOpenPositionId(symbol)) {
      await this.applyRegistryAfterVenueSync(symbol);
    }
  }

  async reconcileMissingRowIfNeeded(
    instrument: Instrument,
    deploymentId: string,
    klineInterval: string,
  ): Promise<void> {
    const { symbol } = instrument;
    if (this.positionService.getOpenPositionId(symbol)) return;
    const snap = this.positionService.getSnapshot(symbol);
    const q = snap.currentPositionQty;
    if (Math.abs(q) < 1e-12) return;

    const linked =
      (await this.store.loadOpenOrderHistoryIdForDeployment(deploymentId, symbol)) ??
      null;
    const id = linked ?? randomUUID();
    if (linked) {
      this.logger.debug('Reconcile position id linked to open order_history', {
        symbol,
        deploymentId,
        id: linked,
      });
    }
    const now = Date.now();
    const side: 'Buy' | 'Sell' = q > 0 ? 'Buy' : 'Sell';
    const rec: PositionRecord = {
      id,
      deploymentId,
      symbol,
      side,
      qty: Math.abs(q),
      avgEntryPrice: snap.avgEntryPrice,
      stopLoss: null,
      openedAtMs: now,
      updatedAtMs: now,
    };
    await this.store.createPosition(rec);
    this.positionService.registerOpenPosition(symbol, id, deploymentId, klineInterval);
    this.logger.info('Position row reconciled from runtime', { symbol, id, deploymentId });
  }

  async reconcileTrackedSymbolsFromVenue(): Promise<void> {
    const sync = this.broker.syncPositionFromVenue;
    if (typeof sync !== 'function') return;

    const deploymentBySymbol = new Map<
      string,
      { readonly deploymentId: string; readonly klineInterval: string }
    >();
    for (const c of this.tradingContext.getActiveSymbols()) {
      deploymentBySymbol.set(c.symbol, {
        deploymentId: c.deploymentId,
        klineInterval: c.klineInterval,
      });
    }

    const union = new Set<string>([
      ...this.positionService.getRegisteredSymbols(),
      ...deploymentBySymbol.keys(),
    ]);

    for (const symbol of union) {
      try {
        await sync.call(this.broker, symbol);
        if (this.positionService.getDetails(symbol)) {
          await this.applyRegistryAfterVenueSync(symbol);
        } else {
          const inst = this.getInstrument(symbol);
          const ctx = deploymentBySymbol.get(symbol);
          if (inst && ctx) {
            await this.reconcileMissingRowIfNeeded(
              inst,
              ctx.deploymentId,
              ctx.klineInterval,
            );
          }
        }
      } catch (e) {
        this.logger.error('PositionManager venue reconcile failed', {
          symbol,
          message: String(e),
        });
      }
    }
  }

  private async applyRegistryAfterVenueSync(symbol: string): Promise<void> {
    const entry = this.positionService.getDetails(symbol);
    if (!entry) return;

    const inst = this.getInstrument(symbol);
    if (!inst) {
      this.logger.warn('PositionManager: instrument missing after venue sync', {
        symbol,
      });
      return;
    }

    const row = await this.store.loadPositionByDeploymentId(entry.deploymentId);
    if (!row) {
      this.positionService.clearSymbol(symbol);
      return;
    }

    const snap = this.positionService.getSnapshot(symbol);
    const q = snap.currentPositionQty;
    const now = Date.now();

    if (Math.abs(q) < 1e-12) {
      const exitSide: 'Buy' | 'Sell' = row.side === 'Buy' ? 'Sell' : 'Buy';
      const exitQty = row.qty;
      const last = inst.getCandles(1)[0];
      const price =
        last !== undefined && last.close > 0
          ? last.close
          : row.avgEntryPrice ?? 0;
      if (price <= 0) {
        this.logger.warn('PositionManager: skip exit trade — invalid price (position row kept)', {
          symbol,
        });
        return;
      }

      const timestamp = last?.dateUnix ?? Date.now();
      let exitPrice = price;
      let tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
      const feeRateForExit = await this.resolveFeeRate(symbol);
      let exitFee =
        feeRateForExit > 0 ? exitQty * exitPrice * feeRateForExit : 0;
      let venueExitOrderId = 'venue';
      let tradeBarUnix = timestamp;

      const fetchMeta = this.broker.fetchVenueClosedFillMeta;
      if (typeof fetchMeta === 'function') {
        const m = await fetchMeta.call(
          this.broker,
          symbol,
          row.side,
          exitQty,
          inst,
        );
        if (m) {
          venueExitOrderId = m.venueExitOrderId;
          exitFee = m.exitFee;
          exitPrice = inst.roundPrice(m.exitPrice);
          tsMs = m.exitTimestampMs;
          tradeBarUnix =
            m.exitTimestampMs >= 1e12
              ? Math.floor(m.exitTimestampMs / 1000)
              : Math.floor(m.exitTimestampMs);
          this.logger.info('Venue exit enriched from Bybit closed PnL', {
            symbol,
            venueExitOrderId,
            exitFee,
            exitPrice,
          });
        }
      }

      await this.persistExitTradeFromVenue({
        symbol,
        qty: exitQty,
        price: exitPrice,
        exitSide,
        timestamp: tradeBarUnix,
        klineInterval: entry.klineInterval,
      });
      await this.store.upsertOrderHistory({
        id: row.id,
        deploymentId: row.deploymentId,
        symbol: row.symbol,
        status: 'closed',
        updatedAtMs: Date.now(),
        exitQty,
        exitPrice,
        exitFee,
        exitTimestampMs: tsMs,
        venueExitOrderId,
      });
      await this.store.deletePosition(row.id);
      this.positionService.clearSymbol(symbol);
      this.logger.info('Venue position flat — exit trade persisted, row removed', {
        symbol,
      });
      return;
    }

    const posSide: 'Buy' | 'Sell' = q > 0 ? 'Buy' : 'Sell';
    await this.store.updatePositionOpenSnapshot(row.id, {
      qty: Math.abs(q),
      avgEntryPrice: snap.avgEntryPrice,
      side: posSide,
      updatedAtMs: now,
    });
  }

  private async persistExitTradeFromVenue(params: {
    symbol: string;
    qty: number;
    price: number;
    exitSide: 'Buy' | 'Sell';
    timestamp: number;
    klineInterval: string;
  }): Promise<void> {
    await this.saveReconcileTradeRecord({
      symbol: params.symbol,
      side: params.exitSide,
      qty: params.qty,
      price: params.price,
      timestamp: params.timestamp,
      kind: 'exit',
      klineInterval: params.klineInterval,
    });
  }

  private async saveReconcileTradeRecord(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    qty: number;
    price: number;
    timestamp: number;
    kind: TradeRecord['kind'];
    klineInterval: string;
  }): Promise<void> {
    const notional = params.qty * params.price;
    const feeRate = await this.resolveFeeRate(params.symbol);
    const rec: TradeRecord = {
      id: randomUUID(),
      symbol: params.symbol,
      klineInterval: params.klineInterval,
      side: params.side,
      qty: params.qty,
      price: params.price,
      fee: feeRate > 0 ? notional * feeRate : 0,
      timestamp: params.timestamp,
      kind: params.kind,
    };
    await this.store.saveTrade(rec);
  }
}
