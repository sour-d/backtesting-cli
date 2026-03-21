import type { EnrichedCandle } from "../../core/types.js";
import type { IndicatorCompute } from "../../indicator/types.js";
import type { Instrument } from "../../instrument/Instrument.js";
import { atrEmaFromLast } from "../indicators/atrEma.js";
import { smaAt } from "../indicators/rollingSma.js";
import {
  superTrendFromPrev,
  type SuperTrendState,
} from "../indicators/superTrendSeries.js";
import type { IStrategy } from "../IStrategy.js";
import type { TradingSignal } from "../types.js";

const P = {
  maPeriod: 50,
  trendMaPeriod: 200,
  atrPeriod: 10,
  superTrendMultiplier: 2,
  riskPercentage: 5,
  maxAllocation: 0.8,
  stopLossPct: 0.04,
} as const;

type PositionSide = "Buy" | "Sell";
type St = "Buy" | "Sell";

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
  now: {
    close: number;
    body: number;
    ma50high: number;
    ma200close: number;
    superTrendDirection: St;
  },
  yesterdayBody: number,
  stopLossPct: number,
): { price: number; riskPerUnit: number } | null {
  if (now.ma200close > 0 && now.close <= now.ma200close) return null;
  if (
    now.close > now.ma50high &&
    now.body > 0 &&
    yesterdayBody > 0 &&
    now.superTrendDirection === "Buy"
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
  now: {
    close: number;
    body: number;
    ma50low: number;
    ma200close: number;
    superTrendDirection: St;
  },
  yesterdayBody: number,
  stopLossPct: number,
): { price: number; riskPerUnit: number } | null {
  if (now.ma200close > 0 && now.close >= now.ma200close) return null;
  if (
    now.close < now.ma50low &&
    now.body < 0 &&
    yesterdayBody < 0 &&
    now.superTrendDirection === "Sell"
  ) {
    const price = now.close;
    const stopLoss = price * (1 + stopLossPct);
    const riskPerUnit = stopLoss - price;
    if (riskPerUnit <= 0) return null;
    return { price, riskPerUnit };
  }
  return null;
}

function checkLongExit(
  now: { low: number; body: number },
  ma50highPrev: number,
): boolean {
  return ma50highPrev > now.low && now.body < 0;
}

function checkShortExit(
  now: { high: number; body: number },
  ma50lowPrev: number,
): boolean {
  return now.high > ma50lowPrev && now.body > 0;
}

function positionSideFromInstrument(
  instrument: Instrument,
): PositionSide | null {
  const q = instrument.currentPositionQty;
  if (Math.abs(q) < 1e-12) return null;
  return q > 0 ? "Buy" : "Sell";
}

/**
 * MA channel + SMA200 filter + SuperTrend — reads `candle.indicators` keys (`ma50high`, `ma200close`, …).
 */
export class MovingAverageV2Strategy implements IStrategy {
  readonly strategyId = "mav2";

  getIndicators(): { compute: IndicatorCompute; name: string }[] {
    return [
      {
        name: "ma50high",
        compute: (candles, candle) =>
          smaAt(
            candles.map((c) => c.high),
            50,
            P.maPeriod,
          ),
      },
      {
        name: "ma50low",
        compute: (candles, candle) =>
          smaAt(
            candles.map((c) => c.low),
            50,
            P.maPeriod,
          ),
      },
      {
        name: "ma200close",
        compute: (candles, candle) =>
          smaAt(
            candles.map((c) => c.close),
            200,
            P.trendMaPeriod,
          ),
      },
      {
        name: "atr",
        compute: (candles, candle) =>
          atrEmaFromLast(candles, candle, P.atrPeriod),
      },
      {
        name: "superTrend",
        compute: (candles, candle) =>
          superTrendFromPrev(
            candles,
            candle,
            P.atrPeriod,
            P.superTrendMultiplier,
          ),
      },
      {
        name: "body",
        compute: (candles, candle) => candle.close - candle.open,
      },
    ];
  }

  async evaluate(
    instrument: Instrument,
  ): Promise<TradingSignal | TradingSignal[]> {
    const candles = instrument.getCandles(2);
    if (candles.length < 2) return { action: "HOLD" };

    const now = candles[candles.length - 1]!;
    const prev = candles[candles.length - 2]!;
    console.log("now", now);

    const signals = this.evaluateRules({
      instrument,
      now,
      prev,
    });
    const flat = signals.filter((s) => s.action !== "HOLD");
    if (flat.length === 0) return { action: "HOLD" };
    return flat.length === 1 ? flat[0]! : flat;
  }

  private evaluateRules(params: {
    readonly instrument: Instrument;
    readonly now: EnrichedCandle;
    readonly prev: EnrichedCandle;
  }): TradingSignal[] {
    const { instrument, now, prev } = params;
    const pos = positionSideFromInstrument(instrument);
    const cap = instrument.allocatedCapital;

    const yesterdayBody = prev.indicators.body as number;
    const ma50highPrev = prev.indicators.ma50high as number;
    const ma50lowPrev = prev.indicators.ma50low as number;

    const body = now.indicators.body as number;
    const ma50high = now.indicators.ma50high as number;
    const ma50low = now.indicators.ma50low as number;
    const ma200close = now.indicators.ma200close as number;
    const st = (now.indicators.superTrend as SuperTrendState).direction;

    const longEntry = {
      close: now.close,
      body,
      ma50high,
      ma200close,
      superTrendDirection: st,
    };
    const shortEntry = {
      close: now.close,
      body,
      ma50low,
      ma200close,
      superTrendDirection: st,
    };
    const exitLong = { low: now.low, body };
    const exitShort = { high: now.high, body };

    if (pos === "Buy") {
      if (checkLongExit(exitLong, ma50highPrev)) {
        const out: TradingSignal[] = [{ action: "CLOSE" }];
        const short = checkShortEntry(shortEntry, yesterdayBody, P.stopLossPct);
        if (short) {
          const q = qtyFromRisk(
            cap,
            P.riskPercentage,
            P.maxAllocation,
            short.price,
            short.riskPerUnit,
            instrument,
          );
          if (q > 0) out.push({ action: "SELL", qty: q, price: undefined });
        }
        return out;
      }
      return [{ action: "HOLD" }];
    }

    if (pos === "Sell") {
      if (checkShortExit(exitShort, ma50lowPrev)) {
        const out: TradingSignal[] = [{ action: "CLOSE" }];
        const lng = checkLongEntry(longEntry, yesterdayBody, P.stopLossPct);
        if (lng) {
          const q = qtyFromRisk(
            cap,
            P.riskPercentage,
            P.maxAllocation,
            lng.price,
            lng.riskPerUnit,
            instrument,
          );
          if (q > 0) out.push({ action: "BUY", qty: q, price: undefined });
        }
        return out;
      }
      return [{ action: "HOLD" }];
    }

    const longFirst = checkLongEntry(longEntry, yesterdayBody, P.stopLossPct);
    if (longFirst) {
      const q = qtyFromRisk(
        cap,
        P.riskPercentage,
        P.maxAllocation,
        longFirst.price,
        longFirst.riskPerUnit,
        instrument,
      );
      if (q > 0) return [{ action: "BUY", qty: q, price: undefined }];
    }
    const short = checkShortEntry(shortEntry, yesterdayBody, P.stopLossPct);
    if (short) {
      const q = qtyFromRisk(
        cap,
        P.riskPercentage,
        P.maxAllocation,
        short.price,
        short.riskPerUnit,
        instrument,
      );
      if (q > 0) return [{ action: "SELL", qty: q, price: undefined }];
    }

    return [{ action: "HOLD" }];
  }
}
