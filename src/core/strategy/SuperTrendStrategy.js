import { Strategy } from "./Strategy.js";

class SuperTrendStrategy extends Strategy {
  config;

  constructor(symbol, interval, persistTradesFn, config = SuperTrendStrategy.getDefaultConfig()) {
    super(symbol, interval, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 1,
    };
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);

    if (
      today.close > today.ma60close &&
      today.superTrendDirection === "Buy" &&
      yesterday.superTrendDirection === "Sell" &&
      dayBeforeYesterday.superTrendDirection === "Sell"
    ) {
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
