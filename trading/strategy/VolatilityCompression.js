import dayjs from "dayjs";
import { Strategy } from "./Strategy.js";

class VolatilityCompression extends Strategy {
  config;

  constructor(stockName, persistTradesFn, config = this.getDefaultConfig()) {
    super(stockName, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      upperLimit: 100,
      lowerLimit: 50,
      capital: 100000,
      riskPercentage: 1,
    };
  }

  // shouldTrade() {
  // const { date, time } = this.stock.now();
  // const currentTime = dayjs(`${date} ${time}`, "YYYY-MM-DD HH:mm");
  // const startTime = dayjs(`${date} 09:45`, "YYYY-MM-DD HH:mm");
  // const endTime = dayjs(`${date} 15:15`, "YYYY-MM-DD HH:mm");
  // return currentTime.isAfter(startTime) && currentTime.isBefore(endTime);
  // }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    // if (today.date === "2024-06-27") {
    //   console.log({
    //     cond1: yesterday.volatilityCompressionPresent,
    //     cond2: !today.volatilityCompressionPresent,
    //     cond3: today.close > yesterday.volatilityCompressionRange.high,
    //     cond4: today.body > 0,
    //     // cond5: yesterday.volatilityCompressionRange.volumeChange * 100 > 40,
    //     today,
    //     yesterday,
    //   });
    // }

    if (
      yesterday.volatilityCompressionPresent &&
      !today.volatilityCompressionPresent &&
      today.close > yesterday.volatilityCompressionRange.high &&
      today.body > 0 &&
      today.open < yesterday.volatilityCompressionRange.high &&
      yesterday.volatilityCompressionRange.isOppositePattern &&
      yesterday.volatilityCompressionRange.volumeChange * 100 > 0
      // true
    ) {
      const { close: buyingPrice } = today;
      const initialStopLoss = yesterday.volatilityCompressionRange.low;
      const riskForOneStock = buyingPrice - initialStopLoss;
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice);
      return true;
    }
  }

  longSquareOff() {
    this.currentTrade.daysInBetween = this.currentTrade.daysInBetween
      ? this.currentTrade.daysInBetween + 1
      : 1;
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    // const buffer = 0.005;
    // const newStopLoss =
    //   this.currentTrade.stopLoss - this.currentTrade.stopLoss * buffer;
    // console.log({ newStopLoss, stopLoss: this.currentTrade.stopLoss });
    // const newStopLoss = this.currentTrade.stopLoss;
    if (today.close < this.currentTrade.stopLoss) {
      // console.log("stoploss hit");
      return this.exitPosition(this.currentTrade.stopLoss);
    }
    // if (today.superTrendDirection === "sell") {
    //   return this.exitPosition(today.close);
    // }

    // if (this.currentTrade.daysInBetween > 3) {
    if (today.ma9close > today.close && today.close > this.currentTrade.price) {
      // console.log("ma9close > close");
      return this.exitPosition(today.close);
    }
    // }
    const risk = this.currentTrade.risk;
    const firstTarget = this.currentTrade.price + risk * 1;
    const secondTarget = this.currentTrade.price + risk * 2;
    // console.log({ firstTarget, secondTarget, risk });
    // if (!this.currentTrade.halfSold && today.high > firstTarget) {
    // this.currentTrade.halfSold = true;
    //   return this.exitPosition(firstTarget, this.currentTrade.quantity / 2);
    // }
    if (today.high > secondTarget && !this.currentTrade.halfSold) {
      this.currentTrade.halfSold = true;
      return this.exitPosition(secondTarget, this.currentTrade.quantity * 0.8);
    }
    if (
      yesterday.volatilityCompressionPresent &&
      !today.volatilityCompressionPresent &&
      today.close < yesterday.volatilityCompressionRange.low &&
      today.body < 0 &&
      // yesterday.volatilityCompressionRange.volumeChange * 100 > 40
      true
    ) {
      // console.log("volatilityCompressionPresent");
      return this.exitPosition(today.close);
    }

    if (yesterday.date !== today.date) {
      return this.exitPosition(yesterday.close);
    }
  }

  sell() {
    // const today = this.stock.now();
  }

  shortSquareOff() { }
}

export default VolatilityCompression;