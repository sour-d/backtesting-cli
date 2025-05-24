import { Strategy } from "./Strategy.js";

class FortyTwentyStrategy extends Strategy {
  config;

  constructor(symbolInfo, persistTradesFn, config = FortyTwentyStrategy.getDefaultConfig()) {
    super(symbolInfo, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      buyWindow: 40,
      sellWindow: 20,
      capital: 100000,
      riskPercentage: 5,
    };
  }

  isHighBroken(today, highestDay) {
    return today.high > highestDay.high;
  }

  isLowBroken(today, lowestDay) {
    return today.low < lowestDay.low;
  }

  squareOff() {
    // if (this.currentTradeInfo === "sell") {
    //   const today = this.stock.now();
    //   const { high: stopLoss } = this.stock.highOfLast(this.config.sellWindow);

    //   if (today.high >= stopLoss) {
    //     this.exitPosition(stopLoss);
    //   }
    //   return;
    // }
    const today = this.stock.now();
    const { low: stopLoss } = this.stock.lowOfLast(this.config.sellWindow);
    if (today.low <= stopLoss) {
      this.exitPosition(stopLoss);
    }
  }

  sell() {
    // const { buyWindow, sellWindow } = this.config;
    // const today = this.stock.now();
    // const lastFortyDayLow = this.stock.lowOfLast(buyWindow);
    // if (this.isLowBroken(today, lastFortyDayLow)) {
    //   const { low: sellPrice } = this.stock.highOfLast(buyWindow);
    //   const { high: initialStopLoss } = this.stock.lowOfLast(sellWindow);
    //   const riskForOneStock = initialStopLoss - sellPrice;
    //   this.takePosition(riskForOneStock, sellPrice, "sell");
    // }
  }

  buy() {
    const { buyWindow, sellWindow } = this.config;
    const today = this.stock.now();
    const lastFortyDayHigh = this.stock.highOfLast(buyWindow);
    const avg = this.stock.simpleMovingAverage(200);
    if (this.isHighBroken(today, lastFortyDayHigh) && today.close > avg) {
      const { high: buyPrice } = this.stock.highOfLast(buyWindow);
      const { low: initialStopLoss } = this.stock.lowOfLast(sellWindow);
      const riskForOneStock = buyPrice - initialStopLoss;
      this.takePosition(riskForOneStock, buyPrice);
    }
  }

  static name = "FortyTwenty";
}

export default FortyTwentyStrategy;
