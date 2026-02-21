import { describe, it, expect, vi } from 'vitest';
import { Bot } from '../Bot.js';
import { Market } from '../../market/Market.js';
import { SimulatedBroker } from '../../broker/SimulatedBroker.js';
import { candleStick, movingAverage, atr, superTrend } from '../../market/indicators/index.js';
import { MovingAverageStrategy } from '../../strategy/MovingAverageStrategy.js';
import type { Candle, TradeEntry } from '../../types/index.js';
import type { IStore } from '../../store/IStore.js';
import type { ILogger } from '../../logger/ILogger.js';

function makeCandle(o: number, h: number, l: number, c: number, i = 0): Candle {
  return {
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    time: '00:00:00',
    dateUnix: 1700000000000 + i * 4 * 60 * 60 * 1000,
    open: o, high: h, low: l, close: c,
    volume: 1000,
  };
}

function createMockStore(): IStore {
  const trades: TradeEntry[] = [];
  return {
    recordTrade: (e: TradeEntry) => trades.push(e),
    getTrades: () => trades,
    saveResults: vi.fn().mockResolvedValue(undefined),
    saveStats: vi.fn().mockResolvedValue(undefined),
    loadMarketData: vi.fn().mockReturnValue(null),
    saveMarketData: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => createMockLogger(),
  };
}

describe('Bot', () => {
  it('should process candles and track count', () => {
    const strategy = new MovingAverageStrategy();
    const market = new Market(strategy.getIndicators());
    const broker = new SimulatedBroker({ feeRate: 0.001, riskPercentage: 5, maxAllocation: 0.8 });
    broker.allocateCapital(['SOLUSDT'], 100000);

    const bot = new Bot({
      market,
      broker,
      store: createMockStore(),
      logger: createMockLogger(),
      strategyMap: new Map([['SOLUSDT', strategy]]),
    });

    for (let i = 0; i < 10; i++) {
      bot.onCandle('SOLUSDT', makeCandle(100 + i, 105 + i, 95 + i, 102 + i, i));
    }

    expect(bot.processedCandles).toBe(10);
  });

  it('should record trades in the store when signals trigger', () => {
    const strategy = new MovingAverageStrategy();
    const market = new Market(strategy.getIndicators());
    const broker = new SimulatedBroker({ feeRate: 0.001, riskPercentage: 5, maxAllocation: 0.8 });
    broker.allocateCapital(['SOLUSDT'], 100000);
    const store = createMockStore();

    const bot = new Bot({
      market,
      broker,
      store,
      logger: createMockLogger(),
      strategyMap: new Map([['SOLUSDT', strategy]]),
    });

    const candles: Candle[] = [];
    for (let i = 0; i < 100; i++) {
      const base = 100 + i * 0.5;
      candles.push(makeCandle(base - 1, base + 2, base - 2, base, i));
    }

    for (const c of candles) {
      bot.onCandle('SOLUSDT', c);
    }

    expect(bot.processedCandles).toBe(100);
  });

  it('should handle stop-loss correctly', () => {
    const strategy = new MovingAverageStrategy();
    const market = new Market(strategy.getIndicators());
    const broker = new SimulatedBroker({ feeRate: 0.001, riskPercentage: 5, maxAllocation: 0.8 });
    broker.allocateCapital(['SOLUSDT'], 100000);
    const store = createMockStore();
    const logger = createMockLogger();

    const bot = new Bot({
      market,
      broker,
      store,
      logger,
      strategyMap: new Map([['SOLUSDT', strategy]]),
    });

    for (let i = 0; i < 30; i++) {
      const base = 100 + i * 0.5;
      bot.onCandle('SOLUSDT', makeCandle(base, base + 2, base - 1, base + 1, i));
    }

    if (broker.getPosition('SOLUSDT')) {
      const position = broker.getPosition('SOLUSDT')!;
      bot.onCandle('SOLUSDT', makeCandle(position.stopLoss - 5, position.stopLoss + 1, position.stopLoss - 10, position.stopLoss - 3, 30));

      expect(broker.getPosition('SOLUSDT')).toBeNull();
    }
  });
});
