import { Strategy } from "./Strategy.js";
import dataManager from "../data/dataManager.js";
import calculateATR from "../indicators/atr.js";
import { movingAverageOf } from "../indicators/nDayMA.js";
import { lowOfLast } from "../indicators/nDaysLow.js";

const addIndicator =
  (indicatorFn, ...extraArgs) =>
  (quote, technicalQuotes) =>
    indicatorFn(quote, technicalQuotes, ...extraArgs);

class SimpleAIStrategy extends Strategy {
  static name = "SimpleAIStrategy";
  
  constructor(symbolInfo, persistTradesFn, config) {
    super(symbolInfo, persistTradesFn, config);
    this.currentPosition = 0;
    this.lastAction = 0;
    this.features = [];
    this.actions = [];
    this.rewards = [];
    this.tradeProfits = [];
    this.consecutiveLosses = 0;
    this.debugCount = 0;
    
    // Follow SuperTrend's config approach
    this.config = config || SimpleAIStrategy.getDefaultConfig();
    
    // Always use fresh weights
    this.isPreTrained = false;
    
    // Optimized weights for balanced trading
    const symbolSeed = this.symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    this.rng = this.createSeededRandom(symbolSeed);
    
    // More balanced weights that work in different market conditions
    this.weights = {
      priceVsMA20: 0.8,     // Price vs MA20
      priceVsMA60: 0.6,     // Price vs MA60
      momentum: 0.9,        // Short term momentum
      maAlignment: 0.7,     // MA alignment
      volume: 0.4,          // Volume confirmation
      volatility: -0.3      // Avoid high volatility
    };
    
    this.learningRate = 0.02;
    this.lastTradePrice = 0;
    this.holdingPeriod = 0;
    this.shouldBuy = false; // Flag for base class integration
  }

  // Follow SuperTrend's config pattern
  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 1,  // Same as SuperTrend
    };
  }

  // Use similar indicators to SuperTrend
  static getIndicators() {
    return [
      addIndicator(calculateATR, 10),  // Same as SuperTrend
      addIndicator(movingAverageOf, 20, 'close'),
      addIndicator(movingAverageOf, 60, 'close'), // Same as SuperTrend
      addIndicator(lowOfLast, 3)  // For stop loss calculation
    ];
  }

  createSeededRandom(seed) {
    let state = seed;
    return () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  }

  seededRandom() {
    return this.rng();
  }

  // Fixed feature extraction
  extractFeatures() {
    const today = this.stock.now();
    const yesterday = this.stock.prev(1);
    
    if (!today || !yesterday) {
      return null;
    }

    // Safer calculations with fallbacks
    const ma20close = today.ma20close || today.close;
    const ma60close = today.ma60close || today.close;

    // Calculate features with safety checks
    const priceVsMA20 = ma20close !== 0 ? (today.close - ma20close) / ma20close : 0;
    const priceVsMA60 = ma60close !== 0 ? (today.close - ma60close) / ma60close : 0;
    const momentum = yesterday.close !== 0 ? (today.close - yesterday.close) / yesterday.close : 0;
    const maAlignment = ma60close !== 0 ? (ma20close - ma60close) / ma60close : 0;
    const volumeSignal = (yesterday.volume > 0 && today.volume > 0) ? 
      (today.volume - yesterday.volume) / yesterday.volume : 0;
    const volatility = today.atr && today.close > 0 ? today.atr / today.close : 0.02;

    // Ensure no NaN values
    const features = {
      priceVsMA20: isNaN(priceVsMA20) ? 0 : Math.tanh(priceVsMA20 * 20),
      priceVsMA60: isNaN(priceVsMA60) ? 0 : Math.tanh(priceVsMA60 * 15),
      momentum: isNaN(momentum) ? 0 : Math.tanh(momentum * 50),
      maAlignment: isNaN(maAlignment) ? 0 : Math.tanh(maAlignment * 15),
      volume: isNaN(volumeSignal) ? 0 : Math.tanh(volumeSignal * 2),
      volatility: isNaN(volatility) ? 0.02 : Math.min(volatility * 50, 1),
      inPosition: this.currentPosition > 0 ? 1 : -1,
      holdingPeriod: Math.min(this.holdingPeriod / 10, 1)
    };

    return features;
  }

  // AI prediction logic
  predict(features) {
    // Calculate AI score with safety check
    let score = 0;
    score += (features.priceVsMA20 || 0) * this.weights.priceVsMA20;
    score += (features.priceVsMA60 || 0) * this.weights.priceVsMA60;
    score += (features.momentum || 0) * this.weights.momentum;
    score += (features.maAlignment || 0) * this.weights.maAlignment;
    score += (features.volume || 0) * this.weights.volume;
    score += (features.volatility || 0) * this.weights.volatility;

    // Ensure score is not NaN
    if (isNaN(score)) score = 0;

    // Get current market data
    const today = this.stock.now();
    const yesterday = this.stock.prev(1);
    
    if (!today || !yesterday) return 0;

    // Debug logging for first few trades
    if (this.debugCount < 10) {
      console.log(`Debug ${this.debugCount}: score=${score.toFixed(3)}, momentum=${features.momentum.toFixed(3)}, priceVsMA20=${features.priceVsMA20.toFixed(3)}, maAlign=${features.maAlignment.toFixed(3)}`);
      this.debugCount++;
    }

    // FLEXIBLE BUY CONDITIONS - Work in different market conditions
    if (this.currentPosition === 0 && this.consecutiveLosses < 4) {
      
      // Condition 1: High AI score (regardless of momentum in bear markets)
      if (score > 1.0 && features.volatility < 0.6) {
        console.log(`🚀 BUY SIGNAL: High score ${score.toFixed(3)}`);
        return 1;
      }
      
      // Condition 2: Price above MA20 with positive momentum
      if (features.priceVsMA20 > 0.3 && features.momentum > 0.1) {
        console.log(`🚀 BUY SIGNAL: Above MA20 + momentum`);
        return 1;
      }
      
      // Condition 3: Strong positive momentum alone
      if (features.momentum > 0.25 && features.volatility < 0.7) {
        console.log(`🚀 BUY SIGNAL: Strong momentum ${features.momentum.toFixed(3)}`);
        return 1;
      }
      
      // Condition 4: MA alignment with any positive movement
      if (features.maAlignment > 0.2 && features.momentum > 0.05 && features.priceVsMA20 > 0) {
        console.log(`🚀 BUY SIGNAL: MA alignment + small momentum`);
        return 1;
      }
      
      // Condition 5: Oversold bounce (works in bear markets)
      if (features.priceVsMA20 < -0.2 && features.momentum > 0.15) {
        console.log(`🚀 BUY SIGNAL: Oversold bounce`);
        return 1;
      }
    }

    return 0; // Hold
  }

  // Enhanced reward system
  calculateReward(action, previousPrice, currentPrice, position) {
    const priceChange = (currentPrice - previousPrice) / previousPrice;
    let reward = 0;

    if (action === 1 && position === 0) { // Buy action
      reward = priceChange * 500; // Reward good timing
      
      const today = this.stock.now();
      if (today.close > (today.ma20close || today.close)) reward += 10;
      if (today.close > (today.ma60close || today.close)) reward += 5;
      
    } else if (action === 2 && position > 0) { // Sell action
      const tradeProfit = (currentPrice - this.lastTradePrice) / this.lastTradePrice;
      
      if (tradeProfit > 0) {
        reward = tradeProfit * 1000 + 30; // Big reward for profits
        if (tradeProfit > 0.025) reward += 70; // Extra for good profits
      } else {
        reward = tradeProfit * 1200 - 40; // Penalty for losses
      }
      
      this.tradeProfits.push(tradeProfit);
      if (tradeProfit > 0) {
        this.consecutiveLosses = 0;
      } else {
        this.consecutiveLosses++;
      }
      
    } else if (action === 0) { // Hold action
      if (position > 0) {
        const unrealizedPnL = (currentPrice - this.lastTradePrice) / this.lastTradePrice;
        reward = unrealizedPnL * 80; // Reward for holding winners
      } else {
        reward = -3; // Small penalty for cash
      }
    }

    return reward;
  }

  // Learning mechanism
  learn(features, action, reward) {
    this.features.push(features);
    this.actions.push(action);
    this.rewards.push(reward);

    const lookbackPeriod = Math.min(this.features.length, 15);
    
    if (this.features.length > lookbackPeriod) {
      const recentRewards = this.rewards.slice(-lookbackPeriod);
      const avgReward = recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length;
      
      if (Math.abs(avgReward) > 5.0) {
        const learningRate = this.learningRate;
        
        Object.keys(this.weights).forEach(key => {
          if (features[key] !== undefined && !isNaN(features[key])) {
            const update = learningRate * Math.sign(avgReward) * Math.abs(features[key]) * 0.5;
            
            if (avgReward > 0) {
              this.weights[key] += update;
            } else {
              this.weights[key] -= Math.abs(update) * 0.7;
            }
          }
        });

        // Keep weights reasonable
        Object.keys(this.weights).forEach(key => {
          this.weights[key] = Math.max(-2.0, Math.min(2.5, this.weights[key]));
        });
      }
    }
  }

  // Override base class trade method to integrate AI logic
  trade() {
    if (this.capital <= 0) throw new Error("Capital exhausted");

    try {
      if (this.currentPosition > 0) {
        this.holdingPeriod++;
      } else {
        this.holdingPeriod = 0;
      }

      const features = this.extractFeatures();
      if (!features) return;

      const action = this.predict(features);
      this.lastAction = action;

      const currentPrice = this.stock.now().close;
      const previousPrice = this.stock.prev(1)?.close || currentPrice;

      // Set flag for buy signal
      this.shouldBuy = (action === 1 && !this.currentTrade);

      const reward = this.calculateReward(action, previousPrice, currentPrice, this.currentPosition);
      this.learn(features, action, reward);

    } catch (error) {
      console.warn(`AI prediction failed: ${error.message}`);
    }

    // Call base class trade logic which will call our buy() and longSquareOff()
    if (this.currentTrade?.type === "Buy") return this.longSquareOff();
    if (this.currentTrade?.type === "Sell") return this.shortSquareOff();

    if (Boolean(this.sell())) return;
    if (Boolean(this.buy())) return;
  }

  // Simplified buy method that works with base class
  buy() {
    // Only execute if AI signaled to buy
    if (!this.shouldBuy) return false;
    this.shouldBuy = false; // Reset flag

    if (this.currentTrade) return false;

    const today = this.stock.now();
    const yesterday = this.stock.prev(1);
    const dayBeforeYesterday = this.stock.prev(2);
    
    if (!today || !yesterday || !dayBeforeYesterday) return false;

    const { close: buyingPrice } = today;
    
    // Simplified stop loss calculation for reliability
    const atrMultiplier = 1.5;
    const atrValue = today.atr || (buyingPrice * 0.02);
    const atrStopLevel = buyingPrice - (atrValue * atrMultiplier);
    
    // Use recent lows as alternative
    const recentLows = [today.low, yesterday.low, dayBeforeYesterday.low].filter(val => val && !isNaN(val));
    const recentLowStopLevel = recentLows.length > 0 ? Math.min(...recentLows) : buyingPrice * 0.97;
    
    // Use the higher (safer) of the two
    const initialStopLoss = Math.max(atrStopLevel, recentLowStopLevel);
    const riskForOneStock = buyingPrice - initialStopLoss;
    
    // Safety checks
    if (initialStopLoss >= buyingPrice) {
      console.log(`⚠️  Invalid stop loss: ${initialStopLoss.toFixed(4)} >= ${buyingPrice.toFixed(4)}`);
      return false;
    }
    
    if (riskForOneStock <= 0) {
      console.log(`⚠️  Invalid risk: ${riskForOneStock.toFixed(4)} <= 0`);
      return false;
    }

    // Check if we can afford the position
    const position = this.stocksCanBeBought(riskForOneStock, buyingPrice);
    if (position <= 0) {
      console.log(`⚠️  Cannot afford position: ${position}`);
      return false;
    }
    
    console.log(`💳 EXECUTING BUY: Price=${buyingPrice.toFixed(4)}, Stop=${initialStopLoss.toFixed(4)}, Risk=${riskForOneStock.toFixed(4)}, Qty=${position.toFixed(2)}`);
    
    // Use base class position taking
    this.takePosition(riskForOneStock, buyingPrice, "Buy");
    this.currentPosition = this.currentTrade?.quantity || 0;
    this.lastTradePrice = buyingPrice;
    this.holdingPeriod = 0;
    
    return true;
  }

  sell() {
    return false; // Only long trades
  }

  // Exit logic for long positions
  longSquareOff() {
    if (!this.currentTrade || this.currentTrade.type !== "Buy") return false;

    const today = this.stock.now();
    const features = this.extractFeatures();
    
    if (!features) return false;

    const currentPrice = today.close;
    const unrealizedPnL = (currentPrice - this.lastTradePrice) / this.lastTradePrice;
    
    let shouldExit = false;
    let exitReason = "";

    // Trend-based exit
    if (features.priceVsMA20 < -0.1 && features.momentum < -0.1) {
      shouldExit = true;
      exitReason = "Trend breakdown";
    }
    // Take profit conditions
    else if (unrealizedPnL > 0.025) {
      shouldExit = true;
      exitReason = `Take profit ${(unrealizedPnL*100).toFixed(2)}%`;
    }
    // Take smaller profits on weakness
    else if (unrealizedPnL > 0.015 && (features.momentum < -0.1 || features.priceVsMA60 < -0.1)) {
      shouldExit = true;
      exitReason = `Take profit on weakness ${(unrealizedPnL*100).toFixed(2)}%`;
    }
    // Stop loss
    else if (unrealizedPnL < -0.025) {
      shouldExit = true;
      exitReason = `Stop loss ${(unrealizedPnL*100).toFixed(2)}%`;
    }
    // Exit stagnant trades
    else if (this.holdingPeriod > 8 && unrealizedPnL < 0.01) {
      shouldExit = true;
      exitReason = `Stagnant trade ${this.holdingPeriod} periods`;
    }

    if (shouldExit) {
      const profit = (currentPrice - this.lastTradePrice) / this.lastTradePrice;
      console.log(`💳 EXECUTING SELL: ${exitReason}, Price=${currentPrice.toFixed(4)}, Profit=${(profit*100).toFixed(2)}%`);
      
      this.exitPosition(currentPrice, this.currentTrade.quantity);
      this.currentPosition = 0;
      this.holdingPeriod = 0;
      
      return true;
    }
    
    return false;
  }

  shortSquareOff() {
    return false; // Only long trades
  }

  async execute() {
    console.log(`🤖 Starting AI Strategy with SuperTrend Risk Management for ${this.symbol}...`);
    console.log(`📊 Using indicators: ATR(10), MA20, MA60, 3-day lows`);
    console.log(`🎯 Risk Management: ${this.config.riskPercentage}% per trade (like SuperTrend)`);
    console.log(`🎯 Dynamic stops using ATR + recent lows`);
    console.log(`🎯 Initial Weights: ${Object.entries(this.weights).map(([k, v]) => `${k}: ${v.toFixed(3)}`).join(', ')}`);
    
    while (this.stock.hasData() && this.stock.move()) {
      this.trade(); // Use our overridden trade method
    }

    // Report results
    if (this.rewards.length > 0) {
      const avgReward = this.rewards.reduce((a, b) => a + b, 0) / this.rewards.length;
      const totalReward = this.rewards.reduce((a, b) => a + b, 0);
      const avgTradeProfit = this.tradeProfits.length > 0 ? 
        this.tradeProfits.reduce((a, b) => a + b, 0) / this.tradeProfits.length : 0;
      const winRate = this.tradeProfits.length > 0 ? 
        (this.tradeProfits.filter(p => p > 0).length / this.tradeProfits.length) * 100 : 0;
      
      console.log(`📈 AI Learning Stats: Avg Reward: ${avgReward.toFixed(2)}, Total Reward: ${totalReward.toFixed(2)}`);
      console.log(`💰 Trade Performance: ${this.tradeProfits.length} trades, ${winRate.toFixed(1)}% win rate`);
      console.log(`📊 Avg Profit per Trade: ${(avgTradeProfit * 100).toFixed(2)}%`);
      console.log(`🧠 Final Weights: ${Object.entries(this.weights).map(([k, v]) => `${k}: ${v.toFixed(3)}`).join(', ')}`);
      console.log(`🎯 Risk Management: SuperTrend-style dynamic stops with ${this.config.riskPercentage}% risk per trade`);
      
      if (winRate > 55) {
        console.log(`🎉 EXCELLENT: Win rate above 55%!`);
      } else if (winRate > 45) {
        console.log(`✅ GOOD: Balanced win rate around 50%`);
      } else {
        console.log(`⚠️  IMPROVEMENT NEEDED: Win rate below 45%`);
      }
    } else {
      console.log(`❌ NO TRADES EXECUTED - Check debug output above`);
    }

    const result = {
      ...this.trades.getReport(),
      tradeResults: this.trades.tradeResults,
      metadata: {
        symbol: this.symbol,
        interval: this.interval,
        capital: this.capital,
        riskPercentage: this.riskPercentage,
        aiModelUsed: true,
        lastAction: this.lastAction,
        learningStats: {
          totalActions: this.actions.length,
          avgReward: this.rewards.length > 0 ? this.rewards.reduce((a, b) => a + b, 0) / this.rewards.length : 0,
          finalWeights: this.weights,
          isPreTrained: this.isPreTrained,
          tradePerformance: {
            totalTrades: this.tradeProfits.length,
            winRate: this.tradeProfits.length > 0 ? 
              (this.tradeProfits.filter(p => p > 0).length / this.tradeProfits.length) * 100 : 0,
            avgProfit: this.tradeProfits.length > 0 ? 
              this.tradeProfits.reduce((a, b) => a + b, 0) / this.tradeProfits.length : 0,
            consecutiveLosses: this.consecutiveLosses
          }
        }
      }
    };
    this.persistTradesFn(result);
  }
}

export default SimpleAIStrategy;
