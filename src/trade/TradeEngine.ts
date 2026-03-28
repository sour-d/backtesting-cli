import { randomUUID } from 'node:crypto';
import type { EnrichedCandle } from '../core/types.js';
import type { TradeRecord } from '../core/types.js';
import type { IBroker } from '../broker/IBroker.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { ActiveDeploymentContext, PositionManager } from '../position/PositionManager.js';
import type { PositionRecord } from '../position/types.js';
import type { StrategyEvaluateResult } from '../strategy/types.js';

export interface TradeDeploymentContext {
  readonly deploymentId: string;
  readonly klineInterval: string;
  readonly candle: EnrichedCandle;
}

export interface TradeEngineDeps {
  readonly broker: IBroker;
  readonly positionService: PositionManager;
  readonly store: IStore;
  readonly logger: ILogger;
  readonly feeRate: number;
  readonly getInstrument: (symbol: string) => Instrument | undefined;
  readonly getActiveDeploymentContexts?: () => ReadonlyArray<ActiveDeploymentContext>;
}

export class TradeEngine {
  private readonly broker: IBroker;
  private readonly positionService: PositionManager;
  private readonly store: IStore;
  private readonly logger: ILogger;
  private readonly feeRate: number;
  private readonly getInstrument: (symbol: string) => Instrument | undefined;
  private readonly getActiveDeploymentContexts?: () => ReadonlyArray<ActiveDeploymentContext>;

  constructor(deps: TradeEngineDeps) {
    this.broker = deps.broker;
    this.positionService = deps.positionService;
    this.store = deps.store;
    this.logger = deps.logger;
    this.feeRate = deps.feeRate;
    this.getInstrument = deps.getInstrument;
    this.getActiveDeploymentContexts = deps.getActiveDeploymentContexts;
  }

  async execute(
    signal: StrategyEvaluateResult,
    instrument: Instrument,
    deploymentContext: TradeDeploymentContext,
  ): Promise<void> {
    const { candle, deploymentId, klineInterval } = deploymentContext;
    if (signal.action === 'HOLD') {
      return;
    }

    if (signal.action === 'CLOSE') {
      await this.handleClose(instrument, candle, signal, klineInterval);
      return;
    }

    if (signal.action === 'UPDATE_SL') {
      await this.handleUpdateSl(instrument, signal);
      return;
    }

    if (signal.action === 'BUY' || signal.action === 'SELL') {
      await this.handleBuySell(instrument, candle, signal, deploymentId, klineInterval);
      return;
    }

    const _never: never = signal;
    void _never;
  }

  /**
   * Live restore: after hydrate/register on {@link PositionManager}, pull venue size,
   * create a `positions` row if the exchange shows size but we had none, then align DB/registry when flat or open.
   */
  async syncOpenPositionFromVenueAfterRestore(
    instrument: Instrument,
    deploymentId: string,
    klineInterval: string,
  ): Promise<void> {
    const sync = this.broker.syncPositionFromVenue;
    if (typeof sync !== 'function') return;
    const symbol = instrument.symbol;
    await sync.call(this.broker, symbol);
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
    const getCtx = this.getActiveDeploymentContexts;
    if (typeof getCtx === 'function') {
      for (const c of getCtx()) {
        deploymentBySymbol.set(c.symbol, {
          deploymentId: c.deploymentId,
          klineInterval: c.klineInterval,
        });
      }
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
        this.logger.warn('PositionManager: skip exit trade — invalid price', {
          symbol,
        });
      } else {
        const timestamp = last?.dateUnix ?? Date.now();
        let exitPrice = price;
        let tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
        let exitFee =
          this.feeRate > 0 ? exitQty * exitPrice * this.feeRate : 0;
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
      }
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

  private async handleClose(
    instrument: Instrument,
    candle: EnrichedCandle,
    signal: Extract<StrategyEvaluateResult, { action: 'CLOSE' }>,
    klineInterval: string,
  ): Promise<void> {
    const symbol = instrument.symbol;
    const exitSide = this.positionService.getCloseOrderSide(symbol);
    if (!exitSide) {
      this.logger.debug('CLOSE ignored — flat position', {
        symbol,
      });
      return;
    }
    const posAbs = Math.abs(this.positionService.getSnapshot(symbol).currentPositionQty);
    const closeAll = signal.qty === undefined;
    const exitQty = closeAll
      ? posAbs
      : Math.min(instrument.roundQty(Math.abs(signal.qty!)), posAbs);
    if (exitQty <= 0) {
      this.logger.debug('CLOSE ignored — zero qty', {
        symbol,
      });
      return;
    }
    const strategyExitPrice =
      signal.price !== undefined &&
      Number.isFinite(signal.price) &&
      signal.price > 0
        ? signal.price
        : undefined;
    const roundTripId = this.positionService.getOpenPositionId(symbol);
    if (!roundTripId) {
      this.logger.debug('CLOSE ignored — no open position id', { symbol });
      return;
    }
    await this.broker.closePosition(
      symbol,
      roundTripId,
      closeAll ? undefined : exitQty,
      strategyExitPrice,
    );
    const exitFillPrice = strategyExitPrice ?? candle.close;
    await this.persistTrade({
      instrument,
      candle,
      kind: 'exit',
      qty: exitQty,
      price: exitFillPrice,
      side: exitSide,
      klineInterval,
    });

    const uid = this.positionService.getOpenPositionId(symbol);
    const now = Date.now();
    const qAfter = this.positionService.getSnapshot(symbol).currentPositionQty;
    if (uid && Math.abs(qAfter) < 1e-12) {
      await this.store.deletePosition(uid);
      this.positionService.clearSymbol(symbol);
    } else if (uid) {
      const side: 'Buy' | 'Sell' = qAfter > 0 ? 'Buy' : 'Sell';
      await this.store.updatePositionOpenSnapshot(uid, {
        qty: Math.abs(qAfter),
        avgEntryPrice: this.positionService.getSnapshot(symbol).avgEntryPrice,
        side,
        updatedAtMs: now,
      });
    }

    this.logger.info('Signal CLOSE executed', {
      symbol,
      exitRefPrice: exitFillPrice,
      strategyPrice: signal.price,
      closeAll,
      qty: exitQty,
    });
  }

  private async handleUpdateSl(
    instrument: Instrument,
    signal: Extract<StrategyEvaluateResult, { action: 'UPDATE_SL' }>,
  ): Promise<void> {
    if (!Number.isFinite(signal.stopLoss) || signal.stopLoss <= 0) {
      this.logger.debug('UPDATE_SL ignored — invalid stopLoss', {
        symbol: instrument.symbol,
        stopLoss: signal.stopLoss,
      });
      return;
    }
    if (!this.positionService.getCloseOrderSide(instrument.symbol)) {
      this.logger.debug('UPDATE_SL ignored — flat position', {
        symbol: instrument.symbol,
      });
      return;
    }
    const uid = this.positionService.getOpenPositionId(instrument.symbol);
    if (!uid) {
      this.logger.debug('UPDATE_SL ignored — no position id', {
        symbol: instrument.symbol,
      });
      return;
    }
    const deploymentId = this.positionService.getDetails(instrument.symbol)?.deploymentId;
    await this.broker.updateStopLoss(
      instrument.symbol,
      signal.stopLoss,
      uid,
      deploymentId,
    );
    await this.store.updatePositionStopLoss(uid, signal.stopLoss, Date.now());
    this.logger.info('Signal UPDATE_SL executed', {
      symbol: instrument.symbol,
      stopLoss: signal.stopLoss,
    });
  }

  private async handleBuySell(
    instrument: Instrument,
    candle: EnrichedCandle,
    signal: Extract<
      StrategyEvaluateResult,
      { action: 'BUY' } | { action: 'SELL' }
    >,
    deploymentId: string,
    klineInterval: string,
  ): Promise<void> {
    const side = signal.action === 'BUY' ? 'Buy' : 'Sell';
    const symbol = instrument.symbol;
    const preUid = this.positionService.getOpenPositionId(symbol);
    const roundTripId = preUid ?? randomUUID();
    await this.broker.placeOrder({
      instrument,
      side,
      qty: signal.qty,
      price: signal.price,
      stopLoss:
        signal.stopLoss !== undefined &&
        Number.isFinite(signal.stopLoss) &&
        signal.stopLoss > 0
          ? signal.stopLoss
          : undefined,
      roundTripId,
      deploymentId,
    });

    await this.persistTrade({
      instrument,
      candle,
      kind: 'entry',
      qty: signal.qty,
      price: signal.price,
      side,
      klineInterval,
    });

    const uid = this.positionService.getOpenPositionId(symbol);
    const now = Date.now();
    const q = this.positionService.getSnapshot(symbol).currentPositionQty;
    const posSide: 'Buy' | 'Sell' = q > 0 ? 'Buy' : 'Sell';
    const qtyAbs = Math.abs(q);

    if (Math.abs(q) < 1e-12) {
      this.logger.info('Signal executed', {
        symbol,
        action: signal.action,
        qty: signal.qty,
        price: signal.price,
        stopLoss: signal.stopLoss,
        outcome: 'flat_after_sync',
        note:
          'Venue position size is still zero after sync — e.g. limit order not filled yet, or order did not open size.',
      });
      return;
    }

    if (uid) {
      await this.store.updatePositionOpenSnapshot(uid, {
        qty: qtyAbs,
        avgEntryPrice: this.positionService.getSnapshot(symbol).avgEntryPrice,
        side: posSide,
        updatedAtMs: now,
      });
    } else {
      const rec: PositionRecord = {
        id: roundTripId,
        deploymentId,
        symbol,
        side: posSide,
        qty: qtyAbs,
        avgEntryPrice: this.positionService.getSnapshot(symbol).avgEntryPrice,
        stopLoss: Number.isFinite(signal.stopLoss) ? signal.stopLoss : null,
        openedAtMs: now,
        updatedAtMs: now,
      };
      await this.store.createPosition(rec);
      this.positionService.registerOpenPosition(symbol, roundTripId, deploymentId, klineInterval);
    }

    this.logger.info('Signal executed', {
      symbol,
      action: signal.action,
      qty: signal.qty,
      price: signal.price,
      stopLoss: signal.stopLoss,
      outcome: 'opened',
    });
  }

  private async persistTrade(params: {
    instrument: Instrument;
    candle: EnrichedCandle;
    kind: TradeRecord['kind'];
    qty: number;
    price: number;
    side: 'Buy' | 'Sell';
    klineInterval: string;
  }): Promise<void> {
    await this.saveTradeRecord({
      symbol: params.instrument.symbol,
      side: params.side,
      qty: params.qty,
      price: params.price,
      timestamp: params.candle.dateUnix,
      kind: params.kind,
      klineInterval: params.klineInterval,
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
    await this.saveTradeRecord({
      symbol: params.symbol,
      side: params.exitSide,
      qty: params.qty,
      price: params.price,
      timestamp: params.timestamp,
      kind: 'exit',
      klineInterval: params.klineInterval,
    });
  }

  private async saveTradeRecord(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    qty: number;
    price: number;
    timestamp: number;
    kind: TradeRecord['kind'];
    klineInterval: string;
  }): Promise<void> {
    const notional = params.qty * params.price;
    const rec: TradeRecord = {
      id: randomUUID(),
      symbol: params.symbol,
      klineInterval: params.klineInterval,
      side: params.side,
      qty: params.qty,
      price: params.price,
      fee: this.feeRate > 0 ? notional * this.feeRate : 0,
      timestamp: params.timestamp,
      kind: params.kind,
    };
    await this.store.saveTrade(rec);
  }
}
