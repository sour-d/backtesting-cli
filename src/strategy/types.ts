/**
 * Result of `IStrategy.evaluate` — mirrors legacy `MovingAverageV2Strategy.js` intent:
 * - Long: `price` = entry (e.g. close), `stopLoss` = `price * (1 - stopPct)`, `qty` from risk vs `price - stopLoss`
 * - Short: `stopLoss` = `price * (1 + stopPct)`, `qty` from `stopLoss - price`
 * - `CLOSE`: optional `price` = legacy exit reference; optional `qty` — omit or undefined = close entire position; set = partial close (future-friendly)
 */
export type StrategyEvaluateResult =
  | { action: "HOLD" }
  | { action: "CLOSE"; price?: number; qty?: number }
  | {
      action: "BUY";
      qty: number;
      price: number;
      stopLoss: number;
    }
  | {
      action: "SELL";
      qty: number;
      price: number;
      stopLoss: number;
    };

/** @deprecated Renamed to {@link StrategyEvaluateResult} */
export type TradingSignal = StrategyEvaluateResult;
