import dayjs from "dayjs";
import { Strategy } from "./Strategy.js";

class StopLossHunter extends Strategy {
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

    // if (
    //   yesterday.ema9close > yesterday.close &&
    //   yesterday.low > yesterday.bbLower20close &&
    //   // yesterday.ema9close - yesterday.bbLower20close > yesterday.bbUpper20close - yesterday.ema9close &&
    //   today.body > 0 &&
    //   today.close > today.bbLower20close
    // ) {
    //   console.log('buying', today, yesterday.ema9close - yesterday.bbLower20close, yesterday.bbUpper20close - yesterday.ema9close);
    // }

    if (
      yesterday.ema9close > yesterday.close &&
      yesterday.low < yesterday.bbLower20close &&
      yesterday.body < 0 &&
      // yesterday.ema9close - yesterday.bbLower20close > yesterday.bbUpper20close - yesterday.ema9close &&
      today.body > 0 &&
      today.close > today.bbLower20close
    ) {
      console.log('buu')
      // const closeMaDiff = (today.close - today.ma5close);
      // if (closeMaDiff / today.body < 0.3) return false;
      // const totalLength = yesterday.high - yesterday.low;
      // const bodyPercentage = (Math.abs(yesterday.body) / totalLength) * 100;
      // if (bodyPercentage > 10) return false;
      const { close: buyingPrice } = today;
      const initialStopLoss = Math.min(yesterday.low, today.low);
      const riskForOneStock = (buyingPrice - initialStopLoss);
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice);
      return true;
    }
  }

  longSquareOff() {
    const today = this.stock.now();

    if (today.high > today.bbUpper20close) {
      this.sell(today.bbUpper20close);
    }

    if (today.close < this.currentTrade.stopLoss) {
      this.sell(this.currentTrade.stopLoss);
    }
  }

  sell() {

  }

  shortSquareOff() {

  }
}

export default StopLossHunter;