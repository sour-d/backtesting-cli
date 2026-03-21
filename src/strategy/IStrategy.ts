import type { Instrument } from "../instrument/Instrument.js";
import type { PositionBookSnapshot } from "../position/types.js";
import type { IndicatorCompute } from "../indicator/types.js";
import type { StrategyEvaluateResult } from "./types.js";

export interface IStrategy {
  readonly strategyId: string;
  /**
   * Declarative indicator list (legacy `getIndicators()`).
   * Bot registers each `{ name, definition }` on the instrument; each new candle is enriched by `Instrument.addCandle`.
   */
  getIndicators(): { compute: IndicatorCompute; name: string }[];
  /**
   * `position` is the current book from {@link PositionManager} (venue-synced on live before each bar).
   */
  evaluate(
    instrument: Instrument,
    position: PositionBookSnapshot,
  ): Promise<StrategyEvaluateResult | StrategyEvaluateResult[]>;
}
