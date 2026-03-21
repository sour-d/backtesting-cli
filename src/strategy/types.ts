/**
 * Result of `IStrategy.evaluate` — mirrors legacy `MovingAverageV2Strategy.js` intent:
 * - Long: `price` = entry (e.g. close), `stopLoss` = `price * (1 - stopPct)`, `qty` from risk vs `price - stopLoss`
 * - Short: `stopLoss` = `price * (1 + stopPct)`, `qty` from `stopLoss - price`
 * - `CLOSE`: optional `price` overrides fill (omit to use current bar close in backtest); optional `qty` — omit = close entire position
 * - `UPDATE_SL`: new absolute stop-loss price (live: Bybit `setTradingStop`; backtest: log only).
 */
export type StrategyEvaluateResult =
  | { action: "HOLD" }
  | { action: "CLOSE"; price?: number; qty?: number }
  | { action: "UPDATE_SL"; stopLoss: number }
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
