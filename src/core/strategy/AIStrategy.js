import { Strategy } from "./Strategy.js";
import { AITrader } from "../../ai/AITrader.js";

class AIStrategy extends Strategy {
  static name = "AIStrategy";
  
  constructor(symbolInfo, persistTradesFn, config) {
    super(symbolInfo, persistTradesFn, config);
    this.aiTrader = new AITrader();
    this.modelLoaded = false;
    this.currentPosition = 0;
    this.lastAction = 0; // 0 = Hold, 1 = Buy, 2 = Sell
  }

  static getIndicators() {
    return [];
  }

  async initializeModel() {
    if (!this.modelLoaded) {
      try {
        this.modelLoaded = await this.aiTrader.loadModel();
        if (!this.modelLoaded) {
          console.warn("AI model not found. Please train the model first using: yarn cli train");
        }
      } catch (error) {
        console.error("Failed to load AI model:", error.message);
        this.modelLoaded = false;
      }
    }
  }

  // Extract features for AI prediction
  extractFeatures() {
    const current = this.stock.now();
    const previous = this.stock.prev(1);
    
    if (!current || !previous) {
      return null;
    }

    // Get historical data for indicators
    const quotes = [];
    for (let i = 60; i >= 0; i--) {
      const quote = this.stock.prev(i);
      if (quote) quotes.push(quote);
    }

    // Calculate simple moving averages
    const calculateSMA = (data, period) => {
      if (data.length < period) return null;
      const sum = data.slice(-period).reduce((acc, quote) => acc + quote.close, 0);
      return sum / period;
    };

    const ma20 = calculateSMA(quotes, 20);
    const ma60 = calculateSMA(quotes, 60);

    // Simple ATR calculation
    let atrSum = 0;
    let atrCount = 0;
    for (let i = 1; i < Math.min(quotes.length, 14); i++) {
      const tr = Math.max(
        quotes[i].high - quotes[i].low,
        Math.abs(quotes[i].high - quotes[i-1].close),
        Math.abs(quotes[i].low - quotes[i-1].close)
      );
      atrSum += tr;
      atrCount++;
    }
    const atr = atrCount > 0 ? atrSum / atrCount : 0;

    return {
      // Price features
      open: current.open,
      high: current.high,
      low: current.low,
      close: current.close,
      volume: current.volume,
      
      // Price changes
      priceChange: (current.close - previous.close) / previous.close,
      volumeChange: (current.volume - previous.volume) / (previous.volume || 1),
      
      // Technical indicators
      ma20: ma20 || current.close,
      ma60: ma60 || current.close,
      atr: atr,
      
      // Trend indicators (normalized)
      ma20Trend: current.close > (ma20 || current.close) ? 1 : 0,
      ma60Trend: current.close > (ma60 || current.close) ? 1 : 0,
      superTrend: current.close > previous.close ? 1 : 0, // Simplified trend
      
      // Position information
      inPosition: this.currentPosition !== 0 ? 1 : 0,
      positionType: this.currentPosition > 0 ? 1 : (this.currentPosition < 0 ? -1 : 0)
    };
  }

  async trade() {
    await this.initializeModel();
    
    if (!this.modelLoaded) {
      // Fallback to simple buy and hold if model is not available
      if (!this.currentTrade) {
        this.buy();
      }
      return;
    }

    if (this.capital <= 0) throw new Error("Capital exhausted");

    try {
      // Extract features for AI prediction
      const features = this.extractFeatures();
      if (!features) return;

      // Get AI prediction
      const prediction = await this.aiTrader.predict(features);
      const action = prediction.action;
      const confidence = prediction.confidence;

      // Only act if confidence is above threshold
      const confidenceThreshold = 0.6;
      if (confidence < confidenceThreshold) {
        return; // Hold if not confident
      }

      this.lastAction = action;

      // Execute action based on AI prediction
      if (action === 1 && !this.currentTrade) { // Buy signal
        this.buy();
      } else if (action === 2 && this.currentTrade) { // Sell signal
        if (this.currentTrade.type === "Buy") {
          this.longSquareOff();
        }
      }
      // action === 0 means hold, so do nothing

    } catch (error) {
      console.warn(`AI prediction failed: ${error.message}`);
      // Fallback to holding current position
    }
  }

  buy() {
    if (this.currentTrade) return false;

    const currentPrice = this.stock.now().close;
    const atr = this.calculateATR();
    const stopLoss = atr * 2; // 2 ATR stop loss
    
    this.takePosition(stopLoss, currentPrice, "Buy");
    this.currentPosition = this.currentTrade?.quantity || 0;
    
    return true;
  }

  sell() {
    // AI strategy doesn't use traditional sell (short) signals
    // Only uses buy and square off
    return false;
  }

  longSquareOff() {
    if (!this.currentTrade || this.currentTrade.type !== "Buy") return false;

    const currentPrice = this.stock.now().close;
    this.exitPosition(currentPrice, this.currentTrade.quantity, "long-square-off");
    this.currentPosition = 0;
    
    return true;
  }

  shortSquareOff() {
    // AI strategy doesn't use short positions
    return false;
  }

  // Helper method to calculate ATR
  calculateATR() {
    const quotes = [];
    for (let i = 14; i >= 0; i--) {
      const quote = this.stock.prev(i);
      if (quote) quotes.push(quote);
    }

    if (quotes.length < 2) return 0.02; // Default 2% ATR

    let atrSum = 0;
    for (let i = 1; i < quotes.length; i++) {
      const tr = Math.max(
        quotes[i].high - quotes[i].low,
        Math.abs(quotes[i].high - quotes[i-1].close),
        Math.abs(quotes[i].low - quotes[i-1].close)
      );
      atrSum += tr;
    }

    const atr = atrSum / (quotes.length - 1);
    const atrPercentage = atr / this.stock.now().close;
    
    return Math.max(atrPercentage, 0.01); // Minimum 1% stop loss
  }

  // Override execute to handle async operations
  async execute() {
    await this.initializeModel();
    
    while (this.stock.hasData() && this.stock.move()) {
      await this.trade();
    }

    const result = {
      ...this.trades.getReport(),
      tradeResults: this.trades.tradeResults,
      metadata: {
        symbol: this.symbol,
        interval: this.interval,
        capital: this.capital,
        riskPercentage: this.riskPercentage,
        aiModelUsed: this.modelLoaded,
        lastAction: this.lastAction
      }
    };
    this.persistTradesFn(result);
  }
}

export default AIStrategy;
