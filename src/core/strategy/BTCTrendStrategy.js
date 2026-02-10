import { Strategy } from "./Strategy.js";
import calculateATR from "../indicators/atr.js";
import calculateEMA from "../indicators/ema.js";
import calculateRSI from "../indicators/rsi.js";
import { movingAverageOf } from "../indicators/nDayMA.js";

const addIndicator =
  (indicatorFn, ...extraArgs) =>
  (quote, technicalQuotes) =>
    indicatorFn(quote, technicalQuotes, ...extraArgs);

class BTCTrendStrategy extends Strategy {
  constructor(config = BTCTrendStrategy.getDefaultConfig()) {
    super(config);
    this.config = config;
  }

  static getIndicators() {
    return [
      addIndicator(calculateEMA, 12),   // fast EMA
      addIndicator(calculateEMA, 26),   // slow EMA
      addIndicator(calculateRSI, 14),
      addIndicator(calculateATR, 14),
      addIndicator(movingAverageOf, 200, "close"), // sma200
    ];
  }

  static getDefaultConfig() {
    return {
      capital: 10000,
      riskPercentage: 10, // aggressive risk to hit >20% annual
      maxAllocation: 0.8, // allow up to 80% of capital in a position
      rsiThreshold: 30,   // lower threshold for more entries
      atrStopMult: 2.0,
      atrTPMult: 8.0,     // higher take profit
      useSMAFilter: true,
    };
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    if (!today || !yesterday) return false;

    const fastEMA = today.ema12;
    const slowEMA = today.ema26;
    const rsi = today.rsi;
    const close = today.close;
    const atr = today.atr;

    const trendCondition = fastEMA > slowEMA;
    const momentumCondition = rsi > this.config.rsiThreshold;
    const majorTrendCondition = !this.config.useSMAFilter || close > today.ma200close;

    if (trendCondition && momentumCondition && majorTrendCondition) {
      const entryPrice = close;
      const stopDist = atr * this.config.atrStopMult;
      const tpDist = atr * this.config.atrTPMult;
      const risk = stopDist;
      if (risk <= 0) return false;

      this.takePosition(risk, entryPrice);
      this.currentTrade.takeProfit = entryPrice + tpDist;
      return true;
    }
    return false;
  }

  longSquareOff() {
    if (!this.currentTrade) return false;
    const today = this.stock.now();
    // Take profit?
    if (this.currentTrade.takeProfit && today.high >= this.currentTrade.takeProfit) {
      this.exitPosition(this.currentTrade.takeProfit, this.currentTrade.quantity);
      return true;
    }
    // Exit on trend reversal (EMA cross down)
    const fastEMA = today.ema12;
    const slowEMA = today.ema26;
    if (fastEMA < slowEMA) {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return true;
    }
    return false;
  }

  sell() { return false; }
  shortSquareOff() { return false; }

  static strategyName = "BTCTrendFixedV2";
}

export default BTCTrendStrategy;
