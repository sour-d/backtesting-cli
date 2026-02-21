import type { Signal, Position } from '../types/index.js';
import type { OHLCStorage } from '../market/OHLCStorage.js';
import type { IndicatorFn } from '../market/indicators/types.js';
import { candleStick, movingAverage, atr, superTrend } from '../market/indicators/index.js';
import { num } from '../market/indicators/utils.js';
import type { IStrategy } from './IStrategy.js';

/**
 * 20-period channel breakout strategy with SuperTrend filter.
 *
 * Long entry: close > MA20(high), bullish bodies x2, SuperTrend = Buy
 * Short entry: close < MA20(low), bearish bodies x2, SuperTrend = Sell
 * Stop loss: 4% from entry.
 * Exit: price penetrates yesterday's channel + reversal body.
 */
export class MovingAverageStrategy implements IStrategy {
  readonly name = 'MovingAverage';
  private buyFirst = false;

  getIndicators(): IndicatorFn[] {
    return [
      movingAverage(20, 'high'),
      movingAverage(20, 'low'),
      candleStick(),
      atr(10),
      superTrend(10, 2),
    ];
  }

  evaluate(stock: OHLCStorage, position: Position | null): Signal | null {
    if (position?.side === 'Buy') return this.checkLongExit(stock);
    if (position?.side === 'Sell') return this.checkShortExit(stock);

    let signal: Signal | null;
    if (this.buyFirst) {
      signal = this.checkBuy(stock) ?? this.checkSell(stock);
    } else {
      signal = this.checkSell(stock) ?? this.checkBuy(stock);
    }
    if (!signal) this.buyFirst = !this.buyFirst;
    return signal;
  }

  private checkBuy(stock: OHLCStorage): Signal | null {
    const now = stock.now();
    const yesterday = stock.prev();
    if (!now || !yesterday) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const prevBody = num((yesterday as Record<string, unknown>)['body']);
    const ma20high = num((now as Record<string, unknown>)['ma20high']);
    const stDir = (now as Record<string, unknown>)['superTrendDirection'];

    if (now.close > ma20high && body > 0 && prevBody > 0 && stDir === 'Buy') {
      const price = now.close;
      const stopLoss = price * 0.96;
      return { action: 'BUY', price, stopLoss, risk: price - stopLoss };
    }
    return null;
  }

  private checkSell(stock: OHLCStorage): Signal | null {
    const now = stock.now();
    const yesterday = stock.prev();
    if (!now || !yesterday) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const prevBody = num((yesterday as Record<string, unknown>)['body']);
    const ma20low = num((now as Record<string, unknown>)['ma20low']);
    const stDir = (now as Record<string, unknown>)['superTrendDirection'];

    if (now.close < ma20low && body < 0 && prevBody < 0 && stDir === 'Sell') {
      const price = now.close;
      const stopLoss = price * 1.04;
      return { action: 'SELL', price, stopLoss, risk: stopLoss - price };
    }
    return null;
  }

  private checkLongExit(stock: OHLCStorage): Signal | null {
    const now = stock.now();
    const yesterday = stock.prev();
    if (!now || !yesterday) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const ma20highYesterday = num((yesterday as Record<string, unknown>)['ma20high']);

    if (ma20highYesterday > now.low && body < 0) {
      return { action: 'EXIT', price: ma20highYesterday, reason: 'channel_reversal' };
    }
    return null;
  }

  private checkShortExit(stock: OHLCStorage): Signal | null {
    const now = stock.now();
    const yesterday = stock.prev();
    if (!now || !yesterday) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const ma20lowYesterday = num((yesterday as Record<string, unknown>)['ma20low']);

    if (now.high > ma20lowYesterday && body > 0) {
      return { action: 'EXIT', price: ma20lowYesterday, reason: 'channel_reversal' };
    }
    return null;
  }
}
