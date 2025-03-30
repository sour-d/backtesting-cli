import { Strategy } from "./Strategy.js";
import ReplayBuffer from "./ReplayBuffer.js";
import StateNormalizer from "./StateNormalizer.js";
import chalk from "chalk";
import ora from "ora";

class RLStrategy extends Strategy {
  constructor(symbol, interval, persistTradesFn, config = RLStrategy.getDefaultConfig()) {
    const strategyConfig = {
      capital: config.capital,
      riskPercentage: config.riskPercentage,
      stockName: symbol
    };
    super(symbol, interval, persistTradesFn, strategyConfig);
    
    this.config = config;
    this.state = null;
    this.previousState = null;
    this.episodeReward = 0;
    this.trainingMode = false;
    this.lastAction = 0;
    this.consecutiveLosses = 0;

    // Reset trades for each episode
    this.resetEpisode = () => {
      this.capital = config.capital;
      this.risk = this.capital * (this.config.riskPercentage / 100);
      this.currentTrade = null;
      this.trades.tradeResults = [];
    };

    // RL components
    this.replayBuffer = new ReplayBuffer(config.memorySize);
    this.stateNormalizer = new StateNormalizer();
    
    // Q-values for each action (-1: Sell, 0: Hold, 1: Buy)
    this.qValues = {
      weights: {},  // Feature weights for linear approximation
      bias: 0
    };

    this.initializeWeights();
  }

  static getDefaultConfig() {
    return {
      capital: 100000,
      riskPercentage: 1,
      learningRate: 0.001,
      discountFactor: 0.95,
      explorationRate: 0.2,
      batchSize: 32,
      memorySize: 10000,
      maxPositionSize: 0.5,
      minPositionSize: 0.1,
      stopLossPercentage: 1.5,
      takeProfitPercentage: 3,
      minPriceChange: 0.002,
      maxConsecutiveLosses: 3,
      minVolatility: 0.001,
      trendConfirmation: 2
    };
  }

  execute() {
    if (this.trainingMode) {
      this.resetEpisode();
    }

    while (this.stock.hasData() && this.stock.move()) {
      this.trade();
    }

    const result = {
      ...this.trades.getReport(),
      tradeResults: this.trades.tradeResults,
      metadata: {
        symbol: this.symbol,
        interval: this.interval,
        capital: this.config.capital,
        riskPercentage: this.config.riskPercentage,
        timeFrame: this.interval
      }
    };

    this.persistTradesFn(result);
    return result;
  }

  initializeWeights() {
    const features = [
      'currentPrice', 'priceChange', 'priceVolatility',
      'ma20Trend', 'ma60Trend', 'superTrend',
      'volumeChange', 'momentum',
      'inPosition', 'positionType', 'unrealizedPnL'
    ];

    features.forEach(feature => {
      this.qValues.weights[feature] = Math.random() * 0.2 - 0.1;
    });
  }

  getState() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);

    // Ensure we have all required technical indicators
    if (!today.ma20high || !today.ma20low || !today.ma60close || !today.superTrendDirection) {
      throw new Error("Technical indicators not found. Please ensure data is preprocessed with indicators.");
    }

    const trendConfirmation = Array.from({ length: this.config.trendConfirmation })
      .map((_, i) => this.stock.prev(i))
      .every(candle => candle.superTrendDirection === today.superTrendDirection);

    const state = {
      currentPrice: today.close,
      priceChange: (today.close - yesterday.close) / yesterday.close,
      priceVolatility: (today.high - today.low) / today.low,
      ma20Trend: today.close > today.ma20high ? 1 : (today.close < today.ma20low ? -1 : 0),
      ma60Trend: today.close > today.ma60close ? 1 : -1,
      superTrend: trendConfirmation ? (today.superTrendDirection === "Buy" ? 1 : -1) : 0,
      volumeChange: (today.volume - yesterday.volume) / yesterday.volume,
      momentum: (today.close - dayBeforeYesterday.close) / dayBeforeYesterday.close,
      inPosition: this.currentTrade ? 1 : 0,
      positionType: this.currentTrade ? (this.currentTrade.type === "Buy" ? 1 : -1) : 0,
      unrealizedPnL: this.currentTrade ? 
        (this.currentTrade.type === "Buy" ? 
          (today.close - this.currentTrade.price) / this.currentTrade.price :
          (this.currentTrade.price - today.close) / this.currentTrade.price) : 0
    };

    this.stateNormalizer.update(state);
    return this.stateNormalizer.normalize(state);
  }

  calculateQ(state, action) {
    let q = this.qValues.bias;
    Object.entries(state).forEach(([feature, value]) => {
      if (feature in this.qValues.weights) {
        q += value * this.qValues.weights[feature];
      }
    });
    return q * action;
  }

  updateQ(state, action, reward, nextState) {
    const currentQ = this.calculateQ(state, action);
    const possibleActions = [-1, 0, 1];
    const nextQ = Math.max(...possibleActions.map(a => this.calculateQ(nextState, a)));
    const target = reward + this.config.discountFactor * nextQ;
    
    const error = target - currentQ;
    this.qValues.bias += this.config.learningRate * error;
    
    Object.entries(state).forEach(([feature, value]) => {
      if (feature in this.qValues.weights) {
        this.qValues.weights[feature] += this.config.learningRate * error * value * action;
      }
    });

    return error;
  }

  calculateReward() {
    if (!this.previousState) return 0;

    const today = this.stock.now();
    let reward = 0;

    if (this.currentTrade) {
      const unrealizedPnL = this.currentTrade.type === "Buy" ?
        (today.close - this.currentTrade.price) / this.currentTrade.price :
        (this.currentTrade.price - today.close) / this.currentTrade.price;
      
      reward += unrealizedPnL * 100;
    }

    if (this.lastAction !== 0) {
      const priceChange = (today.close - today.open) / today.open;
      const actionCorrect = (this.lastAction === 1 && priceChange > 0) || 
                          (this.lastAction === -1 && priceChange < 0);
      reward += actionCorrect ? 2 : -1;
    }

    if (this.currentTrade) {
      const trendConfirmation = Array.from({ length: this.config.trendConfirmation })
        .map((_, i) => this.stock.prev(i))
        .every(candle => candle.superTrendDirection === today.superTrendDirection);

      if (trendConfirmation) {
        const trendAligned = 
          (this.currentTrade.type === "Buy" && today.superTrendDirection === "Buy") ||
          (this.currentTrade.type === "Sell" && today.superTrendDirection === "Sell");
        reward += trendAligned ? 2 : -2;
      }
    }

    if (this.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      reward -= 5;
    }

    return reward;
  }

  async takeAction(action) {
    const today = this.stock.now();
    
    const priceChange = Math.abs((today.close - today.open) / today.open);
    const volatility = (today.high - today.low) / today.low;
    
    if (priceChange < this.config.minPriceChange || 
        volatility < this.config.minVolatility ||
        this.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      return false;
    }

    const positionSize = Math.min(
      this.config.maxPositionSize,
      Math.max(this.config.minPositionSize, 1 - volatility)
    );

    const riskPercentage = this.config.riskPercentage * 
      Math.pow(0.8, this.consecutiveLosses);

    if (action === 1 && !this.currentTrade) {
      const riskAmount = today.close * riskPercentage / 100;
      const quantity = (this.capital * positionSize) / today.close;
      super.takePosition(riskAmount, today.close, "Buy");
      this.lastAction = action;
      return true;
    }
    
    if (action === -1 && !this.currentTrade) {
      const riskAmount = today.close * riskPercentage / 100;
      const quantity = (this.capital * positionSize) / today.close;
      super.takePosition(riskAmount, today.close, "Sell");
      this.lastAction = action;
      return true;
    }

    if (action === 0 && this.currentTrade) {
      const pnl = this.currentTrade.type === "Buy" ?
        (today.close - this.currentTrade.price) / this.currentTrade.price :
        (this.currentTrade.price - today.close) / this.currentTrade.price;

      super.exitPosition(today.close, this.currentTrade.quantity);
      
      if (pnl < 0) {
        this.consecutiveLosses++;
      } else {
        this.consecutiveLosses = 0;
      }

      this.lastAction = action;
      return true;
    }

    return false;
  }

  checkStopLoss() {
    if (!this.currentTrade) return false;

    const today = this.stock.now();
    const stopLossPrice = this.currentTrade.type === "Buy" ?
      this.currentTrade.price * (1 - this.config.stopLossPercentage / 100) :
      this.currentTrade.price * (1 + this.config.stopLossPercentage / 100);

    if (
      (this.currentTrade.type === "Buy" && today.low <= stopLossPrice) ||
      (this.currentTrade.type === "Sell" && today.high >= stopLossPrice)
    ) {
      super.exitPosition(stopLossPrice, this.currentTrade.quantity);
      this.consecutiveLosses++;
      return true;
    }

    return false;
  }

  checkTakeProfit() {
    if (!this.currentTrade) return false;

    const today = this.stock.now();
    const takeProfitPrice = this.currentTrade.type === "Buy" ?
      this.currentTrade.price * (1 + this.config.takeProfitPercentage / 100) :
      this.currentTrade.price * (1 - this.config.takeProfitPercentage / 100);

    if (
      (this.currentTrade.type === "Buy" && today.high >= takeProfitPrice) ||
      (this.currentTrade.type === "Sell" && today.low <= takeProfitPrice)
    ) {
      super.exitPosition(takeProfitPrice, this.currentTrade.quantity);
      this.consecutiveLosses = 0;
      return true;
    }

    return false;
  }

  async trade() {
    if (this.capital <= 0) throw new Error("Capital exhausted");

    try {
      this.previousState = this.state;
      this.state = this.getState();

      if (this.checkStopLoss() || this.checkTakeProfit()) {
        return;
      }

      const action = this.getActionFromPolicy();
      await this.takeAction(action);
      const reward = this.calculateReward();
      this.episodeReward += reward;

      if (this.trainingMode && this.previousState) {
        this.storeExperience(this.previousState, action, reward, this.state);
        await this.learn();
      }
    } catch (error) {
      if (error.message.includes("Technical indicators not found")) {
        throw new Error("Please ensure market data is preprocessed with technical indicators before training.");
      }
      throw error;
    }
  }

  getActionFromPolicy() {
    if (Math.random() < this.config.explorationRate) {
      return Math.floor(Math.random() * 3) - 1;
    }

    const state = this.state;
    const actions = [-1, 0, 1];
    const qValues = actions.map(action => ({
      action,
      q: this.calculateQ(state, action)
    }));

    return qValues.reduce((best, current) => 
      current.q > best.q ? current : best
    ).action;
  }

  storeExperience(state, action, reward, nextState) {
    this.replayBuffer.push(state, action, reward, nextState);
  }

  async learn() {
    if (this.replayBuffer.size < this.config.batchSize) return;

    const batch = this.replayBuffer.sample(this.config.batchSize);
    let totalError = 0;

    batch.forEach(experience => {
      const error = this.updateQ(
        experience.state,
        experience.action,
        experience.reward,
        experience.nextState
      );
      totalError += Math.abs(error);
    });

    const avgError = totalError / this.config.batchSize;
    if (this.trainingMode) {
      console.log(
        chalk.dim("Training:"),
        chalk.yellow(`Avg Error: ${avgError.toFixed(4)}`),
        chalk.green(`Buffer: ${this.replayBuffer.size}`)
      );
    }
  }

  static name = "ReinforcementLearning";
}

export default RLStrategy;
