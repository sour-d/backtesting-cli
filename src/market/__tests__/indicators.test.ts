import { describe, it, expect } from 'vitest';
import { candleStick } from '../indicators/candleStick.js';
import { movingAverage } from '../indicators/movingAverage.js';
import { atr } from '../indicators/atr.js';
import { ema } from '../indicators/ema.js';
import { bollingerBands } from '../indicators/bollingerBands.js';
import { enrichAll } from '../indicatorPipeline.js';
import type { Candle, EnrichedCandle } from '../../types/index.js';

function makeCandle(o: number, h: number, l: number, c: number, i = 0): Candle {
  return {
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    time: '00:00:00',
    dateUnix: 1700000000000 + i * 86400000,
    open: o, high: h, low: l, close: c,
    volume: 1000 + i * 100,
  };
}

describe('candleStick', () => {
  const fn = candleStick();

  it('should compute body as close - open', () => {
    const candles: EnrichedCandle[] = [makeCandle(100, 110, 95, 108)];
    const result = fn(candles, 0);
    expect(result['body']).toBe(8);
  });

  it('should compute correct wicks for bullish candle', () => {
    const candles: EnrichedCandle[] = [makeCandle(100, 115, 95, 110)];
    const result = fn(candles, 0);
    expect(result['upperWick']).toBe(5);
    expect(result['lowerWick']).toBe(5);
  });

  it('should compute correct wicks for bearish candle', () => {
    const candles: EnrichedCandle[] = [makeCandle(110, 115, 95, 100)];
    const result = fn(candles, 0);
    expect(result['upperWick']).toBe(5);
    expect(result['lowerWick']).toBe(5);
  });

  it('should have negative body for bearish candle', () => {
    const candles: EnrichedCandle[] = [makeCandle(110, 115, 95, 100)];
    const result = fn(candles, 0);
    expect(result['body']).toBe(-10);
  });
});

describe('movingAverage', () => {
  const candles: EnrichedCandle[] = [
    makeCandle(10, 12, 9, 11, 0),
    makeCandle(11, 13, 10, 12, 1),
    makeCandle(12, 14, 11, 13, 2),
    makeCandle(13, 15, 12, 14, 3),
    makeCandle(14, 16, 13, 15, 4),
  ];

  it('should compute MA over full period (excluding current candle, dividing by period)', () => {
    const fn = movingAverage(3, 'close');
    const result = fn(candles, 4);
    expect(result['ma3close']).toBeCloseTo((12 + 13 + 14) / 3);
  });

  it('should use available data but divide by period when fewer candles exist', () => {
    const fn = movingAverage(10, 'close');
    const result = fn(candles, 2);
    expect(result['ma10close']).toBeCloseTo((11 + 12) / 10);
  });

  it('should accept custom output key', () => {
    const fn = movingAverage(3, 'high', 'myMA');
    const result = fn(candles, 3);
    expect(result['myMA']).toBeDefined();
  });

  it('should work with "high" source (excludes current candle)', () => {
    const fn = movingAverage(2, 'high');
    const result = fn(candles, 2);
    expect(result['ma2high']).toBeCloseTo((12 + 13) / 2);
  });
});

describe('atr', () => {
  it('should compute first candle ATR as TR * k (EMA with prevAtr=0)', () => {
    const candles: EnrichedCandle[] = [makeCandle(100, 110, 90, 105)];
    const fn = atr(10);
    const k = 2 / 11;
    const result = fn(candles, 0);
    expect(result['trValue']).toBe(20);
    expect(result['atr']).toBeCloseTo(20 * k);
  });

  it('should use EMA smoothing for subsequent candles', () => {
    const candles = enrichAll(
      [makeCandle(100, 110, 90, 105, 0), makeCandle(105, 108, 103, 106, 1)],
      [atr(10)],
    );
    const k = 2 / 11;
    const firstAtr = candles[0]!['atr'] as number;
    const secondAtr = candles[1]!['atr'] as number;
    expect(firstAtr).toBeCloseTo(20 * k);
    expect(secondAtr).toBeGreaterThan(0);
  });

  it('should consider previous close for true range', () => {
    const candles = enrichAll(
      [makeCandle(100, 110, 90, 105, 0), makeCandle(105, 106, 104, 105, 1)],
      [atr(10)],
    );
    const tr = candles[1]!['trValue'] as number;
    expect(tr).toBe(2);
  });
});

describe('ema', () => {
  it('should use close for first period as SMA seed', () => {
    const candles = enrichAll(
      [
        makeCandle(10, 12, 9, 10, 0),
        makeCandle(10, 12, 9, 12, 1),
        makeCandle(10, 12, 9, 11, 2),
      ],
      [ema(3)],
    );
    const emaVal = candles[2]!['ema3'] as number;
    expect(emaVal).toBeCloseTo((10 + 12 + 11) / 3);
  });

  it('should apply EMA smoothing after seed', () => {
    const candles = enrichAll(
      [
        makeCandle(10, 12, 9, 10, 0),
        makeCandle(10, 12, 9, 12, 1),
        makeCandle(10, 12, 9, 11, 2),
        makeCandle(10, 12, 9, 14, 3),
      ],
      [ema(3)],
    );
    const ema3 = candles[2]!['ema3'] as number;
    const ema4 = candles[3]!['ema3'] as number;
    const k = 2 / 4;
    expect(ema4).toBeCloseTo(14 * k + ema3 * (1 - k));
  });
});

describe('bollingerBands', () => {
  const candles: Candle[] = Array.from({ length: 20 }, (_, i) =>
    makeCandle(100 + i, 102 + i, 98 + i, 100 + i, i),
  );

  it('should compute middle band as SMA', () => {
    const enriched = enrichAll(candles, [bollingerBands(5, 2)]);
    const last = enriched[19]!;
    const expectedMean = (115 + 116 + 117 + 118 + 119) / 5;
    expect(last['bbMiddle'] as number).toBeCloseTo(expectedMean);
  });

  it('should have upper > middle > lower', () => {
    const enriched = enrichAll(candles, [bollingerBands(5, 2)]);
    const last = enriched[19]!;
    expect(last['bbUpper'] as number).toBeGreaterThan(last['bbMiddle'] as number);
    expect(last['bbMiddle'] as number).toBeGreaterThan(last['bbLower'] as number);
  });
});
