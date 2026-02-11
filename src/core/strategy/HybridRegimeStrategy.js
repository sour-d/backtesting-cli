import { Strategy } from "./Strategy.js";
import calculateEMA from "../indicators/ema.js";
import calculateRSI from "../indicators/rsi.js";
import calculateATR from "../indicators/atr.js";
import { movingAverageOf } from "../indicators/nDayMA.js";
import calculateSuperTrendForQuote from "../indicators/superTrend.js";

const addIndicator =
  (indicatorFn, ...extraArgs) =>
  (quote, technicalQuotes) =>
    indicatorFn(quote, technicalQuotes, ...extraArgs);

// Helper to compute ATR and store under a custom key
const atrWithKey = (period, key) => (quote, technicalQuotes) => {
  calculateATR(quote, technicalQuotes, period);
  quote[key] = quote.atr;
};

class HybridRegimeStrategy extends Strategy {
  constructor(config = HybridRegimeStrategy.getDefaultConfig()) {
    super(config);
    this.config = config;
    this.currentRegime = null; // 'MA' or 'BTC'
  }

  static getIndicators() {
    return [
      // Common
      addIndicator(calculateEMA, 12),
      addIndicator(calculateEMA, 26),
      addIndicator(calculateRSI, 14),
      // ATR for BTCTrend (14) and for SuperTrend (10)
      atrWithKey(14, 'atr14'),
      atrWithKey(10, 'atr10'),
      // Moving averages for BTCTrend
      addIndicator(movingAverageOf, 200, "close"),
      addIndicator(movingAverageOf, 20, "close"),
      // For regime detection (SMA50)
      addIndicator(movingAverageOf, 50, "close"),
      // For MovingAverage channel
      addIndicator(movingAverageOf, 20, "high"),
      addIndicator(movingAverageOf, 20, "low"),
      // Set quote.atr = atr10 for SuperTrend
      (quote) => { quote.atr = quote.atr10; },
      // SuperTrend
      addIndicator(calculateSuperTrendForQuote, 2),
    ];
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 5, // default, overridden per regime
      maxAllocation: 0.8,
      // Regime detector: SMA50 deviation OR channel width
      trendThreshold: 0.02, // 2% deviation from SMA50
      channelWidthThreshold: 0.04, // 4% channel width
      // MovingAverage parameters
      maRiskPct: 5,
      maLongStopPct: 0.04,
      maShortStopPct: 0.04,
      // BTCTrend v3-relaxed parameters
      btcRiskPct: 10,
      btcRsiThreshold: 30,
      btcRsiMax: 70,
      btcAtrStopMult: 2.0,
      btcAtrTPMult: 8.0,
      btcPreTradeDays: 10,
      btcMinHHillRatio: 0.35,
      btcMaxATRPercent: 6.5,
      btcMaxVolumeSpike: 2.0,
      btcRequirePriceAboveSMA20: true,
    };
  }

  // Compute higher-highs ratio from an array of highs
  computeHHRatio(highs) {
    if (highs.length < 2) return 0;
    let hhCount = 0;
    let total = 0;
    for (let i = 1; i < highs.length; i++) {
      if (highs[i] > highs[i - 1]) hhCount++;
      total++;
    }
    return total > 0 ? hhCount / total : 0;
  }

  buy() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    if (!today || !yesterday) return false;

    const close = today.close;
    const fastEMA = today.ema12;
    const slowEMA = today.ema26;
    const rsi = today.rsi;
    const atr14 = today.atr14;
    const atrPercent = (atr14 / close) * 100;
    const lookback = this.config.btcPreTradeDays;

    // Regime detection: SMA50 deviation OR channel width
    const sma50 = today.ma50close; // fixed property name
    const deviation = sma50 ? Math.abs(close - sma50) / sma50 : 1;
    const channelWidth = (today.ma20high - today.ma20low) / close;
    const isTrending = (sma50 && deviation >= this.config.trendThreshold) || channelWidth >= this.config.channelWidthThreshold;

    if (isTrending) {
      // ---------- MovingAverage long entry ----------
      this.riskPercentage = this.config.maRiskPct;
      this.currentRegime = 'MA';

      const today_body = today.close - today.open;
      const yesterday_body = yesterday.close - yesterday.open;

      // Pure MA entry (no EMA filter)
      if (close > today.ma20high && today_body > 0 && yesterday_body > 0 && today.superTrendDirection === "Buy") {
        const buyingPrice = close;
        const initialStopLoss = buyingPrice * (1 - this.config.maLongStopPct);
        const risk = buyingPrice - initialStopLoss;
        if (risk <= 0) return false;
        this.takePosition(risk, buyingPrice);
        if (this.currentTrade) {
          this.currentTrade.strategy = 'MA';
        }
        return true;
      }
      return false;
    } else {
      // ---------- BTCTrend long entry ----------
      this.riskPercentage = this.config.btcRiskPct;
      this.currentRegime = 'BTC';

      if (rsi >= this.config.btcRsiMax) return false;
      if (rsi <= this.config.btcRsiThreshold) return false;
      if (atrPercent >= this.config.btcMaxATRPercent) return false;

      // Volume spike filter
      if (this.config.btcMaxVolumeSpike) {
        const volumeWindow = this.stock.dataOfLast(lookback);
        let avgVolume = 0;
        let count = 0;
        while (volumeWindow.move()) {
          avgVolume += volumeWindow.now().volume;
          count++;
        }
        if (count > 0) {
          avgVolume /= count;
          if (avgVolume > 0 && today.volume > avgVolume * this.config.btcMaxVolumeSpike) {
            return false;
          }
        }
      }

      // Higher-highs ratio
      if (this.config.btcMinHHillRatio > 0) {
        const hhWindow = this.stock.dataOfLast(lookback + 1);
        const highs = [];
        while (hhWindow.move()) {
          highs.push(hhWindow.now().high);
        }
        const hhRatio = this.computeHHRatio(highs);
        if (hhRatio < this.config.btcMinHHillRatio) return false;
      }

      // SMA20 filter
      if (this.config.btcRequirePriceAboveSMA20 && today.ma20close !== undefined) {
        if (close <= today.ma20close) return false;
      }

      // Major trend: price > SMA200 and EMA12 > EMA26
      if (close <= today.ma200close) return false;
      if (fastEMA <= slowEMA) return false;

      // Entry
      const entryPrice = close;
      const stopDist = atr14 * this.config.btcAtrStopMult;
      const tpDist = atr14 * this.config.btcAtrTPMult;
      const risk = stopDist;
      if (risk <= 0) return false;

      this.takePosition(risk, entryPrice);
      if (this.currentTrade) {
        this.currentTrade.takeProfit = entryPrice + tpDist;
        this.currentTrade.strategy = 'BTC';
      }
      return true;
    }
  }

  // Short entry only for MovingAverage in trending regime
  sell() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    if (!today || !yesterday) return false;

    const close = today.close;
    const fastEMA = today.ema12;
    const slowEMA = today.ema26;

    // Only short in trending regime
    const sma50 = today.ma50close;
    const deviation = sma50 ? Math.abs(close - sma50) / sma50 : 1;
    const channelWidth = (today.ma20high - today.ma20low) / close;
    const isTrending = (sma50 && deviation >= this.config.trendThreshold) || channelWidth >= this.config.channelWidthThreshold;

    if (!isTrending) return false;

    this.riskPercentage = this.config.maRiskPct;
    this.currentRegime = 'MA';

    const today_body = today.close - today.open;
    const yesterday_body = yesterday.close - yesterday.open;

    // Pure MA short entry (no EMA filter)
    if (close < today.ma20low && today_body < 0 && yesterday_body < 0 && today.superTrendDirection === "Sell") {
      const sellingPrice = close;
      const initialStopLoss = sellingPrice * (1 + this.config.maShortStopPct);
      const risk = initialStopLoss - sellingPrice;
      if (risk <= 0) return false;
      this.takePosition(risk, sellingPrice, "Sell");
      if (this.currentTrade) {
        this.currentTrade.strategy = 'MA';
      }
      return true;
    }
    return false;
  }

  longSquareOff() {
    if (!this.currentTrade) return false;
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    if (!today || !yesterday) return false;

    if (this.currentTrade.strategy === 'MA') {
      const today_body = today.close - today.open;
      if (today_body < 0) {
        const ma20high_yesterday = yesterday.ma20high;
        if (ma20high_yesterday > today.low) {
          this.exitPosition(ma20high_yesterday, this.currentTrade.quantity);
          // After exiting long, attempt short entry (reversal)
          return this.sell();
        }
      }
      return false;
    } else if (this.currentTrade.strategy === 'BTC') {
      // Take profit first
      if (this.currentTrade.takeProfit && today.high >= this.currentTrade.takeProfit) {
        this.exitPosition(this.currentTrade.takeProfit, this.currentTrade.quantity);
        return true;
      }
      // EMA cross exit
      const fastEMA = today.ema12;
      const slowEMA = today.ema26;
      if (fastEMA < slowEMA) {
        this.exitPosition(today.close, this.currentTrade.quantity);
        return true;
      }
      return false;
    }
    return false;
  }

  shortSquareOff() {
    if (!this.currentTrade) return false;
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    if (!today || !yesterday) return false;

    if (this.currentTrade.strategy === 'MA') {
      const today_body = today.close - today.open;
      if (today_body > 0) {
        const ma20low_yesterday = yesterday.ma20low;
        if (ma20low_yesterday < today.high) {
          this.exitPosition(ma20low_yesterday, this.currentTrade.quantity);
          // After exiting short, attempt long entry (reversal)
          return this.buy();
        }
      }
      return false;
    } else if (this.currentTrade.strategy === 'BTC') {
      // BTC does not short
      return false;
    }
    return false;
  }

  static strategyName = "HybridRegime";
}

export default HybridRegimeStrategy;
