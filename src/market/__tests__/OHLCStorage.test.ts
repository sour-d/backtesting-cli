import { describe, it, expect } from 'vitest';
import { OHLCStorage } from '../OHLCStorage.js';
import type { EnrichedCandle } from '../../types/index.js';

function makeCandle(close: number, i = 0): EnrichedCandle {
  return {
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    time: '00:00:00',
    dateUnix: 1700000000000 + i * 86400000,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1000,
  };
}

const candles = [makeCandle(100, 0), makeCandle(102, 1), makeCandle(98, 2), makeCandle(105, 3)];

describe('OHLCStorage', () => {
  it('should return current candle with now()', () => {
    const storage = new OHLCStorage(candles, 0);
    expect(storage.now().close).toBe(100);
  });

  it('should advance cursor and return next candle', () => {
    const storage = new OHLCStorage(candles, 0);
    expect(storage.advance()).toBe(true);
    expect(storage.now().close).toBe(102);
  });

  it('should return undefined for prev() when at start', () => {
    const storage = new OHLCStorage(candles, 0);
    expect(storage.prev()).toBeUndefined();
  });

  it('should return previous candle with prev()', () => {
    const storage = new OHLCStorage(candles, 1);
    expect(storage.prev()?.close).toBe(100);
  });

  it('should return prev(2) for two candles back', () => {
    const storage = new OHLCStorage(candles, 2);
    expect(storage.prev(2)?.close).toBe(100);
  });

  it('should report hasNext correctly', () => {
    const storage = new OHLCStorage(candles, 2);
    expect(storage.hasNext()).toBe(true);
    storage.advance();
    expect(storage.hasNext()).toBe(false);
  });

  it('should not advance past end', () => {
    const storage = new OHLCStorage(candles, 3);
    expect(storage.advance()).toBe(false);
    expect(storage.now().close).toBe(105);
  });

  it('should append new candles and auto-advance cursor', () => {
    const storage = new OHLCStorage([candles[0]!], 0);
    expect(storage.hasNext()).toBe(false);

    storage.append(candles[1]!);
    expect(storage.now().close).toBe(102);
    expect(storage.prev()?.close).toBe(100);
    expect(storage.length).toBe(2);
  });

  it('should track length and remaining', () => {
    const storage = new OHLCStorage(candles, 1);
    expect(storage.length).toBe(4);
    expect(storage.remaining).toBe(2);
  });

  it('should slice recent candles', () => {
    const storage = new OHLCStorage(candles, 2);
    const recent = storage.slice(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.close).toBe(102);
    expect(recent[1]!.close).toBe(98);
  });

  it('should reset cursor', () => {
    const storage = new OHLCStorage(candles, 3);
    storage.reset(0);
    expect(storage.now().close).toBe(100);
  });

  it('should not mutate original array', () => {
    const original = [makeCandle(50)];
    const storage = new OHLCStorage(original, 0);
    storage.append(makeCandle(60));
    expect(original).toHaveLength(1);
  });
});
