import BreakoutStrategy from "./BreakoutStrategy.js";
import FortyTwentyStrategy from "./FortyTwentyStrategy.js";
import MovingAverageStrategy from "./MovingAverageStrategy.js";
import PriceActionStrategy from "./PriceActionStrategy.js";
import SuperTrendStrategy from "./SuperTrendStrategy.js";
import TwoBreakingCandle from "./TwoBreakingCandle.js";
import VolatilityCompression from "./VolatilityCompression.js";

const STRATEGIES = [
  FortyTwentyStrategy,
  MovingAverageStrategy,
  TwoBreakingCandle,
  PriceActionStrategy,
  SuperTrendStrategy,
  BreakoutStrategy,
  VolatilityCompression,
];

export default STRATEGIES;
