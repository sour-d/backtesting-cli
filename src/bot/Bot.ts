import { randomUUID } from 'node:crypto';
import type { EnrichedCandle } from '../core/types.js';
import type { TradeRecord } from '../core/types.js';
import type { DeploymentState } from '../deployment/types.js';
import { Instrument } from '../instrument/Instrument.js';
import { IndicatorBook } from '../indicator/IndicatorBook.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IMarketRuntime } from '../market-runtime/IMarketRuntime.js';
import type { IBroker } from '../broker/IBroker.js';
import type { IStore } from '../store/IStore.js';
import type { IStrategy } from '../strategy/IStrategy.js';
import type { StrategyRegistry } from '../strategy/StrategyRegistry.js';
import type { TradingSignal } from '../strategy/types.js';

export interface DeployRequest {
  readonly id: string;
  readonly symbol: string;
  readonly strategyId: string;
  readonly capital: number;
}

export interface BotDeps {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly broker: IBroker;
  readonly marketRuntime: IMarketRuntime;
  readonly strategies: StrategyRegistry;
}

/**
 * Strategy runtime + deployment persistence. Does not own market ingress — only reacts to candles.
 */
export class Bot {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly broker: IBroker;
  private readonly marketRuntime: IMarketRuntime;
  private readonly registry: StrategyRegistry;
  private readonly active = new Map<string, IStrategy>();

  constructor(deps: BotDeps) {
    this.logger = deps.logger;
    this.store = deps.store;
    this.broker = deps.broker;
    this.marketRuntime = deps.marketRuntime;
    this.registry = deps.strategies;
  }

  async deploy(req: DeployRequest): Promise<void> {
    const strategyClass = this.registry.resolve(req.strategyId);
    if (!strategyClass) {
      throw new Error(`Unknown strategyId: ${req.strategyId}`);
    }

    const spec = await this.marketRuntime.fetchInstrumentStatic(req.symbol);
    const instrument = new Instrument(spec, new IndicatorBook());
    instrument.setCapitalAllocation(req.capital, req.capital);
    await this.marketRuntime.registerInstrument(instrument);

    const strategy = strategyClass({ logger: this.logger, symbol: req.symbol });
    this.active.set(req.symbol, strategy);

    const state: DeploymentState = {
      id: req.id,
      symbol: req.symbol,
      strategyId: req.strategyId,
      capital: req.capital,
      createdAt: Date.now(),
      status: 'active',
    };
    await this.store.saveDeployment(state);
    this.logger.info('Deployed', { id: req.id, symbol: req.symbol, strategyId: req.strategyId });
  }

  async restoreDeployments(): Promise<void> {
    const rows = await this.store.loadDeployments();
    const live = rows.filter((r) => r.status === 'active');
    for (const d of live) {
      const strategyClass = this.registry.resolve(d.strategyId);
      if (!strategyClass) {
        this.logger.error('Skipping deployment — unknown strategy', {
          id: d.id,
          strategyId: d.strategyId,
        });
        continue;
      }
      const spec = await this.marketRuntime.fetchInstrumentStatic(d.symbol);
      const instrument = new Instrument(spec, new IndicatorBook());
      instrument.setCapitalAllocation(d.capital, d.capital);
      await this.marketRuntime.registerInstrument(instrument);

      this.active.set(d.symbol, strategyClass({ logger: this.logger, symbol: d.symbol }));
      this.logger.info('Restored deployment', { id: d.id, symbol: d.symbol });
    }
  }

  async onCandle(instrument: Instrument, candle: EnrichedCandle): Promise<void> {
    const strategy = this.active.get(instrument.symbol);
    if (!strategy) return;

    const signal = await strategy.evaluate(instrument, candle);
    await this.dispatch(instrument, candle, signal);
  }

  private async dispatch(
    instrument: Instrument,
    candle: EnrichedCandle,
    signal: TradingSignal,
  ): Promise<void> {
    if (signal.action === 'HOLD') return;

    if (signal.action === 'CLOSE') {
      const exitSide = instrument.getCloseOrderSide();
      if (!exitSide) {
        this.logger.debug('CLOSE ignored — flat position', { symbol: instrument.symbol });
        return;
      }
      const exitQty = Math.abs(instrument.currentPositionQty);
      await this.broker.closePosition(instrument.symbol);
      await this.persistTrade({
        instrument,
        candle,
        kind: 'exit',
        qty: exitQty,
        price: candle.close,
        side: exitSide,
      });
      this.logger.info('Signal CLOSE executed', { symbol: instrument.symbol });
      return;
    }

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
      price: signal.price ?? candle.close,
      side,
    });
    this.logger.info('Signal executed', {
      symbol: instrument.symbol,
      action: signal.action,
      qty: signal.qty,
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
    const rec: TradeRecord = {
      id: randomUUID(),
      symbol: params.instrument.symbol,
      side: params.side,
      qty: params.qty,
      price: params.price,
      fee: 0,
      timestamp: params.candle.dateUnix,
      kind: params.kind,
    };
    await this.store.saveTrade(rec);
  }
}
