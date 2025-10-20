import { Strategy } from "./Strategy.js";
import calculateBollingerBands from "../indicators/bollingerBands.js";
import { addIndicator } from "../indicators/index.js";

class BBStrategy extends Strategy {
  config;

  constructor(
    symbolInfo,
    persistTradesFn,
    config = BBStrategy.getDefaultConfig()
  ) {
    super(symbolInfo, persistTradesFn, config);
    this.config = config;
  }

  static getIndicators() {
    return [addIndicator(calculateBollingerBands, 20, 2, "close")];
  }

  static getDefaultConfig() {
    return {
      upperLimit: 20,
      lowerLimit: 10,
      stopLossWindow: 10,
      capital: 100000,
      riskPercentage: 5,
    };
  }

  buy() {}

  longSquareOff() {}

  sell() {}

  shortSquareOff() {}

  static name = "BollingerBandsStrategy";
}

export default BBStrategy;
