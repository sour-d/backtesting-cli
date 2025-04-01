import { readFileSync } from 'fs';
import dataManager from '../../utils/dataManager.js';

export class AIDataLoader {
  constructor(symbol = 'BTCUSDT', interval = 'D') {
    this.symbol = symbol;
    this.interval = interval;
    this.data = null;
  }

  loadRawData() {
    const path = dataManager.getMarketDataPath(this.symbol, this.interval);
    this.data = JSON.parse(readFileSync(path));
    return this;
  }

  preprocess() {
    const requiredFields = ['open', 'high', 'low', 'close', 'volume'];
    
    return this.data
      .map((entry, index, arr) => {
        try {
          // Validate basic data integrity
          if (!entry || index < 4 || 
              requiredFields.some(field => !entry[field] || entry[field] <= 0)) {
            return null;
          }

          // Calculate features with boundary checks
          const prev1 = arr[index-1];
          const prev4 = arr[index-4];
          if (!prev1 || !prev4) return null;

          const indicators = this.calculateIndicators(arr, index);
          const patterns = this.detectPatterns(arr, index);
          
          if (!indicators || !patterns) return null;

          // Validate all calculated values
          const values = [
            ...Object.values(indicators),
            ...Object.values(patterns)
          ];
          
          if (values.some(v => typeof v !== 'number' || !isFinite(v))) {
            return null;
          }

          return {
            date: entry.dateUnix,
            open: entry.open,
            high: entry.high,
            low: entry.low,
            close: entry.close,
            volume: entry.volume,
            ...patterns,
            ...indicators
          };
        } catch (error) {
          return null;
        }
      })
      .filter(entry => entry !== null);
  }

  detectPatterns(data, index) {
    const current = data[index];
    const prev1 = data[index - 1];
    const prev2 = data[index - 2];
    const prev3 = data[index - 3];

    return {
      isDoji: this.isDoji(current),
      isHammer: this.isHammer(current),
      isEngulfing: this.isEngulfing(current, prev1),
      isMorningStar: this.isMorningStar(current, prev1, prev2),
      isThreeBlackCrows: this.isThreeBlackCrows(current, prev1, prev2),
      isPiercingLine: this.isPiercingLine(current, prev1),
      isDarkCloudCover: this.isDarkCloudCover(current, prev1)
    };
  }

  isDoji(candle) {
    const bodySize = Math.abs(candle.close - candle.open);
    const totalSize = candle.high - candle.low;
    return totalSize > 0 ? (bodySize / totalSize) < 0.1 ? 1 : 0 : 0;
  }

  isHammer(candle) {
    const bodySize = candle.close - candle.open;
    const lowerShadow = candle.open - candle.low;
    const upperShadow = candle.high - candle.close;
    return (lowerShadow > 2 * Math.abs(bodySize) && upperShadow < Math.abs(bodySize)/2) ? 1 : 0;
  }

  isEngulfing(current, previous) {
    const currBody = Math.abs(current.close - current.open);
    const prevBody = Math.abs(previous.close - previous.open);
    return currBody > prevBody * 1.5 ? 1 : 0;
  }

  isMorningStar(current, prev1, prev2) {
    const firstBearish = prev2.close < prev2.open;
    const dojiLike = Math.abs(prev1.close - prev1.open)/(prev1.high - prev1.low) < 0.1;
    const thirdBullish = current.close > current.open;
    const gapDown = prev1.open < prev2.low;
    const gapUp = current.open > prev1.high;
    return (firstBearish && dojiLike && thirdBullish && gapDown && gapUp) ? 1 : 0;
  }

  isThreeBlackCrows(current, prev1, prev2) {
    return (current.close < current.open && 
            prev1.close < prev1.open && 
            prev2.close < prev2.open &&
            current.close < prev1.close &&
            prev1.close < prev2.close) ? 1 : 0;
  }

  isPiercingLine(current, prev1) {
    const prevBearish = prev1.close < prev1.open;
    const currBullish = current.close > current.open;
    const openBelowPrevLow = current.open < prev1.low;
    const closesAboveMidpoint = current.close > (prev1.open + prev1.close)/2;
    return (prevBearish && currBullish && openBelowPrevLow && closesAboveMidpoint) ? 1 : 0;
  }

  isDarkCloudCover(current, prev1) {
    const prevBullish = prev1.close > prev1.open;
    const currBearish = current.close < current.open;
    const openAbovePrevHigh = current.open > prev1.high;
    const closesBelowMidpoint = current.close < (prev1.open + prev1.close)/2;
    return (prevBullish && currBearish && openAbovePrevHigh && closesBelowMidpoint) ? 1 : 0;
  }

  calculateIndicators(data, index) {
    try {
      const current = data[index];
      const prev1 = data[index-1];
      const prev4 = data[index-4];
      
      if (!current || !prev1 || !prev4) return null;

      return {
        price_change: (current.close - prev1.close)/prev1.close,
        volatility: (current.high - current.low)/current.low,
        rsi: this.calculateRSI(data, index),
        ma20: this.calculateMA(data, index, 20),
        ma50: this.calculateMA(data, index, 50),
        momentum: (current.close - prev4.close)/prev4.close,
        volume_change: (current.volume - prev1.volume)/prev1.volume
      };
    } catch (error) {
      return null;
    }
  }

  calculateRSI(data, index, period = 14) {
    if (index < period) return null;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = index - period; i < index; i++) {
      if (!data[i] || !data[i+1]) return null;
      const delta = data[i + 1].close - data[i].close;
      if (delta > 0) gains += delta;
      else losses -= delta;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period || 0.0001;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculateMA(data, index, period) {
    if (index < period) return null;
    
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, index - period); i < index; i++) {
      if (!data[i]) continue;
      sum += data[i].close;
      count++;
    }
    return count > 0 ? sum / count : null;
  }
}
