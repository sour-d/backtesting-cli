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
      capital: 100,
      riskPercentage: 5,
    };
  }

  buy() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);

    if (
      dayBeforeYesterday.close < dayBeforeYesterday.ma20close &&
      yesterday.close > yesterday.ma20close &&
      yesterday.body > 0
    ) {
      const { open: buyingPrice } = this.stock.now();
      const initialStopLoss = Math.max(yesterday.low, dayBeforeYesterday.low);
      const riskForOneStock = buyingPrice - initialStopLoss;
      if (initialStopLoss >= buyingPrice) return;
      this.takePosition(riskForOneStock, buyingPrice);
      return true;
    }
  }

  longSquareOff() {
    const today = this.stock.now();

    const target = this.currentTrade.price + this.currentTrade.risk * 1.2;
    if (today.high > target) {
      this.exitPosition(target, this.currentTrade.position);
      return this.sell();
    }

    if (this.currentTrade.stopLoss > today.close) {
      this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.position);
      return this.sell();
    }
  }

  sell() {
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);

    if (
      dayBeforeYesterday.close > dayBeforeYesterday.ma20close &&
      yesterday.close < yesterday.ma20close &&
      yesterday.body < 0
    ) {
      const { open: sellingPrice } = this.stock.now();
      const initialStopLoss = Math.min(yesterday.high, dayBeforeYesterday.high);
      const riskForOneStock = initialStopLoss - sellingPrice;
      if (initialStopLoss <= sellingPrice) return;
      this.takePosition(riskForOneStock, sellingPrice, "Sell");
      return true;
    }
  }

  shortSquareOff() {
    const today = this.stock.now();

    const target = this.currentTrade.price - this.currentTrade.risk * 1.2;
    console.log("target", target, today.low, this.currentTrade);
    if (today.low < target) {
      this.exitPosition(target, this.currentTrade.position);
      return this.buy();
    }

    if (this.currentTrade.stopLoss < today.close) {
      this.exitPosition(this.currentTrade.stopLoss, this.currentTrade.position);
      return this.buy();
    }
  }
}

export default MovingAverageStrategy;
