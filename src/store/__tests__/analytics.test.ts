import { describe, it, expect } from 'vitest';
import { aggregateTrades, computeStats } from '../analytics.js';
import type { TradeEntry } from '../../types/index.js';

function entry(symbol: string, side: 'Buy' | 'Sell', price: number, qty: number, risk: number, ts: number): TradeEntry {
  return { timestamp: ts, symbol, side, price, quantity: qty, risk, type: 'ENTRY' };
}

function exit(symbol: string, side: 'Buy' | 'Sell', price: number, qty: number, ts: number): TradeEntry {
  return { timestamp: ts, symbol, side, price, quantity: qty, risk: 0, type: 'EXIT' };
}

describe('aggregateTrades', () => {
  it('should pair entry and exit into one aggregated trade', () => {
    const entries: TradeEntry[] = [
      entry('SOLUSDT', 'Buy', 100, 10, 4, 1000),
      exit('SOLUSDT', 'Buy', 110, 10, 2000),
    ];

    const trades = aggregateTrades(entries, { feeRate: 0.001, capital: 100000 });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.entryPrice).toBe(100);
    expect(trades[0]!.exitPrice).toBe(110);
    expect(trades[0]!.grossPnL).toBe(100);
    expect(trades[0]!.result).toBe('Profit');
  });

  it('should calculate loss correctly', () => {
    const entries: TradeEntry[] = [
      entry('SOLUSDT', 'Buy', 100, 10, 4, 1000),
      exit('SOLUSDT', 'Buy', 90, 10, 2000),
    ];

    const trades = aggregateTrades(entries, { feeRate: 0, capital: 100000 });
    expect(trades[0]!.grossPnL).toBe(-100);
    expect(trades[0]!.result).toBe('Loss');
  });

  it('should calculate short trade P&L correctly', () => {
    const entries: TradeEntry[] = [
      entry('SOLUSDT', 'Sell', 100, 10, 4, 1000),
      exit('SOLUSDT', 'Sell', 80, 10, 2000),
    ];

    const trades = aggregateTrades(entries, { feeRate: 0, capital: 100000 });
    expect(trades[0]!.grossPnL).toBe(200);
    expect(trades[0]!.result).toBe('Profit');
  });

  it('should calculate fees', () => {
    const entries: TradeEntry[] = [
      entry('SOLUSDT', 'Buy', 100, 10, 4, 1000),
      exit('SOLUSDT', 'Buy', 110, 10, 2000),
    ];

    const trades = aggregateTrades(entries, { feeRate: 0.001, capital: 100000 });
    const expectedFee = (10 * 100 + 10 * 110) * 0.001;
    expect(trades[0]!.fee).toBeCloseTo(expectedFee);
  });

  it('should track drawdown across multiple trades', () => {
    const entries: TradeEntry[] = [
      entry('SOL', 'Buy', 100, 10, 4, 1000),
      exit('SOL', 'Buy', 110, 10, 2000),
      entry('SOL', 'Buy', 115, 10, 4, 3000),
      exit('SOL', 'Buy', 105, 10, 4000),
    ];

    const trades = aggregateTrades(entries, { feeRate: 0, capital: 100000 });
    expect(trades[0]!.drawdown).toBe(0);
    expect(trades[1]!.drawdown).toBeLessThan(0);
  });
});

describe('computeStats', () => {
  it('should return empty stats for no trades', () => {
    const stats = computeStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
  });

  it('should compute win rate correctly', () => {
    const entries: TradeEntry[] = [
      entry('SOL', 'Buy', 100, 10, 4, 1000),
      exit('SOL', 'Buy', 110, 10, 2000),
      entry('SOL', 'Buy', 110, 10, 4, 3000),
      exit('SOL', 'Buy', 100, 10, 4000),
    ];

    const trades = aggregateTrades(entries, { feeRate: 0, capital: 100000 });
    const stats = computeStats(trades);
    expect(stats.totalTrades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(50);
  });

  it('should track consecutive wins and losses', () => {
    const entries: TradeEntry[] = [
      entry('SOL', 'Buy', 100, 10, 4, 1000), exit('SOL', 'Buy', 110, 10, 2000),
      entry('SOL', 'Buy', 110, 10, 4, 3000), exit('SOL', 'Buy', 120, 10, 4000),
      entry('SOL', 'Buy', 120, 10, 4, 5000), exit('SOL', 'Buy', 115, 10, 6000),
    ];

    const trades = aggregateTrades(entries, { feeRate: 0, capital: 100000 });
    const stats = computeStats(trades);
    expect(stats.maxConsecutiveWins).toBe(2);
    expect(stats.maxConsecutiveLosses).toBe(1);
  });
});
