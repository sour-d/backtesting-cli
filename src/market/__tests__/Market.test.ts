import { describe, it, expect } from 'vitest';
import { Market } from '../Market.js';
import { candleStick } from '../indicators/candleStick.js';
import { movingAverage } from '../indicators/movingAverage.js';
import type { Candle } from '../../types/index.js';

function makeCandle(close: number, i = 0): Candle {
  return {
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    time: '00:00:00',
    dateUnix: 1700000000000 + i * 86400000,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000,
  };
}

describe('Market', () => {
  it('should register a symbol and enrich historical data', () => {
    const market = new Market([candleStick()]);
    const history = [makeCandle(100, 0), makeCandle(105, 1)];

    market.registerSymbol('BTCUSDT', history);

    const stock = market.getStock('BTCUSDT');
    expect(stock.length).toBe(2);
    const enriched = stock.now();
    expect(enriched['body']).toBeDefined();
  });

  it('should update symbol with new candle and enrich it', () => {
    const market = new Market([candleStick(), movingAverage(2, 'close')]);
    market.registerSymbol('SOLUSDT');

    market.update('SOLUSDT', makeCandle(100, 0));
    market.update('SOLUSDT', makeCandle(110, 1));

    const stock = market.getStock('SOLUSDT');
    expect(stock.length).toBe(2);
  });

  it('should throw for unregistered symbol', () => {
    const market = new Market([]);
    expect(() => market.getStock('UNKNOWN')).toThrow('Symbol UNKNOWN not registered');
  });

  it('should list registered symbols', () => {
    const market = new Market([]);
    market.registerSymbol('BTCUSDT');
    market.registerSymbol('ETHUSDT');

    expect(market.getSymbols()).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('should correctly enrich candle with multiple indicators', () => {
    const market = new Market([
      candleStick(),
      movingAverage(3, 'close'),
    ]);

    market.registerSymbol('SOLUSDT', [
      makeCandle(100, 0),
      makeCandle(102, 1),
      makeCandle(104, 2),
    ]);

    const stock = market.getStock('SOLUSDT');
    stock.reset(2);
    const last = stock.now();
    expect(last['body']).toBeDefined();
    expect(last['ma3close']).toBeCloseTo((100 + 102) / 3);
  });

  it('should auto-register symbol on update if not registered', () => {
    const market = new Market([candleStick()]);
    market.update('NEWCOIN', makeCandle(50));

    expect(market.hasSymbol('NEWCOIN')).toBe(true);
  });
});
