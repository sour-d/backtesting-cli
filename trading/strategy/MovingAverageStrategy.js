import dayjs from "dayjs";
import { Strategy } from "./Strategy.js";

class MovingAverageStrategy extends Strategy {
  config;

  constructor(stockName, persistTradesFn, config = this.getDefaultConfig()) {
    super(stockName, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      upperLimit: 20,
      lowerLimit: 10,
      stopLossWindow: 10,
      capital: 100,
      riskPercentage: 5,
    };
  }

  buy() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    if (
      // yesterday.close > yesterday.ma60close &&
      yesterday.close > yesterday.ma20high &&
      yesterday.body > 0 &&
      dayBeforeYesterday.body > 0 &&
      yesterday.superTrendDirection === "Buy"
    ) {
      const { open: buyingPrice } = this.stock.now();
      const { ma20low: initialStopLoss } = yesterday;
      const riskForOneStock = buyingPrice - initialStopLoss;
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice);
      return true;
    }
  }

  longSquareOff() {
    const today = this.stock.now();

    if (this.currentTrade.stopLoss > today.close) {
      this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.position);
      return this.sell();
    }

    if (today.ma20low > today.close) {
      this.exitPosition(today.ma20low, this.currentTrade.position);
      return this.sell();
    }

    if (today.superTrendDirection === "Sell") {
      this.exitPosition(today.close, this.currentTrade.position);
      return this.sell();
    }
  }

  sell() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    if (
      // yesterday.close < yesterday.ma60close &&
      yesterday.close < yesterday.ma20low &&
      yesterday.body < 0 &&
      dayBeforeYesterday.body < 0 &&
      yesterday.superTrendDirection === "Sell"
    ) {
      const { open: sellingPrice } = this.stock.now();
      const { ma20high: initialStopLoss } = yesterday;
      const riskForOneStock = initialStopLoss - sellingPrice;
      if (initialStopLoss <= sellingPrice) return;
      this.takePosition(riskForOneStock, sellingPrice, "Sell");
      return true;
    }
  }

  shortSquareOff() {
    const today = this.stock.now();

    if (today.close > this.currentTrade.stopLoss) {
      this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.position);
      return this.buy();
    }

    if (today.close > today.ma20high) {
      this.exitPosition(today.ma20high, this.currentTrade.position);
      return this.buy();
    }

    if (today.superTrendDirection === "Buy") {
      this.exitPosition(today.close, this.currentTrade.position);
      return this.buy();
    }
  }
}

export default MovingAverageStrategy;
