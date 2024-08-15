import dayjs from "dayjs";
import { Strategy } from "./Strategy.js";

class BreakoutStrategy extends Strategy {
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

  shouldTrade() {
    const { date, time } = this.stock.now();
    const currentTime = dayjs(`${date} ${time}`, "YYYY-MM-DD HH:mm");
    const startTime = dayjs(`${date} 09:45`, "YYYY-MM-DD HH:mm");
    const endTime = dayjs(`${date} 15:15`, "YYYY-MM-DD HH:mm");
    return currentTime.isAfter(startTime) && currentTime.isBefore(endTime);
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);

    const { upperLimit, lowerLimit } = this.config;
    const highKeyName = `${upperLimit}daysHigh`;
    const lowKeyName = `${lowerLimit}daysLow`;

    if (
      today[highKeyName] < today.high &&
      yesterday[highKeyName] < yesterday.high &&
      dayBeforeYesterday[highKeyName] > dayBeforeYesterday.high
    ) {
      const { close: buyingPrice } = today;
      const initialStopLoss = today[lowKeyName];
      const riskForOneStock = buyingPrice - initialStopLoss;
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice);
      return true;
    }
  }

  longSquareOff() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();

    const { lowerLimit } = this.config;
    const lowKeyName = `${lowerLimit}daysLow`;

    if (
      yesterday[lowKeyName] > yesterday.low &&
      today[lowKeyName] > today.low
    ) {
      return this.exitPosition(today.close);
      // return this.sell();
    }

    if (today.superTrendDirection === "Sell") {
      return this.exitPosition(today.close);
      // return this.sell();
    }
  }

  sell() {
    // const today = this.stock.now();
  }

  shortSquareOff() {}
}

export default BreakoutStrategy;
