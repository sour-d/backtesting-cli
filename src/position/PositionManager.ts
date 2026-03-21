import { randomUUID } from 'node:crypto';
import type { EnrichedCandle } from '../core/types.js';
import type { TradeRecord } from '../core/types.js';
import type { IBroker } from '../broker/IBroker.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { StrategyEvaluateResult } from '../strategy/types.js';
import type { IPositionBook } from './IPositionBook.js';
import { PositionRuntime } from './PositionRuntime.js';
import type { PositionBookSnapshot, PositionRecord } from './types.js';
import { emptyPositionBookSnapshot } from './types.js';

export interface PositionManagerDeps {
  readonly broker: IBroker;
  readonly store: IStore;
  readonly feeRate: number;
  readonly logger: ILogger;
  readonly getInstrument: (symbol: string) => Instrument | undefined;
  /**
   * How often to sync tracked symbols from the venue and align `positions` + exit trades.
   * Set `0` to disable (backtest). Live typically `30_000`.
   */
  readonly reconcileIntervalMs: number;
}

interface RegistryEntry {
  readonly positionRowId: string;
  readonly deploymentId: string;
}

let singleton: PositionManager | undefined;

/**
 * Singleton: broker + trade persistence + `positions` rows + symbol → open row id.
 * Owns all runtime position/capital state per symbol ({@link PositionRuntime}).
 */
export class PositionManager implements IPositionBook {
  private readonly broker: IBroker;
  private readonly store: IStore;
  private readonly feeRate: number;
  private readonly logger: ILogger;
  private readonly getInstrument: (symbol: string) => Instrument | undefined;
  private readonly bySymbol = new Map<string, RegistryEntry>();
  private readonly runtimes = new Map<string, PositionRuntime>();
  private reconcileTimer: ReturnType<typeof setInterval> | undefined;

  private constructor(deps: PositionManagerDeps) {
    this.broker = deps.broker;
    this.store = deps.store;
    this.feeRate = deps.feeRate;
    this.logger = deps.logger;
    this.getInstrument = deps.getInstrument;

    const sync = this.broker.syncPositionFromVenue;
    if (
      typeof sync === 'function' &&
      deps.reconcileIntervalMs > 0
    ) {
      this.reconcileTimer = setInterval(() => {
        void this.reconcileTrackedSymbolsFromVenue();
      }, deps.reconcileIntervalMs);
      this.logger.info('PositionManager venue reconciliation started', {
        intervalMs: deps.reconcileIntervalMs,
      });
    }
  }

  /** Stop periodic venue sync (e.g. live engine shutdown). */
  stopReconciliation(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = undefined;
      this.logger.info('PositionManager venue reconciliation stopped');
    }
  }

  static configure(deps: PositionManagerDeps): void {
    singleton?.stopReconciliation();
    singleton = new PositionManager(deps);
  }

  static getInstance(): PositionManager {
    if (!singleton) {
      throw new Error('PositionManager.configure() must be called before getInstance()');
    }
    return singleton;
  }

  /** Test isolation — clears singleton and registry. */
  static resetForTests(): void {
    singleton?.stopReconciliation();
    singleton = undefined;
  }

  registerOpenPosition(symbol: string, positionRowId: string, deploymentId: string): void {
    this.bySymbol.set(symbol, { positionRowId, deploymentId });
  }

  /**
   * Clear persisted open-position registry + flat qty on runtime.
   * **Does not** remove runtime or capital — same as old `Instrument` staying alive after exit.
   */
  clearSymbol(symbol: string): void {
    this.bySymbol.delete(symbol);
    this.runtimes.get(symbol)?.clearOpenPositionKeepCapital();
  }

  /** Full drop (e.g. deployment removed) — registry + runtime including capital. */
  purgeSymbol(symbol: string): void {
    this.bySymbol.delete(symbol);
    this.runtimes.delete(symbol);
  }

  private runtimeFor(symbol: string): PositionRuntime {
    let r = this.runtimes.get(symbol);
    if (!r) {
      r = new PositionRuntime();
      this.runtimes.set(symbol, r);
    }
    return r;
  }

  applyEntry(
    symbol: string,
    side: 'Buy' | 'Sell',
    qty: number,
    price: number,
    fee: number,
  ): void {
    this.runtimeFor(symbol).applyEntry(side, qty, price, fee);
  }

  setPositionSnapshot(
    symbol: string,
    side: string,
    sizeAbs: number,
    avgEntry: number,
    unrealized: number,
  ): void {
    this.runtimeFor(symbol).setPositionSnapshot(side, sizeAbs, avgEntry, unrealized);
  }

  setCapitalAllocation(symbol: string, total: number, available: number): void {
    this.runtimeFor(symbol).setCapitalAllocation(total, available);
  }

  getSnapshot(symbol: string): PositionBookSnapshot {
    const r = this.runtimes.get(symbol);
    if (!r) return emptyPositionBookSnapshot();
    return {
      currentPositionQty: r.currentPositionQty,
      avgEntryPrice: r.avgEntryPrice,
      unrealizedPnL: r.unrealizedPnL,
      allocatedCapital: r.allocatedCapital,
      availableCapital: r.availableCapital,
    };
  }

  getCloseOrderSide(symbol: string): 'Buy' | 'Sell' | null {
    return this.runtimes.get(symbol)?.getCloseOrderSide() ?? null;
  }

  /** After restore — seed runtime from persisted open row before venue sync. */
  hydrateFromStoredRow(symbol: string, row: PositionRecord): void {
    this.runtimeFor(symbol).setPositionSnapshot(
      row.side,
      row.qty,
      row.avgEntryPrice ?? 0,
      0,
    );
  }

  getOpenPositionId(symbol: string): string | undefined {
    return this.bySymbol.get(symbol)?.positionRowId;
  }

  getDetails(symbol: string): RegistryEntry | undefined {
    return this.bySymbol.get(symbol);
  }

  /**
   * Exchange/reconcile shows an open position but registry + DB row were missing — create row and register.
   */
  async reconcileMissingRowIfNeeded(
    instrument: Instrument,
    deploymentId: string,
  ): Promise<void> {
    const { symbol } = instrument;
    if (this.getOpenPositionId(symbol)) return;
    const snap = this.getSnapshot(symbol);
    const q = snap.currentPositionQty;
    if (Math.abs(q) < 1e-12) return;

    const id = randomUUID();
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
    this.registerOpenPosition(symbol, id, deploymentId);
    this.logger.info('Position row reconciled from runtime', { symbol, id, deploymentId });
  }

  /**
   * Sync each registry symbol from the venue, then update `positions` or persist exit trade + clear when flat (e.g. SL hit).
   */
  async reconcileTrackedSymbolsFromVenue(): Promise<void> {
    const sync = this.broker.syncPositionFromVenue;
    if (typeof sync !== 'function') return;

    const symbols = [...this.bySymbol.keys()];
    for (const symbol of symbols) {
      try {
        await sync.call(this.broker, symbol);
        await this.applyRegistryAfterVenueSync(symbol);
      } catch (e) {
        this.logger.error('PositionManager venue reconcile failed', {
          symbol,
          message: String(e),
        });
      }
    }
  }

  private async applyRegistryAfterVenueSync(symbol: string): Promise<void> {
    const entry = this.bySymbol.get(symbol);
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
      this.clearSymbol(symbol);
      return;
    }

    const snap = this.getSnapshot(symbol);
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
        await this.persistExitTradeFromVenue({
          symbol,
          qty: exitQty,
          price,
          exitSide,
          timestamp,
        });
      }
      await this.store.deletePosition(row.id);
      this.clearSymbol(symbol);
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

  async processSignal(
    instrument: Instrument,
    candle: EnrichedCandle,
    signal: StrategyEvaluateResult,
    deploymentId: string,
  ): Promise<void> {
    if (signal.action === 'HOLD') {
      return;
    }

    if (signal.action === 'CLOSE') {
      await this.handleClose(instrument, candle, signal);
      return;
    }

    if (signal.action === 'UPDATE_SL') {
      await this.handleUpdateSl(instrument, signal);
      return;
    }

    if (signal.action === 'BUY' || signal.action === 'SELL') {
      await this.handleBuySell(instrument, candle, signal, deploymentId);
      return;
    }

    const _never: never = signal;
    void _never;
  }

  private async handleClose(
    instrument: Instrument,
    candle: EnrichedCandle,
    signal: Extract<StrategyEvaluateResult, { action: 'CLOSE' }>,
  ): Promise<void> {
    const symbol = instrument.symbol;
    const exitSide = this.getCloseOrderSide(symbol);
    if (!exitSide) {
      this.logger.debug('CLOSE ignored — flat position', {
        symbol,
      });
      return;
    }
    const posAbs = Math.abs(this.getSnapshot(symbol).currentPositionQty);
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
    await this.broker.closePosition(
      symbol,
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
    });

    const uid = this.getOpenPositionId(symbol);
    const now = Date.now();
    const qAfter = this.getSnapshot(symbol).currentPositionQty;
    if (uid && Math.abs(qAfter) < 1e-12) {
      await this.store.deletePosition(uid);
      this.clearSymbol(symbol);
    } else if (uid) {
      const side: 'Buy' | 'Sell' = qAfter > 0 ? 'Buy' : 'Sell';
      await this.store.updatePositionOpenSnapshot(uid, {
        qty: Math.abs(qAfter),
        avgEntryPrice: this.getSnapshot(symbol).avgEntryPrice,
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
    if (!this.getCloseOrderSide(instrument.symbol)) {
      this.logger.debug('UPDATE_SL ignored — flat position', {
        symbol: instrument.symbol,
      });
      return;
    }
    const uid = this.getOpenPositionId(instrument.symbol);
    await this.broker.updateStopLoss(instrument.symbol, signal.stopLoss);
    if (uid) {
      await this.store.updatePositionStopLoss(uid, signal.stopLoss, Date.now());
    }
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
  ): Promise<void> {
    const side = signal.action === 'BUY' ? 'Buy' : 'Sell';
    await this.broker.placeOrder({
      instrument,
      side,
      qty: signal.qty,
      price: signal.price,
    });

    await this.persistTrade({
      instrument,
      candle,
      kind: 'entry',
      qty: signal.qty,
      price: signal.price,
      side,
    });

    const symbol = instrument.symbol;
    const uid = this.getOpenPositionId(symbol);
    const now = Date.now();
    const q = this.getSnapshot(symbol).currentPositionQty;
    const posSide: 'Buy' | 'Sell' = q > 0 ? 'Buy' : 'Sell';
    const qtyAbs = Math.abs(q);

    if (Math.abs(q) < 1e-12) {
      this.logger.info('Signal executed (flat after fill)', {
        symbol,
        action: signal.action,
      });
      return;
    }

    if (uid) {
      await this.store.updatePositionOpenSnapshot(uid, {
        qty: qtyAbs,
        avgEntryPrice: this.getSnapshot(symbol).avgEntryPrice,
        side: posSide,
        updatedAtMs: now,
      });
    } else {
      const id = randomUUID();
      const rec: PositionRecord = {
        id,
        deploymentId,
        symbol,
        side: posSide,
        qty: qtyAbs,
        avgEntryPrice: this.getSnapshot(symbol).avgEntryPrice,
        stopLoss: Number.isFinite(signal.stopLoss) ? signal.stopLoss : null,
        openedAtMs: now,
        updatedAtMs: now,
      };
      await this.store.createPosition(rec);
      this.registerOpenPosition(symbol, id, deploymentId);
    }

    this.logger.info('Signal executed', {
      symbol,
      action: signal.action,
      qty: signal.qty,
      price: signal.price,
      stopLoss: signal.stopLoss,
    });
  }

  private async persistTrade(params: {
    instrument: Instrument;
    candle: EnrichedCandle;
    kind: TradeRecord['kind'];
    qty: number;
    price: number;
    side: 'Buy' | 'Sell';
  }): Promise<void> {
    await this.saveTradeRecord({
      symbol: params.instrument.symbol,
      side: params.side,
      qty: params.qty,
      price: params.price,
      timestamp: params.candle.dateUnix,
      kind: params.kind,
    });
  }

  private async persistExitTradeFromVenue(params: {
    symbol: string;
    qty: number;
    price: number;
    exitSide: 'Buy' | 'Sell';
    timestamp: number;
  }): Promise<void> {
    await this.saveTradeRecord({
      symbol: params.symbol,
      side: params.exitSide,
      qty: params.qty,
      price: params.price,
      timestamp: params.timestamp,
      kind: 'exit',
    });
  }

  private async saveTradeRecord(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    qty: number;
    price: number;
    timestamp: number;
    kind: TradeRecord['kind'];
  }): Promise<void> {
    const notional = params.qty * params.price;
    const rec: TradeRecord = {
      id: randomUUID(),
      symbol: params.symbol,
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
