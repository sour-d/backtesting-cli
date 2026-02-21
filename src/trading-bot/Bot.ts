import type { Candle, TradeEntry } from '../types/index.js';
import type { Market } from '../market/Market.js';
import type { IBroker } from '../broker/IBroker.js';
import type { IStore } from '../store/IStore.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStrategy } from '../strategy/IStrategy.js';

export interface BotDeps {
  market: Market;
  broker: IBroker;
  store: IStore;
  logger: ILogger;
  strategyMap: ReadonlyMap<string, IStrategy>;
  warmupPeriod?: number;
}

export class Bot {
  private readonly market: Market;
  private readonly broker: IBroker;
  private readonly store: IStore;
  private readonly logger: ILogger;
  private readonly strategyMap: ReadonlyMap<string, IStrategy>;
  private readonly warmupPeriod: number;
  private readonly symbolCandleCount: Map<string, number> = new Map();
  private candleCount = 0;

  constructor(deps: BotDeps) {
    this.market = deps.market;
    this.broker = deps.broker;
    this.store = deps.store;
    this.logger = deps.logger;
    this.strategyMap = deps.strategyMap;
    this.warmupPeriod = deps.warmupPeriod ?? 20;
  }

  onCandle(symbol: string, candle: Candle): void {
    this.candleCount++;
    const symbolCount = (this.symbolCandleCount.get(symbol) ?? 0) + 1;
    this.symbolCandleCount.set(symbol, symbolCount);

    this.market.update(symbol, candle);

    if (symbolCount <= this.warmupPeriod) return;

    const stock = this.market.getStock(symbol);
    const strategy = this.strategyMap.get(symbol);
    if (!strategy) return;

    const slEntry = this.broker.checkStopLoss(symbol, candle);
    if (slEntry) {
      this.store.recordTrade(slEntry);
      this.logger.info('Stop-loss triggered', { symbol, price: slEntry.price });
      return;
    }

    const position = this.broker.getPosition(symbol);
    const signal = strategy.evaluate(stock, position);

    if (!signal) return;

    if (signal.action === 'EXIT') {
      const result = this.broker.exitPosition(symbol, signal.price, candle.dateUnix);
      if (result.ok) {
        this.store.recordTrade(result.value);
        this.logger.info('Position exited', { symbol, price: signal.price, reason: signal.reason });

        this.tryEntry(symbol, strategy, stock, candle.dateUnix);
      }
      return;
    }

    if (signal.action === 'BUY' || signal.action === 'SELL') {
      const result = this.broker.placeOrder(symbol, signal, candle.dateUnix);
      if (result.ok) {
        const entryRecord: TradeEntry = {
          timestamp: candle.dateUnix,
          symbol,
          side: result.value.side,
          price: result.value.entryPrice,
          quantity: result.value.quantity,
          risk: signal.risk,
          type: 'ENTRY',
        };
        this.store.recordTrade(entryRecord);
        this.logger.info('Order placed', {
          symbol,
          side: result.value.side,
          price: result.value.entryPrice,
          quantity: result.value.quantity,
        });
      }
    }
  }

  private tryEntry(
    symbol: string,
    strategy: IStrategy,
    stock: import('../market/OHLCStorage.js').OHLCStorage,
    timestamp: number,
  ): void {
    const signal = strategy.evaluate(stock, null);
    if (!signal || signal.action === 'EXIT') return;

    if (signal.action === 'BUY' || signal.action === 'SELL') {
      const result = this.broker.placeOrder(symbol, signal, timestamp);
      if (result.ok) {
        const entryRecord: TradeEntry = {
          timestamp,
          symbol,
          side: result.value.side,
          price: result.value.entryPrice,
          quantity: result.value.quantity,
          risk: signal.risk,
          type: 'ENTRY',
        };
        this.store.recordTrade(entryRecord);
        this.logger.info('Reversal entry', {
          symbol,
          side: result.value.side,
          price: result.value.entryPrice,
        });
      }
    }
  }

  get processedCandles(): number {
    return this.candleCount;
  }
}
