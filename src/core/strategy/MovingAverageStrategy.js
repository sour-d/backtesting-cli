import { Strategy } from "./Strategy.js";
import calculateATR from "../indicators/atr.js";
import calculateSuperTrendForQuote from "../indicators/superTrend.js";
import { movingAverageOf } from "../indicators/nDayMA.js";
import calculateCandleProperty from "../indicators/candleStick.js";

const addIndicator =
  (indicatorFn, ...extraArgs) =>
  (quote, technicalQuotes) =>
    indicatorFn(quote, technicalQuotes, ...extraArgs);

class MovingAverageStrategy extends Strategy {
  constructor(config = MovingAverageStrategy.getDefaultConfig()) {
    super(config);
    this.config = config;
  }

  static getIndicators() {
    return [
      addIndicator(movingAverageOf, 20, "high"),
      addIndicator(movingAverageOf, 20, "low"),
      addIndicator(calculateCandleProperty),
      addIndicator(calculateATR, 10),
      addIndicator(calculateSuperTrendForQuote, 2),
    ];
  }

  static getDefaultConfig() {
    return {
      upperLimit: 20,
      lowerLimit: 10,
      stopLossWindow: 10,
      capital: 100000,
      riskPercentage: 5,
      maxAllocation: 0.8, // Max 80% of per-instrument capital per trade
    };
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    if (!today || !yesterday) return;

    const today_body = today.close - today.open;
    const yesterday_body = yesterday.close - yesterday.open;

    if (
      today.close > today.ma20high &&
      today_body > 0 &&
      yesterday_body > 0 &&
      today.superTrendDirection === "Buy"
    ) {
      const buyingPrice = today.close;
      const initialStopLoss = buyingPrice * 0.96;
      const riskForOneStock = buyingPrice - initialStopLoss;
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice);
      return true;
    }
  }

  longSquareOff() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    if (!today || !yesterday) return;

    const today_body = today.close - today.open;

    const ma20high_yesterday = yesterday.ma20high;
    if (ma20high_yesterday > today.low && today_body < 0) {
      this.exitPosition(ma20high_yesterday, this.currentTrade.quantity);
      return this.sell();
    }
  }

  sell() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    if (!today || !yesterday) return;

    const today_body = today.close - today.open;
    const yesterday_body = yesterday.close - yesterday.open;

    if (
      today.close < today.ma20low &&
      today_body < 0 &&
      yesterday_body < 0 &&
      today.superTrendDirection === "Sell"
    ) {
      const sellingPrice = today.close;
      const initialStopLoss = sellingPrice * 1.04;
      const riskForOneStock = initialStopLoss - sellingPrice;
      if (initialStopLoss <= sellingPrice) return;
      this.takePosition(riskForOneStock, sellingPrice, "Sell");
      return true;
    }
  }

  shortSquareOff() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    if (!today || !yesterday) return;

    const today_body = today.close - today.open;
    const ma20low_yesterday = yesterday.ma20low;
    if (today.high > ma20low_yesterday && today_body > 0) {
      this.exitPosition(ma20low_yesterday, this.currentTrade.quantity);
      return this.buy();
    }
  }

  static strategyName = "MovingAverage";
}

export default MovingAverageStrategy;
