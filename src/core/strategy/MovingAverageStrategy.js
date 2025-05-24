import dayjs from "dayjs";
import { Strategy } from "./Strategy.js";

class MovingAverageStrategy extends Strategy {
  config;

  constructor(symbolInfo, persistTradesFn, config = MovingAverageStrategy.getDefaultConfig()) {
    super(symbolInfo, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      upperLimit: 20,
      lowerLimit: 10,
      stopLossWindow: 10,
      capital: 100000,
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
    const yesterday = this.stock.prev();

    if (this.currentTrade.stopLoss > today.close) {
      this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.position);
      return this.sell();
    }

    if (
      today.ma20high > today.close &&
      today.ma20high > today.open &&
      today.body < 0
    ) {
      this.exitPosition(today.close, this.currentTrade.position);
      return this.sell();
    }

    if (
      yesterday.ma20high > yesterday.close &&
      today.ma20high > today.close &&
      today.body < 0
    ) {
      this.exitPosition(today.close, this.currentTrade.position);
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
    const yesterday = this.stock.prev();

    if (today.close > this.currentTrade.stopLoss) {
      this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.position);
      return this.buy();
    }

    if (
      today.close > today.ma20low &&
      today.open > today.ma20low &&
      today.body > 0
    ) {
      this.exitPosition(today.close, this.currentTrade.position);
      return this.buy();
    }

    if (
      yesterday.close > yesterday.ma20low &&
      today.close > today.ma20low &&
      today.body > 0
    ) {
      this.exitPosition(today.close, this.currentTrade.position);
      return this.buy();
    }

    if (today.superTrendDirection === "Buy") {
      this.exitPosition(today.close, this.currentTrade.position);
      return this.buy();
    }
  }

  static name = "MovingAverage";
}

export default MovingAverageStrategy;
