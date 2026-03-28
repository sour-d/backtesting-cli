import { randomUUID } from 'node:crypto';
import type { EnrichedCandle } from '../core/types.js';
import type { TradeRecord } from '../core/types.js';
import type { IBroker } from '../broker/IBroker.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { PositionService } from '../position/PositionService.js';
import type { PositionRecord } from '../position/types.js';
import type { StrategyEvaluateResult } from '../strategy/types.js';

export interface TradeDeploymentContext {
  readonly deploymentId: string;
  readonly klineInterval: string;
  readonly candle: EnrichedCandle;
}

export interface TradeEngineDeps {
  readonly broker: IBroker;
  readonly positionService: PositionService;
  readonly store: IStore;
  readonly logger: ILogger;
  /** Fallback when {@link IBroker.getFeeRate} is missing or fails. */
  readonly defaultFeeRate: number;
}

export class TradeEngine {
  private readonly broker: IBroker;
  private readonly positionService: PositionService;
  private readonly store: IStore;
  private readonly logger: ILogger;
  private readonly defaultFeeRate: number;

  constructor(deps: TradeEngineDeps) {
    this.broker = deps.broker;
    this.positionService = deps.positionService;
    this.store = deps.store;
    this.logger = deps.logger;
    this.defaultFeeRate = deps.defaultFeeRate;
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

  /** Live: pull latest venue size into `positionService` after an order path (no-op in backtest). */
  private async pullVenuePositionIfLive(symbol: string): Promise<void> {
    const sync = this.broker.syncPositionFromVenue;
    if (typeof sync !== 'function') return;
    await sync.call(this.broker, symbol);
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

    await this.pullVenuePositionIfLive(symbol);

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
    await this.pullVenuePositionIfLive(instrument.symbol);
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
      await this.pullVenuePositionIfLive(symbol);
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

    await this.pullVenuePositionIfLive(symbol);

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
