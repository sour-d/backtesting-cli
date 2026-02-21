import type { Signal, Position } from '../types/index.js';
import type { OHLCStorage } from '../market/OHLCStorage.js';
import type { IndicatorFn } from '../market/indicators/types.js';
import { candleStick, movingAverage, atr, superTrend } from '../market/indicators/index.js';
import { num } from '../market/indicators/utils.js';
import type { IStrategy } from './IStrategy.js';

/**
 * 50-period channel breakout strategy with SMA200 trend filter.
 *
 * Long entry: close > MA50(high), bullish bodies x2, SuperTrend = Buy, close > SMA200
 * Short entry: close < MA50(low), bearish bodies x2, SuperTrend = Sell, close < SMA200
 * Stop loss: 4% from entry.
 * Exit: price penetrates yesterday's channel + reversal body.
 */
export class MovingAverageV2Strategy implements IStrategy {
  readonly name = 'MovingAverage_v2';
  private buyFirst = false;

  getIndicators(): IndicatorFn[] {
    return [
      movingAverage(50, 'high'),
      movingAverage(50, 'low'),
      movingAverage(200, 'close'),
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

    const ma200close = num((now as Record<string, unknown>)['ma200close']);
    if (ma200close > 0 && now.close <= ma200close) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const prevBody = num((yesterday as Record<string, unknown>)['body']);
    const ma50high = num((now as Record<string, unknown>)['ma50high']);
    const stDir = (now as Record<string, unknown>)['superTrendDirection'];

    if (now.close > ma50high && body > 0 && prevBody > 0 && stDir === 'Buy') {
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

    const ma200close = num((now as Record<string, unknown>)['ma200close']);
    if (ma200close > 0 && now.close >= ma200close) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const prevBody = num((yesterday as Record<string, unknown>)['body']);
    const ma50low = num((now as Record<string, unknown>)['ma50low']);
    const stDir = (now as Record<string, unknown>)['superTrendDirection'];

    if (now.close < ma50low && body < 0 && prevBody < 0 && stDir === 'Sell') {
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
    const ma50highYesterday = num((yesterday as Record<string, unknown>)['ma50high']);

    if (ma50highYesterday > now.low && body < 0) {
      return { action: 'EXIT', price: ma50highYesterday, reason: 'channel_reversal' };
    }
    return null;
  }

  private checkShortExit(stock: OHLCStorage): Signal | null {
    const now = stock.now();
    const yesterday = stock.prev();
    if (!now || !yesterday) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const ma50lowYesterday = num((yesterday as Record<string, unknown>)['ma50low']);

    if (now.high > ma50lowYesterday && body > 0) {
      return { action: 'EXIT', price: ma50lowYesterday, reason: 'channel_reversal' };
    }
    return null;
  }
}
