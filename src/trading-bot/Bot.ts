import type { Candle, TradeEntry } from '../types/index.js';
import type { Market } from '../market/Market.js';
import type { IBroker } from '../broker/IBroker.js';
import type { IStore, LiveEvent } from '../store/IStore.js';
import { safeErrorMessage } from '../utils/safeErrorMessage.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStrategy } from '../strategy/IStrategy.js';
import type { ILiveDeploymentSync } from '../deployment/liveDeploymentSync.js';

export interface BotDeps {
  market: Market;
  broker: IBroker;
  store: IStore;
  logger: ILogger;
  /** For live: session id used when persisting live_events (order_failed, exit_failed, runtime_error) */
  sessionId?: string;
  strategyMap?: ReadonlyMap<string, IStrategy>;
  warmupPeriod?: number;
  /** Live: persist positions / completed trades / capital to DB via DeploymentManager */
  liveDeploymentSync?: ILiveDeploymentSync;
}

export class Bot {
  private readonly market: Market;
  private readonly broker: IBroker;
  private readonly store: IStore;
  private readonly logger: ILogger;
  private readonly sessionId: string;
  private readonly strategyMap: Map<string, IStrategy>;
  private readonly warmupPeriod: number;
  private readonly liveDeploymentSync: ILiveDeploymentSync | undefined;
  private readonly symbolCandleCount: Map<string, number> = new Map();
  private readonly pausedSymbols: Set<string> = new Set();
  /** Last entry risk per symbol (for StoredTrade.risk on exit). */
  private readonly lastEntryRisk: Map<string, number> = new Map();
  private candleCount = 0;

  constructor(deps: BotDeps) {
    this.market = deps.market;
    this.broker = deps.broker;
    this.store = deps.store;
    this.logger = deps.logger;
    this.sessionId = deps.sessionId ?? '';
    this.strategyMap = new Map(deps.strategyMap ?? []);
    this.warmupPeriod = deps.warmupPeriod ?? 20;
    this.liveDeploymentSync = deps.liveDeploymentSync;
  }

  private async persistLiveEvent(eventType: LiveEvent['eventType'], symbol: string, message: string, payload?: Record<string, unknown>): Promise<void> {
    const save = this.store.saveLiveEvent;
    if (!save || !this.sessionId) return;
    try {
      await save({
        sessionId: this.sessionId,
        eventType,
        symbol,
        message,
        payload,
      });
    } catch {
      // Do not throw; persistence failure must not crash the flow
    }
  }

  /** Pre-set the candle count for a symbol after loading historical data (skips warmup wait). */
  setHistoryCount(symbol: string, count: number): void {
    this.symbolCandleCount.set(symbol, count);
  }

  addSymbol(symbol: string, strategy: IStrategy): void {
    this.strategyMap.set(symbol, strategy);
    this.logger.info('Symbol added', { symbol, strategy: strategy.name });
  }

  removeSymbol(symbol: string): void {
    this.strategyMap.delete(symbol);
    this.symbolCandleCount.delete(symbol);
    this.pausedSymbols.delete(symbol);
    this.lastEntryRisk.delete(symbol);
    this.logger.info('Symbol removed', { symbol });
  }

  pauseSymbol(symbol: string): void {
    this.pausedSymbols.add(symbol);
    this.logger.info('Symbol paused', { symbol });
  }

  resumeSymbol(symbol: string): void {
    this.pausedSymbols.delete(symbol);
    this.logger.info('Symbol resumed', { symbol });
  }

  isSymbolActive(symbol: string): boolean {
    return this.strategyMap.has(symbol) && !this.pausedSymbols.has(symbol);
  }

  getActiveSymbols(): string[] {
    return [...this.strategyMap.keys()].filter((s) => !this.pausedSymbols.has(s));
  }

  async onCandle(symbol: string, candle: Candle): Promise<void> {
    try {
      await this.onCandleInner(symbol, candle);
    } catch (err) {
      const message = safeErrorMessage(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error('Runtime error in onCandle', { symbol, message, stack });
      await this.persistLiveEvent('runtime_error', symbol, message, { stack });
      // Do not rethrow: keep server running
    }
  }

  private async onCandleInner(symbol: string, candle: Candle): Promise<void> {
    this.candleCount++;
    const symbolCount = (this.symbolCandleCount.get(symbol) ?? 0) + 1;
    this.symbolCandleCount.set(symbol, symbolCount);

    this.market.update(symbol, candle);
    this.logger.info('Candle enriched', {
      flow: 'candle_enriched',
      symbol,
      dateUnix: candle.dateUnix,
      candleCount: symbolCount,
    });

    if (symbolCount <= this.warmupPeriod) return;

    if (this.pausedSymbols.has(symbol)) return;

    const stock = this.market.getStock(symbol);
    const strategy = this.strategyMap.get(symbol);
    if (!strategy) return;

    const slEntry = await Promise.resolve(this.broker.checkStopLoss(symbol, candle));
    if (slEntry) {
      this.store.recordTrade(slEntry);
      this.logger.info('Stop-loss triggered', {
        flow: 'stop_loss_triggered',
        symbol,
        price: slEntry.price,
        side: slEntry.side,
        quantity: slEntry.quantity,
      });
      this.logger.info('Trade recorded (in-memory)', {
        flow: 'trade_recorded',
        type: 'STOP_LOSS',
        symbol,
        side: slEntry.side,
        price: slEntry.price,
        quantity: slEntry.quantity,
      });
      await this.liveDeploymentSync?.onPositionClosed(symbol, {
        side: slEntry.side,
        quantity: slEntry.quantity,
        exitPrice: slEntry.price,
        exitTime: slEntry.timestamp,
        entryPrice: slEntry.positionEntryPrice ?? slEntry.price,
        entryTime: slEntry.positionEntryTime ?? slEntry.timestamp,
        risk: this.lastEntryRisk.get(symbol) ?? 0,
        exitType: 'stop_loss',
      });
      this.lastEntryRisk.delete(symbol);
      return;
    }

    const position = await Promise.resolve(this.broker.getPosition(symbol));
    this.logger.debug('Strategy evaluating', {
      flow: 'strategy_eval',
      symbol,
      hasPosition: !!position,
      positionSide: position?.side,
      dateUnix: candle.dateUnix,
    });
    const signal = strategy.evaluate(stock, position);

    if (!signal) {
      this.logger.debug('No signal', { flow: 'strategy_signal', symbol, signal: null });
      return;
    }

    this.logger.info('Strategy signal', {
      flow: 'strategy_signal',
      symbol,
      action: signal.action,
      price: signal.price,
      reason: signal.reason,
      ...(signal.action !== 'EXIT'
        ? { stopLoss: signal.stopLoss, risk: signal.risk }
        : {}),
    });

    if (signal.action === 'EXIT') {
      this.logger.info('Exit position request', {
        flow: 'exit_request',
        symbol,
        exitPrice: signal.price,
        reason: signal.reason,
      });
      const result = await Promise.resolve(this.broker.exitPosition(symbol, signal.price, candle.dateUnix));
      if (result.ok) {
        const exitRec = result.value;
        this.store.recordTrade(exitRec);
        this.logger.info('Exit position success', {
          flow: 'exit_result',
          symbol,
          success: true,
          exitPrice: signal.price,
          side: exitRec.side,
          quantity: exitRec.quantity,
        });
        this.logger.info('Trade recorded (in-memory)', {
          flow: 'trade_recorded',
          type: 'EXIT',
          symbol,
          side: exitRec.side,
          price: exitRec.price,
          quantity: exitRec.quantity,
        });
        await this.liveDeploymentSync?.onPositionClosed(symbol, {
          side: exitRec.side,
          quantity: exitRec.quantity,
          exitPrice: exitRec.price,
          exitTime: exitRec.timestamp,
          entryPrice: exitRec.positionEntryPrice ?? exitRec.price,
          entryTime: exitRec.positionEntryTime ?? exitRec.timestamp,
          risk: this.lastEntryRisk.get(symbol) ?? 0,
          exitType: 'signal',
        });
        this.lastEntryRisk.delete(symbol);
        await this.tryEntry(symbol, strategy, stock, candle.dateUnix);
      } else {
        const errMsg = safeErrorMessage(result.error);
        this.logger.error('Exit position failed', {
          flow: 'exit_result',
          symbol,
          success: false,
          error: errMsg,
          exitPrice: signal.price,
        });
        await this.persistLiveEvent('exit_failed', symbol, errMsg, { price: signal.price, reason: signal.reason });
      }
      return;
    }

    if (signal.action === 'BUY' || signal.action === 'SELL') {
      this.logger.info('Place order request', {
        flow: 'order_place_request',
        symbol,
        action: signal.action,
        price: signal.price,
        stopLoss: signal.stopLoss,
        risk: signal.risk,
      });
      const result = await Promise.resolve(this.broker.placeOrder(symbol, signal, candle.dateUnix));
      if (result.ok) {
        const pos = result.value;
        this.lastEntryRisk.set(symbol, signal.risk);
        const entryRecord: TradeEntry = {
          timestamp: candle.dateUnix,
          symbol,
          side: pos.side,
          price: pos.entryPrice,
          quantity: pos.quantity,
          risk: signal.risk,
          type: 'ENTRY',
        };
        this.store.recordTrade(entryRecord);
        this.logger.info('Order placed success', {
          flow: 'order_place_result',
          symbol,
          success: true,
          side: pos.side,
          entryPrice: pos.entryPrice,
          quantity: pos.quantity,
          stopLoss: pos.stopLoss,
        });
        this.logger.info('Trade recorded (in-memory)', {
          flow: 'trade_recorded',
          type: 'ENTRY',
          symbol,
          side: pos.side,
          price: pos.entryPrice,
          quantity: pos.quantity,
        });
        await this.liveDeploymentSync?.onPositionOpened(symbol, pos);
      } else {
        const errMsg = safeErrorMessage(result.error);
        this.logger.error('Order placement failed', {
          flow: 'order_place_result',
          symbol,
          success: false,
          action: signal.action,
          error: errMsg,
        });
        await this.persistLiveEvent('order_failed', symbol, errMsg, {
          action: signal.action,
          price: signal.price,
          stopLoss: signal.stopLoss,
        });
      }
    }
  }

  private async tryEntry(
    symbol: string,
    strategy: IStrategy,
    stock: import('../market/OHLCStorage.js').OHLCStorage,
    timestamp: number,
  ): Promise<void> {
    const signal = strategy.evaluate(stock, null);
    if (!signal || signal.action === 'EXIT') return;

    if (signal.action === 'BUY' || signal.action === 'SELL') {
      this.logger.info('Reversal entry request', {
        flow: 'order_place_request',
        context: 'reversal',
        symbol,
        action: signal.action,
        price: signal.price,
        stopLoss: signal.stopLoss,
      });
      const result = await Promise.resolve(this.broker.placeOrder(symbol, signal, timestamp));
      if (result.ok) {
        const pos = result.value;
        this.lastEntryRisk.set(symbol, signal.risk);
        const entryRecord: TradeEntry = {
          timestamp,
          symbol,
          side: pos.side,
          price: pos.entryPrice,
          quantity: pos.quantity,
          risk: signal.risk,
          type: 'ENTRY',
        };
        this.store.recordTrade(entryRecord);
        this.logger.info('Reversal entry success', {
          flow: 'order_place_result',
          context: 'reversal',
          symbol,
          side: pos.side,
          entryPrice: pos.entryPrice,
          quantity: pos.quantity,
        });
        this.logger.info('Trade recorded (in-memory)', {
          flow: 'trade_recorded',
          type: 'ENTRY',
          context: 'reversal',
          symbol,
          side: pos.side,
          price: pos.entryPrice,
          quantity: pos.quantity,
        });
        await this.liveDeploymentSync?.onPositionOpened(symbol, pos);
      } else {
        const errMsg = safeErrorMessage(result.error);
        this.logger.error('Reversal order failed', {
          flow: 'order_place_result',
          context: 'reversal',
          symbol,
          action: signal.action,
          error: errMsg,
        });
        await this.persistLiveEvent('order_failed', symbol, errMsg, {
          context: 'reversal',
          action: signal.action,
          price: signal.price,
        });
      }
    }
  }

  get processedCandles(): number {
    return this.candleCount;
  }
}
