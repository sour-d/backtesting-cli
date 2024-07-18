import { Strategy } from "./Strategy.js";

class TwoBreakingCandle extends Strategy {
  config;

  constructor(stockName, persistTradesFn, config = this.getDefaultConfig()) {
    super(stockName, persistTradesFn, config);
    this.config = config;
  }

  static getDefaultConfig() {
    return {
      capital: 100,
      riskPercentage: 0.1,
    };
  }

  isGreenCandle(quote) {
    return quote["Body"] > 0;
  }

  squareOff() {
    const { low: stopLoss } = this.stock.lowOfLast(3);
    const today = this.stock.now();
    if (today.low <= stopLoss) {
      this.exitPosition(stopLoss, this.currentTradeInfo.quantity);
    }
  }

  sell() {
    return false;
  }

  buy() {
    const prev = this.stock.prev();
    const today = this.stock.now();

    if (this.isGreenCandle(prev) && this.isGreenCandle(today)) {
      const { close: buyingPrice } = today;
      const { low: initialStopLoss } = this.stock.lowOfLast(3);
      const riskForOneStock = buyingPrice - initialStopLoss;

      if (riskForOneStock > 0) {
        this.takePosition(riskForOneStock, buyingPrice, "buy");
        return true;
      }
    }
    return false;
  }
}

export default TwoBreakingCandle;
