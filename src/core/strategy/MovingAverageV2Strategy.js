import { Strategy } from "./Strategy.js";
import calculateATR from "../indicators/atr.js";
import calculateSuperTrendForQuote from "../indicators/superTrend.js";
import { movingAverageOf } from "../indicators/nDayMA.js";
import calculateCandleProperty from "../indicators/candleStick.js";

const addIndicator =
  (indicatorFn, ...extraArgs) =>
    (quote, technicalQuotes) =>
      indicatorFn(quote, technicalQuotes, ...extraArgs);

class MovingAverageStrategy_v2 extends Strategy {
  constructor(config = MovingAverageStrategy_v2.getDefaultConfig()) {
    super(config);
    this.config = config;
  }

  static getIndicators() {
    return [
      // 50-period channel
      addIndicator(movingAverageOf, 50, "high"),
      addIndicator(movingAverageOf, 50, "low"),
      // SMA200 for trend filter
      addIndicator(movingAverageOf, 200, "close"),
      addIndicator(calculateCandleProperty),
      addIndicator(calculateATR, 10),
      addIndicator(calculateSuperTrendForQuote, 2),
    ];
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 5,
      maxAllocation: 0.8,
    };
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    if (!today || !yesterday) return;

    // SMA200 filter: require price > SMA200 for longs
    if (today.ma200close !== undefined && today.close <= today.ma200close) {
      return false;
    }

    const today_body = today.close - today.open;
    const yesterday_body = yesterday.close - yesterday.open;

    if (
      today.close > today.ma50high &&
      today_body > 0 &&
      yesterday_body > 0 &&
      today.superTrendDirection === "Buy"
    ) {
      const buyingPrice = today.close;
      // Keep stop same 4% below entry
      const initialStopLoss = buyingPrice * 0.96;
      const riskForOneStock = buyingPrice - initialStopLoss;
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice);
      return true;
    }
    return false;
  }

  longSquareOff() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    if (!today || !yesterday) return;

    const today_body = today.close - today.open;

    const ma50high_yesterday = yesterday.ma50high;
    if (ma50high_yesterday > today.low && today_body < 0) {
      this.exitPosition(ma50high_yesterday, this.currentTrade.quantity);
      return this.sell();
    }
    return false;
  }

  sell() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    if (!today || !yesterday) return;

    // SMA200 filter: require price < SMA200 for shorts
    if (today.ma200close !== undefined && today.close >= today.ma200close) {
      return false;
    }

    const today_body = today.close - today.open;
    const yesterday_body = yesterday.close - yesterday.open;

    if (
      today.close < today.ma50low &&
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
    return false;
  }

  shortSquareOff() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    if (!today || !yesterday) return;

    const today_body = today.close - today.open;
    const ma50low_yesterday = yesterday.ma50low;
    if (today.high > ma50low_yesterday && today_body > 0) {
      this.exitPosition(ma50low_yesterday, this.currentTrade.quantity);
      return this.buy();
    }
    return false;
  }

  static strategyName = "MovingAverage_v2";
}

export default MovingAverageStrategy_v2;
