import dayjs from "dayjs";
import { Strategy } from "./Strategy.js";
import { time } from "console";

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
      capital: 100000,
      riskPercentage: 1,
    };
  }

  shouldTrade() {
    const { date, time } = this.stock.now();
    const currentTime = dayjs(`${date} ${time}`, "YYYY-MM-DD HH:mm");
    const startTime = dayjs(`${date} 09:45`, "YYYY-MM-DD HH:mm");
    const endTime = dayjs(`${date} 15:15`, "YYYY-MM-DD HH:mm");
    return currentTime.isAfter(startTime) && currentTime.isBefore(endTime);
  }

  buy() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    if (
      // yesterday.close > yesterday.ma60close &&
      yesterday.close > yesterday.ma20high &&
      dayBeforeYesterday.close < dayBeforeYesterday.ma20high &&
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
      this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.quantity);
      return this.sell();
    }

    // const priceChange = today.high - this.currentTrade.price;
    // const risk = this.risk / this.currentTrade.quantity;
    // const target = this.currentTrade.price + risk * 1;
    // if (today.high >= target) {
    //   console.log({ risk, tr: this.currentTrade.risk });
    //   this.exitPosition(target, this.currentTrade.quantity);
    //   return this.sell();
    // }

    const sessionEnd = dayjs(`${today.date} 15:15`, "YYYY-MM-DD HH:mm");
    if (
      dayjs(today.date).isSame(sessionEnd, "day") ||
      dayjs(today.date).isAfter(sessionEnd, "day")
    ) {
      return this.exitPosition(today.close, this.currentTrade.quantity);
      // return this.buy();
    }

    if (
      today.ma20high > today.close &&
      today.ma20high > today.open &&
      today.body < 0
    ) {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return this.sell();
    }

    if (
      yesterday.ma20high > yesterday.close &&
      today.ma20high > today.close &&
      today.body < 0
    ) {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return this.sell();
    }

    if (today.superTrendDirection === "Sell") {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return this.sell();
    }
  }

  sell() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    if (
      // yesterday.close < yesterday.ma60close &&
      yesterday.close < yesterday.ma20low &&
      dayBeforeYesterday.close > dayBeforeYesterday.ma20low &&
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
      this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.quantity);
      return this.buy();
    }

    // const priceChange = this.currentTrade.price - today.low;
    // const risk = this.risk / this.currentTrade.quantity;
    // const target = this.currentTrade.price - risk * 1;
    // if (today.low <= target) {
    //   console.log({ risk, tr: this.currentTrade.risk });
    //   this.exitPosition(target, this.currentTrade.quantity);
    //   return this.buy();
    // }
    const sessionEnd = dayjs(`${today.date} 15:15`, "YYYY-MM-DD HH:mm");
    if (
      dayjs(today.date).isSame(sessionEnd, "day") ||
      dayjs(today.date).isAfter(sessionEnd, "day")
    ) {
      return this.exitPosition(today.close, this.currentTrade.quantity);
      // return this.buy();
    }

    if (
      today.close > today.ma20low &&
      today.open > today.ma20low &&
      today.body > 0
    ) {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return this.buy();
    }

    if (
      yesterday.close > yesterday.ma20low &&
      today.close > today.ma20low &&
      today.body > 0
    ) {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return this.buy();
    }

    if (today.superTrendDirection === "Buy") {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return this.buy();
    }
  }
}

export default MovingAverageStrategy;
