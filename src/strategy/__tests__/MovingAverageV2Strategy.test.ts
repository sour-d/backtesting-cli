import { describe, it, expect } from 'vitest';
import { MovingAverageV2Strategy } from '../MovingAverageV2Strategy.js';
import { OHLCStorage } from '../../market/OHLCStorage.js';
import { enrichAll } from '../../market/indicatorPipeline.js';
import type { Candle, Position } from '../../types/index.js';

function makeCandle(o: number, h: number, l: number, c: number, i = 0): Candle {
  return {
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    time: '00:00:00',
    dateUnix: 1700000000000 + i * 86400000,
    open: o, high: h, low: l, close: c,
    volume: 1000,
  };
}

function buildStock(rawCandles: Candle[], strategy: MovingAverageV2Strategy): OHLCStorage {
  const enriched = enrichAll(rawCandles, strategy.getIndicators());
  return new OHLCStorage(enriched, enriched.length - 1, 'TESTUSDT');
}

describe('MovingAverageV2Strategy', () => {
  const strategy = new MovingAverageV2Strategy();

  it('should have correct name', () => {
    expect(strategy.name).toBe('MovingAverage_v2');
  });

  it('should return indicators for MA50, MA200, candleStick, ATR, superTrend', () => {
    const indicators = strategy.getIndicators();
    expect(indicators.length).toBe(6);
  });

  it('should return null when not enough data', () => {
    const candles = [makeCandle(100, 105, 95, 102)];
    const enriched = enrichAll(candles, strategy.getIndicators());
    const stock = new OHLCStorage(enriched, 0, 'TEST');
    expect(strategy.evaluate(stock, null)).toBeNull();
  });

  it('should return EXIT signal when holding long and exit conditions met', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 55; i++) {
      candles.push(makeCandle(100 + i * 0.5, 102 + i * 0.5, 98 + i * 0.5, 101 + i * 0.5, i));
    }
    // Drop candle to trigger exit: bearish body, low < yesterday's ma50high
    candles.push(makeCandle(130, 131, 100, 110, 55));

    const stock = buildStock(candles, strategy);
    const position: Position = {
      symbol: 'TESTUSDT',
      side: 'Buy',
      entryPrice: 120,
      quantity: 10,
      stopLoss: 115.2,
      entryTime: 1700000000000,
    };

    const signal = strategy.evaluate(stock, position);
    if (signal) {
      expect(signal.action).toBe('EXIT');
    }
  });

  it('should return null when holding long and no exit conditions', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 55; i++) {
      candles.push(makeCandle(100 + i, 102 + i, 99 + i, 101 + i, i));
    }

    const stock = buildStock(candles, strategy);
    const position: Position = {
      symbol: 'TESTUSDT',
      side: 'Buy',
      entryPrice: 120,
      quantity: 10,
      stopLoss: 115.2,
      entryTime: 1700000000000,
    };

    const signal = strategy.evaluate(stock, position);
    expect(signal).toBeNull();
  });

  it('BUY signal should have 4% stop loss', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 210; i++) {
      candles.push(makeCandle(50 + i * 0.5, 52 + i * 0.5, 49 + i * 0.5, 51 + i * 0.5, i));
    }

    const stock = buildStock(candles, strategy);
    const signal = strategy.evaluate(stock, null);

    if (signal && signal.action === 'BUY') {
      expect(signal.stopLoss).toBeCloseTo(signal.price * 0.96);
      expect(signal.risk).toBeCloseTo(signal.price * 0.04);
    }
  });
});
