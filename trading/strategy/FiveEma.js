import dayjs from "dayjs";
import { Strategy } from "./Strategy.js";

class FiveEmaScalp extends Strategy {
  config;

  constructor(stockName, persistTradesFn, config = this.getDefaultConfig()) {
    super(stockName, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      upperLimit: 100,
      lowerLimit: 50,
      capital: 100,
      riskPercentage: 5,
      targetMultiplier: 2,
      leverage: 20,
    };
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);
    const dayBeforeDayBeforeYesterday = this.stock.prev(3);

    if (
      dayBeforeDayBeforeYesterday.ma5close > dayBeforeDayBeforeYesterday.high &&
      dayBeforeYesterday.ma5close > dayBeforeYesterday.high &&
      yesterday.ma5close > yesterday.high &&
      today.body > 0 &&
      today.ma5close < today.close &&
      today.ma10close < today.close &&
      today.volume > yesterday.volume
    ) {
      const closeMaDiff = (today.close - today.ma5close);
      if (closeMaDiff / today.body < 0.3) return false;
      const totalLength = yesterday.high - yesterday.low;
      const bodyPercentage = (Math.abs(yesterday.body) / totalLength) * 100;
      if (bodyPercentage > 10) return false;
      const { close: buyingPrice } = today;
      const initialStopLoss = yesterday.low;
      const riskForOneStock = (buyingPrice - initialStopLoss);
      console.log("riskForOneStock", riskForOneStock, buyingPrice, initialStopLoss);
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

    const risk = this.currentTrade.risk;
    const target = this.currentTrade.price + risk * this.config.targetMultiplier;
    if (today.high > target) {
      return this.exitPosition(target);
    }

    if (this.currentTrade.stopLoss > today.low) {
      return this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.quantity);
    }
  }

  sell() {
    // const today = this.stock.now();
    // const yesterday = this.stock.prev();
    // const dayBeforeYesterday = this.stock.prev(2);

    // if (
    //   dayBeforeYesterday.ma5close < dayBeforeYesterday.low &&
    //   dayBeforeYesterday.body > 0 &&
    //   yesterday.ma5close < yesterday.low &&
    //   yesterday.body > 0 &&
    //   today.body < 0 &&
    //   today.ma5close > today.close
    //   // today.volume > yesterday.volume
    // ) {
    //   // const closeMaDiff = (today.close - today.ma5close);
    //   // if (closeMaDiff / this.body < 0.3) return false;
    //   const totalLength = yesterday.high - yesterday.low;
    //   const bodyPercentage = (Math.abs(yesterday.body) / totalLength) * 100;
    //   if (bodyPercentage > 10) return false;
    //   const { close: sellingPrice } = today;
    //   const initialStopLoss = yesterday.high;
    //   const riskForOneStock = (initialStopLoss - sellingPrice);
    //   console.log("riskForOneStock", riskForOneStock, sellingPrice, initialStopLoss);
    //   if (initialStopLoss <= sellingPrice) return;
    //   this.takePosition(riskForOneStock, sellingPrice, "SELL");
    //   return true;
    // }
  }

  shortSquareOff() {
    // this.currentTrade.daysInBetween = this.currentTrade.daysInBetween
    //   ? this.currentTrade.daysInBetween + 1
    //   : 1;
    // const today = this.stock.now();

    // const risk = this.currentTrade.risk;
    // const target = this.currentTrade.price - risk * this.config.targetMultiplier;
    // if (today.low < target) {
    //   return this.exitPosition(target);
    // }

    // if (this.currentTrade.stopLoss < today.high) {
    //   return this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.quantity);
    // }
  }
}

export default FiveEmaScalp;