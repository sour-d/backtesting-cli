import type { EnrichedCandle } from "../core/types.js";
import type { Instrument } from "../instrument/Instrument.js";
import type { IndicatorCompute } from "../indicator/types.js";
import type { TradingSignal } from "./types.js";

export interface IStrategy {
  readonly strategyId: string;
  /**
   * Declarative indicator list (legacy `getIndicators()`).
   * Bot registers each `{ name, definition }` on the instrument; each new candle is enriched by `Instrument.addCandle`.
   */
  getIndicators(): { compute: IndicatorCompute; name: string }[];
  /** Single action, or multiple (e.g. CLOSE then reversal entry on the same bar). */
  evaluate(
    instrument: Instrument,
    candle: EnrichedCandle,
  ): Promise<TradingSignal | TradingSignal[]>;
}
