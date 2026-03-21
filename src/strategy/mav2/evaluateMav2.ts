import type { Candle } from '../../core/types.js';
import type { Instrument } from '../../instrument/Instrument.js';
import type { TradingSignal } from '../types.js';
import type { Mav2BarComputed, Mav2SeriesParams } from './mav2math.js';
import { computeMav2Series } from './mav2math.js';

export interface Mav2Params extends Partial<Mav2SeriesParams> {
  readonly riskPercentage: number;
  readonly maxAllocation: number;
  readonly stopLossPct: number;
}

const defaultEval: Mav2Params = {
  riskPercentage: 5,
  maxAllocation: 0.8,
  stopLossPct: 0.04,
  maPeriod: 50,
  trendMaPeriod: 200,
  atrPeriod: 10,
  superTrendMultiplier: 2,
};

type PositionSide = 'Buy' | 'Sell';

function qtyFromRisk(
  capital: number,
  riskPct: number,
  maxAlloc: number,
  entry: number,
  riskPerUnit: number,
  instrument: Instrument,
): number {
  if (riskPerUnit <= 0) return 0;
  const riskDollars = capital * (riskPct / 100);
  let qty = riskDollars / riskPerUnit;
  const maxQty = (capital * maxAlloc) / entry;
  qty = Math.min(qty, maxQty);
  qty = instrument.roundQty(qty);
  if (qty < instrument.minQty) return 0;
  if (!instrument.canOpenPosition(qty, entry)) return 0;
  return qty;
}

function checkLongEntry(
  now: Mav2BarComputed,
  yesterday: Mav2BarComputed,
  stopLossPct: number,
): { price: number; riskPerUnit: number } | null {
  if (now.maTrendClose > 0 && now.close <= now.maTrendClose) return null;
  if (
    now.close > now.maHigh &&
    now.body > 0 &&
    yesterday.body > 0 &&
    now.superTrendDirection === 'Buy'
  ) {
    const price = now.close;
    const stopLoss = price * (1 - stopLossPct);
    const riskPerUnit = price - stopLoss;
    if (riskPerUnit <= 0) return null;
    return { price, riskPerUnit };
  }
  return null;
}

function checkShortEntry(
  now: Mav2BarComputed,
  yesterday: Mav2BarComputed,
  stopLossPct: number,
): { price: number; riskPerUnit: number } | null {
  if (now.maTrendClose > 0 && now.close >= now.maTrendClose) return null;
  if (
    now.close < now.maLow &&
    now.body < 0 &&
    yesterday.body < 0 &&
    now.superTrendDirection === 'Sell'
  ) {
    const price = now.close;
    const stopLoss = price * (1 + stopLossPct);
    const riskPerUnit = stopLoss - price;
    if (riskPerUnit <= 0) return null;
    return { price, riskPerUnit };
  }
  return null;
}

function checkLongExit(now: Mav2BarComputed, yesterday: Mav2BarComputed): boolean {
  return yesterday.maHigh > now.low && now.body < 0;
}

function checkShortExit(now: Mav2BarComputed, yesterday: Mav2BarComputed): boolean {
  return now.high > yesterday.maLow && now.body > 0;
}

function positionSideFromInstrument(instrument: Instrument): PositionSide | null {
  const q = instrument.currentPositionQty;
  if (Math.abs(q) < 1e-12) return null;
  return q > 0 ? 'Buy' : 'Sell';
}

/**
 * MA v2 rules (channel + SMA200 filter + SuperTrend) — same decision order as `trading-platform/rules` / legacy backtesting.
 */
export function evaluateMav2(params: {
  readonly instrument: Instrument;
  readonly candles: readonly Candle[];
  readonly config?: Partial<Mav2Params>;
}): TradingSignal[] {
  const cfg = { ...defaultEval, ...params.config };
  const ctx = computeMav2Series(params.candles, cfg);
  if (!ctx) return [{ action: 'HOLD' }];

  const { today, yesterday } = ctx;
  const pos = positionSideFromInstrument(params.instrument);
  const cap = params.instrument.allocatedCapital;

  if (pos === 'Buy') {
    if (checkLongExit(today, yesterday)) {
      const out: TradingSignal[] = [{ action: 'CLOSE' }];
      const short = checkShortEntry(today, yesterday, cfg.stopLossPct);
      if (short) {
        const q = qtyFromRisk(cap, cfg.riskPercentage, cfg.maxAllocation, short.price, short.riskPerUnit, params.instrument);
        if (q > 0) out.push({ action: 'SELL', qty: q, price: undefined });
      }
      return out;
    }
    return [{ action: 'HOLD' }];
  }

  if (pos === 'Sell') {
    if (checkShortExit(today, yesterday)) {
      const out: TradingSignal[] = [{ action: 'CLOSE' }];
      const lng = checkLongEntry(today, yesterday, cfg.stopLossPct);
      if (lng) {
        const q = qtyFromRisk(cap, cfg.riskPercentage, cfg.maxAllocation, lng.price, lng.riskPerUnit, params.instrument);
        if (q > 0) out.push({ action: 'BUY', qty: q, price: undefined });
      }
      return out;
    }
    return [{ action: 'HOLD' }];
  }

  const longFirst = checkLongEntry(today, yesterday, cfg.stopLossPct);
  if (longFirst) {
    const q = qtyFromRisk(cap, cfg.riskPercentage, cfg.maxAllocation, longFirst.price, longFirst.riskPerUnit, params.instrument);
    if (q > 0) return [{ action: 'BUY', qty: q, price: undefined }];
  }
  const short = checkShortEntry(today, yesterday, cfg.stopLossPct);
  if (short) {
    const q = qtyFromRisk(cap, cfg.riskPercentage, cfg.maxAllocation, short.price, short.riskPerUnit, params.instrument);
    if (q > 0) return [{ action: 'SELL', qty: q, price: undefined }];
  }

  return [{ action: 'HOLD' }];
}
