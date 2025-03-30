import { Strategy } from "./Strategy.js";
import ReplayBuffer from "./ReplayBuffer.js";
import StateNormalizer from "./StateNormalizer.js";
import chalk from "chalk";
import ora from "ora";

class RLStrategy extends Strategy {
  constructor(symbol, interval, persistTradesFn, config = RLStrategy.getDefaultConfig()) {
    super(symbol, interval, persistTradesFn, config);
    this.config = config;
    this.state = null;
    this.previousState = null;
    this.episodeReward = 0;
    this.trainingMode = false;

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
      riskPercentage: 2,
      // RL specific parameters
      learningRate: 0.001,
      discountFactor: 0.95,
      explorationRate: 0.1,
      batchSize: 32,
      memorySize: 10000,
      // Trading parameters
      maxPositionSize: 1.0,
      minPositionSize: 0.1,
      stopLossPercentage: 2,
      takeProfitPercentage: 4
    };
  }

  initializeWeights() {
    const features = [
      'currentPrice', 'priceChange', 'priceVolatility',
      'ma20Trend', 'ma60Trend', 'superTrend',
      'volumeChange', 'momentum',
      'inPosition', 'positionType', 'unrealizedPnL'
    ];

    features.forEach(feature => {
      this.qValues.weights[feature] = Math.random() * 0.1 - 0.05; // Small random initialization
    });
  }

  // State representation for RL
  getState() {
    const today = this.stock.now();
    const yesterday = this.stock.prev();
    const dayBeforeYesterday = this.stock.prev(2);

    const state = {
      // Price features
      currentPrice: today.close,
      priceChange: (today.close - yesterday.close) / yesterday.close,
      priceVolatility: (today.high - today.low) / today.low,
      
      // Technical indicators
      ma20Trend: today.close > today.ma20high ? 1 : (today.close < today.ma20low ? -1 : 0),
      ma60Trend: today.close > today.ma60close ? 1 : -1,
      superTrend: today.superTrendDirection === "Buy" ? 1 : -1,
      
      // Volume and momentum
      volumeChange: (today.volume - yesterday.volume) / yesterday.volume,
      momentum: (today.close - dayBeforeYesterday.close) / dayBeforeYesterday.close,
      
      // Position info
      inPosition: this.currentTrade ? 1 : 0,
      positionType: this.currentTrade ? (this.currentTrade.type === "Buy" ? 1 : -1) : 0,
      unrealizedPnL: this.currentTrade ? 
        (this.currentTrade.type === "Buy" ? 
          (today.close - this.currentTrade.price) / this.currentTrade.price :
          (this.currentTrade.price - today.close) / this.currentTrade.price) : 0
    };

    // Update and normalize state
    this.stateNormalizer.update(state);
    return this.stateNormalizer.normalize(state);
  }

  // Calculate Q-value for a state-action pair
  calculateQ(state, action) {
    let q = this.qValues.bias;
    Object.entries(state).forEach(([feature, value]) => {
      if (feature in this.qValues.weights) {
        q += value * this.qValues.weights[feature];
      }
    });
    return q * action; // Scale by action (-1, 0, 1)
  }

  // Update Q-values using temporal difference learning
  updateQ(state, action, reward, nextState) {
    const currentQ = this.calculateQ(state, action);
    
    // Calculate target Q-value (Q-learning)
    const possibleActions = [-1, 0, 1];
    const nextQ = Math.max(...possibleActions.map(a => this.calculateQ(nextState, a)));
    const target = reward + this.config.discountFactor * nextQ;
    
    // Update weights using gradient descent
    const error = target - currentQ;
    this.qValues.bias += this.config.learningRate * error;
    
    Object.entries(state).forEach(([feature, value]) => {
      if (feature in this.qValues.weights) {
        this.qValues.weights[feature] += this.config.learningRate * error * value * action;
      }
    });

    return error;
  }

  // Calculate reward based on PnL and risk metrics
  calculateReward() {
    if (!this.previousState) return 0;

    const today = this.stock.now();
    let reward = 0;

    // PnL-based reward
    if (this.currentTrade) {
      const unrealizedPnL = this.currentTrade.type === "Buy" ?
        (today.close - this.currentTrade.price) / this.currentTrade.price :
        (this.currentTrade.price - today.close) / this.currentTrade.price;
      
      reward += unrealizedPnL * 100; // Scale up for better learning
    }

    // Risk-adjusted reward components
    const volatilityPenalty = Math.abs(today.high - today.low) / today.low;
    reward -= volatilityPenalty * 10; // Penalize high volatility

    // Trend alignment reward
    if (this.currentTrade) {
      const trendAligned = 
        (this.currentTrade.type === "Buy" && today.superTrendDirection === "Buy") ||
        (this.currentTrade.type === "Sell" && today.superTrendDirection === "Sell");
      
      reward += trendAligned ? 0.5 : -0.5;
    }

    return reward;
  }

  // RL action space: -1 (Sell), 0 (Hold), 1 (Buy)
  async takeAction(action) {
    const today = this.stock.now();

    if (action === 1 && !this.currentTrade) { // Buy
      const riskAmount = today.close * this.config.stopLossPercentage / 100;
      this.takePosition(riskAmount, today.close, "Buy");
      return true;
    }
    
    if (action === -1 && !this.currentTrade) { // Sell
      const riskAmount = today.close * this.config.stopLossPercentage / 100;
      this.takePosition(riskAmount, today.close, "Sell");
      return true;
    }

    if (action === 0 && this.currentTrade) { // Exit position
      this.exitPosition(today.close, this.currentTrade.quantity);
      return true;
    }

    return false;
  }

  // Risk management
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
      this.exitPosition(stopLossPrice, this.currentTrade.quantity);
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
      this.exitPosition(takeProfitPrice, this.currentTrade.quantity);
      return true;
    }

    return false;
  }

  // Main trading logic
  async trade() {
    if (this.capital <= 0) throw new Error("Capital exhausted");

    // Update state
    this.previousState = this.state;
    this.state = this.getState();

    // Check risk management first
    if (this.checkStopLoss() || this.checkTakeProfit()) {
      return;
    }

    // Get action from policy
    const action = this.getActionFromPolicy();
    
    // Take action and get reward
    await this.takeAction(action);
    const reward = this.calculateReward();
    this.episodeReward += reward;

    // Store experience and learn
    if (this.trainingMode && this.previousState) {
      this.storeExperience(this.previousState, action, reward, this.state);
      await this.learn();
    }
  }

  getActionFromPolicy() {
    if (Math.random() < this.config.explorationRate) {
      // Exploration: random action
      return Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
    }

    // Exploitation: choose action with highest Q-value
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
