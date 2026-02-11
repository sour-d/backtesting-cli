import { Strategy } from "./Strategy.js";
import calculateATR from "../indicators/atr.js";
import calculateEMA from "../indicators/ema.js";
import calculateRSI from "../indicators/rsi.js";
import { movingAverageOf } from "../indicators/nDayMA.js";

const addIndicator =
  (indicatorFn, ...extraArgs) =>
  (quote, technicalQuotes) =>
    indicatorFn(quote, technicalQuotes, ...extraArgs);

class BTCTrendStrategy extends Strategy {
  constructor(config = BTCTrendStrategy.getDefaultConfig()) {
    super(config);
    this.config = config;
  }

  static getIndicators() {
    return [
      addIndicator(calculateEMA, 12),   // fast EMA
      addIndicator(calculateEMA, 26),   // slow EMA
      addIndicator(calculateRSI, 14),
      addIndicator(calculateATR, 14),
      addIndicator(movingAverageOf, 200, "close"), // sma200
      addIndicator(movingAverageOf, 20, "close"),  // sma20 for pre-trade filter
    ];
  }

  static getDefaultConfig() {
    return {
      capital: 10000,
      riskPercentage: 10, // aggressive risk to hit >20% annual
      maxAllocation: 0.8, // allow up to 80% of capital in a position
      rsiThreshold: 30,   // lower threshold for more entries
      rsiMax: 65,         // avoid overbought (upper bound)
      atrStopMult: 2.0,
      atrTPMult: 8.0,     // higher take profit
      useSMAFilter: true,
      // Pre-trade filters
      preTradeDays: 10,               // lookback period for pre-trade analysis
      minHHillRatio: 0.5,             // minimum higher-highs ratio
      maxATRPercent: 5.0,             // maximum ATR as % of price
      maxVolumeSpike: 1.5,            // maximum volume multiplier vs average
      requirePriceAboveSMA20: true,   // require price > SMA20
    };
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    if (!today || !yesterday) return false;

    const fastEMA = today.ema12;
    const slowEMA = today.ema26;
    const rsi = today.rsi;
    const close = today.close;
    const atr = today.atr;
    const volume = today.volume;

    // === Pre-trade filters ===
    const lookback = this.config.preTradeDays || 10;

    // 1. RSI upper bound: avoid overbought
    if (rsi >= (this.config.rsiMax || 65)) return false;

    // 2. ATR% check: avoid extremely volatile entries
    const atrPercent = (atr / close) * 100;
    if (atrPercent >= (this.config.maxATRPercent || 5.0)) return false;

    // 3. Volume check: avoid volume spikes (exhaustion)
    if (this.config.maxVolumeSpike) {
      const volumeWindow = this.stock.dataOfLast(lookback);
      let avgVolume = 0;
      let count = 0;
      while (volumeWindow.move()) {
        avgVolume += volumeWindow.now().volume;
        count++;
      }
      if (count > 0) {
        avgVolume /= count;
        if (avgVolume > 0 && volume > avgVolume * this.config.maxVolumeSpike) {
          return false;
        }
      }
    }

    // 4. Higher-highs ratio: require trend structure
    if (this.config.minHHillRatio !== undefined) {
      const hhWindow = this.stock.dataOfLast(lookback + 1); // include today + N prior days
      const highs = [];
      while (hhWindow.move()) {
        highs.push(hhWindow.now().high);
      }
      // Need at least 2 days to compare
      if (highs.length >= 2) {
        let hhCount = 0;
        let total = 0;
        // Compare each day to the previous day (most recent first)
        // We have: highs[0] = oldest, highs[highs.length-1] = today
        for (let i = 1; i < highs.length; i++) {
          if (highs[i] > highs[i-1]) {
            hhCount++;
          }
          total++;
        }
        const hhRatio = total > 0 ? hhCount / total : 0;
        if (hhRatio < this.config.minHHillRatio) return false;
      }
    }

    // 5. Price above SMA20 (trend alignment)
    if (this.config.requirePriceAboveSMA20 && today.ma20close !== undefined) {
      if (close <= today.ma20close) return false;
    }

    // === Core conditions ===
    const trendCondition = fastEMA > slowEMA;
    const momentumCondition = rsi > this.config.rsiThreshold;
    const majorTrendCondition = !this.config.useSMAFilter || close > today.ma200close;

    if (trendCondition && momentumCondition && majorTrendCondition) {
      const entryPrice = close;
      const stopDist = atr * this.config.atrStopMult;
      const tpDist = atr * this.config.atrTPMult;
      const risk = stopDist;
      if (risk <= 0) return false;

      this.takePosition(risk, entryPrice);
      if (this.currentTrade) {
        this.currentTrade.takeProfit = entryPrice + tpDist;
      } else {
        return false; // position not opened
      }
      return true;
    }
    return false;
  }

  longSquareOff() {
    if (!this.currentTrade) return false;
    const today = this.stock.now();
    // Take profit?
    if (this.currentTrade.takeProfit && today.high >= this.currentTrade.takeProfit) {
      this.exitPosition(this.currentTrade.takeProfit, this.currentTrade.quantity);
      return true;
    }
    // Exit on trend reversal (EMA cross down)
    const fastEMA = today.ema12;
    const slowEMA = today.ema26;
    if (fastEMA < slowEMA) {
      this.exitPosition(today.close, this.currentTrade.quantity);
      return true;
    }
    return false;
  }

  sell() { return false; }
  shortSquareOff() { return false; }

  static strategyName = "BTCTrendFixedV2";
}

export default BTCTrendStrategy;
