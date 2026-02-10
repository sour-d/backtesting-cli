import { Strategy } from "./Strategy.js";
import calculateATR from "../indicators/atr.js";
import calculateEMA from "../indicators/ema.js";
import calculateRSI from "../indicators/rsi.js";
import { movingAverageOf } from "../indicators/nDayMA.js";

const addIndicator =
  (indicatorFn, ...extraArgs) =>
  (quote, technicalQuotes) =>
    indicatorFn(quote, technicalQuotes, ...extraArgs);

class BTCTrendShortOnlyStrategy extends Strategy {
  constructor(config = BTCTrendShortOnlyStrategy.getDefaultConfig()) {
    super(config);
    this.config = config;
  }

  static getIndicators() {
    return [
      addIndicator(calculateEMA, 12),
      addIndicator(calculateEMA, 26),
      addIndicator(calculateRSI, 14),
      addIndicator(calculateATR, 14),
      addIndicator(movingAverageOf, 200, "close"),
    ];
  }

  static getDefaultConfig() {
    return {
      capital: 10000,
      riskPercentage: 10,
      maxAllocation: 0.8,
      rsiThreshold: 35,   // Short when RSI < 35
      atrStopMult: 2.0,
      atrTPMult: 8.0,
      useSMAFilter: true,
    };
  }

  // Short entry
  sell() {
    const today = this.stock.now();
    if (!today) return false;

    const fastEMA = today.ema12;
    const slowEMA = today.ema26;
    const rsi = today.rsi;
    const close = today.close;
    const atr = today.atr;

    const trendCondition = fastEMA < slowEMA;
    const momentumCondition = rsi < this.config.rsiThreshold;
    const majorTrendCondition = !this.config.useSMAFilter || close < today.ma200close;

    if (trendCondition && momentumCondition && majorTrendCondition) {
      const entryPrice = close;
      const stopDist = atr * this.config.atrStopMult;
      const tpDist = atr * this.config.atrTPMult;
      const risk = stopDist;
      if (risk <= 0) return false;

      this.takePosition(risk, entryPrice, "Sell");
      this.currentTrade.takeProfit = entryPrice - tpDist;
      return true;
    }
    return false;
  }

  // Short exit: take profit or trend reversal (EMA cross up)
  shortSquareOff() {
    if (!this.currentTrade || this.currentTrade.type !== "Sell") return false;
    const today = this.stock.now();

    // Take profit
    if (this.currentTrade.takeProfit && today.low <= this.currentTrade.takeProfit) {
      this.exitPosition(this.currentTrade.takeProfit, this.currentTrade.quantity);
      return true;
    }

    // Exit on trend reversal (fast EMA crosses above slow EMA)
    const fastEMA = today.ema12;
    const slowEMA = today.ema26;
    if (fastEMA > slowEMA) {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return true;
    }
    return false;
  }

  // No longs
  buy() { return false; }
  longSquareOff() { return false; }

  static strategyName = "BTCTrendShortOnly";
}

export default BTCTrendShortOnlyStrategy;
