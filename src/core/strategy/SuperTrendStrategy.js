import calculateATR from "../indicators/atr.js";
import { movingAverageOf } from "../indicators/nDayMA.js";
import calculateSuperTrendForQuote from "../indicators/superTrend.js";
import { Strategy } from "./Strategy.js";

const addIndicator =
  (indicatorFn, ...extraArgs) =>
  (quote, technicalQuotes) =>
    indicatorFn(quote, technicalQuotes, ...extraArgs);

class SuperTrendStrategy extends Strategy {
  config;

  constructor(
    symbolInfo,
    persistTradesFn,
    config = SuperTrendStrategy.getDefaultConfig()
  ) {
    super(symbolInfo, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 1,
    };
  }

  static getIndicators() {
    return [
      addIndicator(calculateATR, 10),
      addIndicator(calculateSuperTrendForQuote, 2),
      addIndicator(movingAverageOf, 60, 'close')
    ];
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    // console.log(today)

    if (
      today.close > today.ma60close &&
      today.superTrendDirection === "Buy" &&
      yesterday.superTrendDirection === "Sell" &&
      dayBeforeYesterday.superTrendDirection === "Sell"
    ) {
      console.log("buy stra")
      const { close: buyingPrice } = today;
      const initialStopLoss = Math.min(
        today.finalLowerBand,
        yesterday.finalLowerBand,
        dayBeforeYesterday.finalLowerBand,
        dayBeforeYesterday.low,
        yesterday.low,
        today.low
      );
      const riskForOneStock = buyingPrice - initialStopLoss;
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice, "Buy");
      return true;
    }
  }

  sell() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    if (
      today.close < today.ma60close &&
      today.superTrendDirection === "Sell" &&
      yesterday.superTrendDirection === "Buy" &&
      dayBeforeYesterday.superTrendDirection === "Buy"
    ) {
      const { close: sellingPrice } = today;
      const initialStopLoss = Math.max(
        today.finalUpperBand,
        yesterday.finalUpperBand,
        dayBeforeYesterday.finalUpperBand,
        dayBeforeYesterday.high,
        yesterday.high,
        today.high
      );
      const riskForOneStock = initialStopLoss - sellingPrice;
      if (initialStopLoss <= sellingPrice) return;
      this.takePosition(riskForOneStock, sellingPrice, "Sell");
      return true;
    }
  }

  longSquareOff() {
    const today = this.stock.now();

    if (today.superTrendDirection === "Sell") {
      this.exitPosition(today.close, this.currentTrade.quantity);
      this.sell();
      return;
    }
  }

  shortSquareOff() {
    const today = this.stock.now();

    if (today.superTrendDirection === "Buy") {
      this.exitPosition(today.close, this.currentTrade.quantity);
      this.buy();
      return;
    }
  }

  static name = "SuperTrend";
}

export default SuperTrendStrategy;
