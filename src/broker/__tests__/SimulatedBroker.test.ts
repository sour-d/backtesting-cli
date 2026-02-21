import { describe, it, expect } from 'vitest';
import { SimulatedBroker } from '../SimulatedBroker.js';
import type { Candle, Signal } from '../../types/index.js';

const brokerConfig = {
  feeRate: 0.001,
  riskPercentage: 5,
  maxAllocation: 0.8,
};

const TS = 1700000000000;

function makeBuySignal(price: number): Signal & { action: 'BUY' } {
  return { action: 'BUY', price, stopLoss: price * 0.96, risk: price * 0.04 };
}

function makeSellSignal(price: number): Signal & { action: 'SELL' } {
  return { action: 'SELL', price, stopLoss: price * 1.04, risk: price * 0.04 };
}

function makeCandle(h: number, l: number, c: number): Candle {
  return {
    date: '2026-01-01', time: '00:00:00', dateUnix: TS,
    open: c, high: h, low: l, close: c, volume: 1000,
  };
}

describe('SimulatedBroker', () => {
  it('should allocate capital equally across symbols', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['BTCUSDT', 'ETHUSDT'], 10000);

    expect(broker.getCapital('BTCUSDT')).toBe(5000);
    expect(broker.getCapital('ETHUSDT')).toBe(5000);
  });

  it('should place a long order and deduct capital', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['SOLUSDT'], 100000);

    const result = broker.placeOrder('SOLUSDT', makeBuySignal(100), TS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.side).toBe('Buy');
      expect(result.value.entryPrice).toBe(100);
      expect(result.value.quantity).toBeGreaterThan(0);
      expect(result.value.entryTime).toBe(TS);
    }
    expect(broker.getCapital('SOLUSDT')).toBeLessThan(100000);
  });

  it('should not allow duplicate position in same symbol', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['SOLUSDT'], 100000);
    broker.placeOrder('SOLUSDT', makeBuySignal(100), TS);

    const second = broker.placeOrder('SOLUSDT', makeBuySignal(110), TS);
    expect(second.ok).toBe(false);
  });

  it('should exit a long position and return capital + profit', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['SOLUSDT'], 100000);

    broker.placeOrder('SOLUSDT', makeBuySignal(100), TS);
    const capitalAfterEntry = broker.getCapital('SOLUSDT');

    const result = broker.exitPosition('SOLUSDT', 110, TS + 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.timestamp).toBe(TS + 1000);
    }
    expect(broker.getCapital('SOLUSDT')).toBeGreaterThan(capitalAfterEntry);
    expect(broker.getPosition('SOLUSDT')).toBeNull();
  });

  it('should exit a short position correctly', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['SOLUSDT'], 100000);

    broker.placeOrder('SOLUSDT', makeSellSignal(100), TS);
    const result = broker.exitPosition('SOLUSDT', 90, TS + 1000);
    expect(result.ok).toBe(true);
    expect(broker.getCapital('SOLUSDT')).toBeGreaterThan(0);
  });

  it('should trigger stop loss for long position', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['SOLUSDT'], 100000);
    broker.placeOrder('SOLUSDT', makeBuySignal(100), TS);

    const candle = makeCandle(101, 95, 96);
    const slEntry = broker.checkStopLoss('SOLUSDT', candle);

    expect(slEntry).not.toBeNull();
    expect(slEntry!.type).toBe('STOP_LOSS');
    expect(broker.getPosition('SOLUSDT')).toBeNull();
  });

  it('should trigger stop loss for short position', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['SOLUSDT'], 100000);
    broker.placeOrder('SOLUSDT', makeSellSignal(100), TS);

    const candle = makeCandle(105, 99, 104);
    const slEntry = broker.checkStopLoss('SOLUSDT', candle);

    expect(slEntry).not.toBeNull();
    expect(slEntry!.type).toBe('STOP_LOSS');
  });

  it('should not trigger stop loss when price within range', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['SOLUSDT'], 100000);
    broker.placeOrder('SOLUSDT', makeBuySignal(100), TS);

    const candle = makeCandle(102, 97, 101);
    const slEntry = broker.checkStopLoss('SOLUSDT', candle);
    expect(slEntry).toBeNull();
  });

  it('should compute total equity including open positions', () => {
    const broker = new SimulatedBroker(brokerConfig);
    broker.allocateCapital(['SOLUSDT'], 100000);
    broker.placeOrder('SOLUSDT', makeBuySignal(100), TS);

    const prices = new Map([['SOLUSDT', 110]]);
    const equity = broker.getTotalEquity(prices);
    expect(equity).toBeGreaterThan(100000);
  });
});
