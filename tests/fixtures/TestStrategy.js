import Strategy from "../../src/core/strategy/Strategy.js";

/**
 * Deterministic strategy for integration tests.
 *
 * Rules (use only raw OHLC -- no indicators):
 *   buy:            2 consecutive green candles (close > open)
 *   sell:           2 consecutive red   candles (close < open)
 *   longSquareOff:  today is red  -> exit long
 *   shortSquareOff: today is green -> exit short
 *
 * Behaviour is 100 % predictable from the input candle colours.
 */
class TestStrategy extends Strategy {
  constructor(config = TestStrategy.getDefaultConfig()) {
    super(config);
  }

  static strategyName = "TestStrategy";

  static getDefaultConfig() {
    // 1 % risk keeps position sizes small so both instruments can trade
    // maxAllocation at 100% -- with isolated capital the pool is already capped
    return { capital: 100000, riskPercentage: 1, maxAllocation: 1.0 };
  }

  static getIndicators() {
    return []; // No technical indicators needed
  }

  // --- Entry signals ---------------------------------------------------

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    if (!today || !yesterday) return false;

    if (today.close > today.open && yesterday.close > yesterday.open) {
      const risk = today.high - today.low;
      this.takePosition(risk, today.close, "Buy");
      return true;
    }
    return false;
  }

  sell() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    if (!today || !yesterday) return false;

    if (today.close < today.open && yesterday.close < yesterday.open) {
      const risk = today.high - today.low;
      this.takePosition(risk, today.close, "Sell");
      return true;
    }
    return false;
  }

  // --- Exit signals ----------------------------------------------------

  longSquareOff() {
    const today = this.stock.now();
    if (!today) return;

    // Exit long when today is red
    if (today.close < today.open) {
      this.exitPosition(today.close, this.currentTrade.quantity);
    }
  }

  shortSquareOff() {
    const today = this.stock.now();
    if (!today) return;

    // Exit short when today is green
    if (today.close > today.open) {
      this.exitPosition(today.close, this.currentTrade.quantity);
    }
  }
}

export { TestStrategy };
export default TestStrategy;
