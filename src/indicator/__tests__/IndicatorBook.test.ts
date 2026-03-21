import { describe, expect, it } from 'vitest';
import { IndicatorBook } from '../IndicatorBook.js';

describe('IndicatorBook', () => {
  it('adds candles and computes registered indicators', () => {
    const book = new IndicatorBook();
    book.registerIndicator('lastClose', {
      compute: (candles) => candles[candles.length - 1]?.close ?? null,
    });
    book.addCandle({
      dateUnix: 1,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
    });
    expect(book.getIndicatorValue('lastClose')).toBe(1.5);
    expect(book.getCandles(10)).toHaveLength(1);
  });
});
