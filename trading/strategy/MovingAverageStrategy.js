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
    const towDaysBeforeYesterday = this.stock.prev(3);
    if (
      yesterday.close > yesterday.ma60close &&
      yesterday.close > yesterday.ma20high &&
      dayBeforeYesterday.close > dayBeforeYesterday.ma20high &&
      towDaysBeforeYesterday.close > towDaysBeforeYesterday.ma20high
      // true
    ) {
      const { open: buyingPrice } = this.stock.now();
      const { low: initialStopLoss } = dayBeforeYesterday;
      const riskForOneStock = buyingPrice - initialStopLoss;
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice);
      return true;
    }
  }

  sell() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    const towDaysBeforeYesterday = this.stock.prev(3);
    if (
      yesterday.close < yesterday.ma60close &&
      yesterday.close < yesterday.ma20low &&
      dayBeforeYesterday.close < dayBeforeYesterday.ma20low &&
      towDaysBeforeYesterday.close < towDaysBeforeYesterday.ma20low
    ) {
      const { open: sellingPrice } = this.stock.now();
      const { high: initialStopLoss } = dayBeforeYesterday;
      const riskForOneStock = initialStopLoss - sellingPrice;
      if (initialStopLoss <= sellingPrice) return;
      this.takePosition(riskForOneStock, sellingPrice, "Sell");
      return true;
    }
  }

  shortSquareOff() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    const today = this.stock.now();
    const totalRisk = this.currentTrade.risk * this.currentTrade.position;
    const priceDifference = today.close - this.currentTrade.price;

    if (priceDifference >= totalRisk) {
      return this.exitPosition(today.open, this.currentTrade.position);
    }
    const holdingDays = dayjs(today.dateUnix).diff(
      dayjs(this.currentTrade.transactionDate.dateUnix),
      "day"
    );
    const stoplossHit =
      this.currentTrade.price < today.high &&
      today.high - this.currentTrade.price >= this.currentTrade.risk;
    if (stoplossHit) {
      return this.exitPosition(
        this.currentTrade.price + this.currentTrade.risk,
        this.currentTrade.position
      );
    }
    if (holdingDays > 10) {
      return this.exitPosition(today.open, this.currentTrade.position);
    }
  }

  longSquareOff() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    const today = this.stock.now();
    const priceUpPercent =
      (yesterday.close - this.currentTrade.price) / this.currentTrade.price;

    if (priceUpPercent >= 0.005) {
      return this.exitPosition(today.open, this.currentTrade.position);
    }
    const holdingDays = dayjs(today.dateUnix).diff(
      dayjs(this.currentTrade.transactionDate.dateUnix),
      "day"
    );
    const stoplossHit =
      this.currentTrade.price > today.low &&
      this.currentTrade.price - today.low >= this.currentTrade.risk;
    if (stoplossHit) {
      return this.exitPosition(
        this.currentTrade.price - this.currentTrade.risk,
        this.currentTrade.position
      );
    }
    if (holdingDays > 10) {
      return this.exitPosition(today.open, this.currentTrade.position);
    }
  }
}

export default MovingAverageStrategy;
