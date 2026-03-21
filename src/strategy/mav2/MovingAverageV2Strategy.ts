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
import type { StrategyEvaluateResult } from "../types.js";

const P = {
  maPeriod: 50,
  trendMaPeriod: 200,
  atrPeriod: 10,
  superTrendMultiplier: 2,
  riskPercentage: 4,
  maxAllocation: 0.8,
  stopLossPct: 0.04,
} as const;

/** Set `QUANTLAB_DEBUG_MAV2=1` when running backtest/live to trace why entries/exits fire or not. */
const MAV2_DEBUG = process.env.QUANTLAB_DEBUG_MAV2 === "1";

function mav2Log(msg: string, data?: Record<string, unknown>): void {
  if (!MAV2_DEBUG) return;
  if (data !== undefined) {
    console.log(`[mav2] ${msg}`, data);
  } else {
    console.log(`[mav2] ${msg}`);
  }
}

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

function positionSideFromInstrument(
  instrument: Instrument,
): PositionSide | null {
  const q = instrument.currentPositionQty;
  if (Math.abs(q) < 1e-12) return null;
  return q > 0 ? "Buy" : "Sell";
}

function stDirection(now: EnrichedCandle): St {
  return (now.indicators.superTrend as SuperTrendState).direction;
}

/**
 * MA channel + SMA200 filter + SuperTrend — structure mirrors legacy `MovingAverageV2Strategy.js`
 * (`buy`, `sell`, `longSquareOff`, `shortSquareOff`) with `evaluate` orchestrating them.
 */
export class MovingAverageV2Strategy implements IStrategy {
  readonly strategyId = "mav2";

  getIndicators(): { compute: IndicatorCompute; name: string }[] {
    return [
      {
        name: "ma50high",
        compute: (candles, candle) => {
          const highs = [...candles.map((c) => c.high), candle.high];
          return smaAt(highs, highs.length - 1, P.maPeriod);
        },
      },
      {
        name: "ma50low",
        compute: (candles, candle) => {
          const lows = [...candles.map((c) => c.low), candle.low];
          return smaAt(lows, lows.length - 1, P.maPeriod);
        },
      },
      {
        name: "ma200close",
        compute: (candles, candle) => {
          const closes = [...candles.map((c) => c.close), candle.close];
          return smaAt(closes, closes.length - 1, P.trendMaPeriod);
        },
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

  /**
   * Dispatches by position: square-offs when long/short, else entry `buy` then `sell`.
   */
  async evaluate(
    instrument: Instrument,
  ): Promise<StrategyEvaluateResult | StrategyEvaluateResult[]> {
    const candles = instrument.getCandles(2);
    if (candles.length < 2) {
      mav2Log("evaluate: skip — need >=2 candles in book", {
        symbol: instrument.symbol,
        bookLen: instrument.getCandles().length,
      });
      return { action: "HOLD" };
    }

    const now = candles[candles.length - 1]!;
    const prev = candles[candles.length - 2]!;
    const pos = positionSideFromInstrument(instrument);

    mav2Log("evaluate", {
      symbol: instrument.symbol,
      dateUnix: now.dateUnix,
      position: pos ?? "flat",
      capital: instrument.allocatedCapital,
      barCount: instrument.getCandles().length,
    });

    if (pos === "Buy") {
      const out = this.coalesce(this.longSquareOff(instrument, now, prev));
      mav2Log("evaluate: long path (longSquareOff)", { result: out });
      return out;
    }
    if (pos === "Sell") {
      const out = this.coalesce(this.shortSquareOff(instrument, now, prev));
      mav2Log("evaluate: short path (shortSquareOff)", { result: out });
      return out;
    }

    const longSignals = this.buy(instrument, now, prev);
    if (longSignals.length > 0) {
      mav2Log("evaluate: BUY", { signals: longSignals });
      return this.coalesce(longSignals);
    }

    const shortSignals = this.sell(instrument, now, prev);
    if (shortSignals.length > 0) {
      mav2Log("evaluate: SELL", { signals: shortSignals });
      return this.coalesce(shortSignals);
    }

    mav2Log("evaluate: HOLD (no entry signal)");
    return { action: "HOLD" };
  }

  /** Long entry — same conditions as legacy `buy()`. */
  private buy(
    instrument: Instrument,
    today: EnrichedCandle,
    yesterday: EnrichedCandle,
  ): StrategyEvaluateResult[] {
    const ma50high = today.indicators.ma50high as number | undefined;
    const ma200close = today.indicators.ma200close as number | undefined;
    const st = stDirection(today);

    if (ma200close !== undefined && ma200close > 0 && today.close <= ma200close) {
      mav2Log("buy: skip — close <= SMA200", {
        close: today.close,
        ma200close,
      });
      return [];
    }

    const todayBody = today.indicators.body as number;
    const yesterdayBody = yesterday.indicators.body as number;

    const aboveMa50High =
      ma50high !== undefined && Number.isFinite(ma50high) && today.close > ma50high;
    const bodiesOk = todayBody > 0 && yesterdayBody > 0;
    const stBuy = st === "Buy";

    if (!(aboveMa50High && bodiesOk && stBuy)) {
      mav2Log("buy: gates not met", {
        close: today.close,
        ma50high,
        ma200close,
        aboveMa50High,
        todayBody,
        yesterdayBody,
        bodiesOk,
        superTrend: st,
        stBuy,
      });
      return [];
    }

    const buyingPrice = today.close;
    const initialStopLoss = buyingPrice * (1 - P.stopLossPct);
    const riskPerUnit = buyingPrice - initialStopLoss;
    if (riskPerUnit <= 0) {
      mav2Log("buy: skip — riskPerUnit <= 0", { buyingPrice, initialStopLoss });
      return [];
    }

    const q = qtyFromRisk(
      instrument.allocatedCapital,
      P.riskPercentage,
      P.maxAllocation,
      buyingPrice,
      riskPerUnit,
      instrument,
    );
    if (q <= 0) {
      mav2Log("buy: qtyFromRisk returned 0", {
        capital: instrument.allocatedCapital,
        riskPct: P.riskPercentage,
        buyingPrice,
        riskPerUnit,
        minQty: instrument.minQty,
        minNotional: instrument.minNotional,
      });
      return [];
    }

    return [
      {
        action: "BUY",
        qty: q,
        price: buyingPrice,
        stopLoss: initialStopLoss,
      },
    ];
  }

  /** Short entry — same conditions as legacy `sell()`. */
  private sell(
    instrument: Instrument,
    today: EnrichedCandle,
    yesterday: EnrichedCandle,
  ): StrategyEvaluateResult[] {
    const ma50low = today.indicators.ma50low as number | undefined;
    const ma200close = today.indicators.ma200close as number | undefined;
    const st = stDirection(today);

    if (ma200close !== undefined && ma200close > 0 && today.close >= ma200close) {
      mav2Log("sell: skip — close >= SMA200", {
        close: today.close,
        ma200close,
      });
      return [];
    }

    const todayBody = today.indicators.body as number;
    const yesterdayBody = yesterday.indicators.body as number;

    const belowMa50Low =
      ma50low !== undefined && Number.isFinite(ma50low) && today.close < ma50low;
    const bodiesOk = todayBody < 0 && yesterdayBody < 0;
    const stSell = st === "Sell";

    if (!(belowMa50Low && bodiesOk && stSell)) {
      mav2Log("sell: gates not met", {
        close: today.close,
        ma50low,
        ma200close,
        belowMa50Low,
        todayBody,
        yesterdayBody,
        bodiesOk,
        superTrend: st,
        stSell,
      });
      return [];
    }

    const sellingPrice = today.close;
    const initialStopLoss = sellingPrice * (1 + P.stopLossPct);
    const riskPerUnit = initialStopLoss - sellingPrice;
    if (riskPerUnit <= 0) {
      mav2Log("sell: skip — riskPerUnit <= 0", { sellingPrice, initialStopLoss });
      return [];
    }

    const q = qtyFromRisk(
      instrument.allocatedCapital,
      P.riskPercentage,
      P.maxAllocation,
      sellingPrice,
      riskPerUnit,
      instrument,
    );
    if (q <= 0) {
      mav2Log("sell: qtyFromRisk returned 0", {
        capital: instrument.allocatedCapital,
        sellingPrice,
        riskPerUnit,
        minQty: instrument.minQty,
        minNotional: instrument.minNotional,
      });
      return [];
    }

    return [
      {
        action: "SELL",
        qty: q,
        price: sellingPrice,
        stopLoss: initialStopLoss,
      },
    ];
  }

  /** Exit long; optional short entry on same bar (legacy `longSquareOff` + `sell`). */
  private longSquareOff(
    instrument: Instrument,
    today: EnrichedCandle,
    yesterday: EnrichedCandle,
  ): StrategyEvaluateResult[] {
    const todayBody = today.indicators.body as number;
    const ma50highYesterday = yesterday.indicators.ma50high as number;

    if (ma50highYesterday > today.low && todayBody < 0) {
      mav2Log("longSquareOff: exit long (+ optional short)", {
        ma50highYesterday,
        low: today.low,
        todayBody,
      });
      const out: StrategyEvaluateResult[] = [
        { action: "CLOSE", price: ma50highYesterday },
      ];
      const shortSignals = this.sell(instrument, today, yesterday);
      if (shortSignals.length > 0) out.push(shortSignals[0]!);
      return out;
    }
    return [];
  }

  /** Exit short; optional long entry on same bar (legacy `shortSquareOff` + `buy`). */
  private shortSquareOff(
    instrument: Instrument,
    today: EnrichedCandle,
    yesterday: EnrichedCandle,
  ): StrategyEvaluateResult[] {
    const todayBody = today.indicators.body as number;
    const ma50lowYesterday = yesterday.indicators.ma50low as number;

    if (today.high > ma50lowYesterday && todayBody > 0) {
      mav2Log("shortSquareOff: exit short (+ optional long)", {
        ma50lowYesterday,
        high: today.high,
        todayBody,
      });
      const out: StrategyEvaluateResult[] = [
        { action: "CLOSE", price: ma50lowYesterday },
      ];
      const longSignals = this.buy(instrument, today, yesterday);
      if (longSignals.length > 0) out.push(longSignals[0]!);
      return out;
    }
    return [];
  }

  private coalesce(
    signals: StrategyEvaluateResult[],
  ): StrategyEvaluateResult | StrategyEvaluateResult[] {
    const flat = signals.filter((s) => s.action !== "HOLD");
    if (flat.length === 0) return { action: "HOLD" };
    return flat.length === 1 ? flat[0]! : flat;
  }
}
