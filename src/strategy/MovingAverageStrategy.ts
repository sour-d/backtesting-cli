import type { Signal, Position } from '../types/index.js';
import type { OHLCStorage } from '../market/OHLCStorage.js';
import type { IndicatorFn } from '../market/indicators/types.js';
import { candleStick, movingAverage, atr, superTrend } from '../market/indicators/index.js';
import { num } from '../market/indicators/utils.js';
import type { IStrategy } from './IStrategy.js';

export interface MAParams {
  maPeriod?: number;
  atrPeriod?: number;
  superTrendPeriod?: number;
  superTrendMultiplier?: number;
  stopLossPct?: number;
}

/**
 * Channel breakout strategy with SuperTrend filter.
 *
 * Long entry: close > MA(high), bullish bodies x2, SuperTrend = Buy
 * Short entry: close < MA(low), bearish bodies x2, SuperTrend = Sell
 * Exit: price penetrates yesterday's channel + reversal body.
 */
export class MovingAverageStrategy implements IStrategy {
  readonly name = 'MovingAverage';
  private buyFirst = false;

  private readonly maPeriod: number;
  private readonly atrPeriod: number;
  private readonly stPeriod: number;
  private readonly stMultiplier: number;
  private readonly slPct: number;

  private readonly maHighKey: string;
  private readonly maLowKey: string;

  constructor(params?: MAParams) {
    this.maPeriod = params?.maPeriod ?? 20;
    this.atrPeriod = params?.atrPeriod ?? 10;
    this.stPeriod = params?.superTrendPeriod ?? 10;
    this.stMultiplier = params?.superTrendMultiplier ?? 2;
    this.slPct = params?.stopLossPct ?? 0.04;

    this.maHighKey = `ma${this.maPeriod}high`;
    this.maLowKey = `ma${this.maPeriod}low`;
  }

  getIndicators(): IndicatorFn[] {
    return [
      movingAverage(this.maPeriod, 'high'),
      movingAverage(this.maPeriod, 'low'),
      candleStick(),
      atr(this.atrPeriod),
      superTrend(this.stPeriod, this.stMultiplier),
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
    const maHigh = num((now as Record<string, unknown>)[this.maHighKey]);
    const stDir = (now as Record<string, unknown>)['superTrendDirection'];

    if (now.close > maHigh && body > 0 && prevBody > 0 && stDir === 'Buy') {
      const price = now.close;
      const stopLoss = price * (1 - this.slPct);
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
    const maLow = num((now as Record<string, unknown>)[this.maLowKey]);
    const stDir = (now as Record<string, unknown>)['superTrendDirection'];

    if (now.close < maLow && body < 0 && prevBody < 0 && stDir === 'Sell') {
      const price = now.close;
      const stopLoss = price * (1 + this.slPct);
      return { action: 'SELL', price, stopLoss, risk: stopLoss - price };
    }
    return null;
  }

  private checkLongExit(stock: OHLCStorage): Signal | null {
    const now = stock.now();
    const yesterday = stock.prev();
    if (!now || !yesterday) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const maHighYesterday = num((yesterday as Record<string, unknown>)[this.maHighKey]);

    if (maHighYesterday > now.low && body < 0) {
      return { action: 'EXIT', price: maHighYesterday, reason: 'channel_reversal' };
    }
    return null;
  }

  private checkShortExit(stock: OHLCStorage): Signal | null {
    const now = stock.now();
    const yesterday = stock.prev();
    if (!now || !yesterday) return null;

    const body = num((now as Record<string, unknown>)['body']);
    const maLowYesterday = num((yesterday as Record<string, unknown>)[this.maLowKey]);

    if (now.high > maLowYesterday && body > 0) {
      return { action: 'EXIT', price: maLowYesterday, reason: 'channel_reversal' };
    }
    return null;
  }
}
