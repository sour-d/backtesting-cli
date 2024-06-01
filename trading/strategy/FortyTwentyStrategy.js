import { Strategy } from "./Strategy.js";

class FortyTwentyStrategy extends Strategy {
  config;

  constructor(stockName, persistTradesFn, config = this.getDefaultConfig()) {
    super(stockName, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      buyWindow: 62,
      sellWindow: 22,
      capital: 100,
      riskPercentage: 0.1,
    };
  }

  isHighBroken(today, highestDay) {
    return today.high > highestDay.high;
  }

  squareOff() {
    const today = this.stock.now();
    const { low: stopLoss } = this.stock.lowOfLast(this.config.sellWindow);
    if (today.low <= stopLoss) {
      this.exitPosition(stopLoss);
    }
  }

  sell() {}

  buy() {
    const { buyWindow, sellWindow } = this.config;
    const today = this.stock.now();
    const lastFortyDayHigh = this.stock.highOfLast(buyWindow);

    if (this.isHighBroken(today, lastFortyDayHigh)) {
      const { high: buyPrice } = this.stock.highOfLast(buyWindow);
      const { low: initialStopLoss } = this.stock.lowOfLast(sellWindow);
      const riskForOneStock = buyPrice - initialStopLoss;

      this.takePosition(riskForOneStock, buyPrice);
    }
  }
}

export default FortyTwentyStrategy;
