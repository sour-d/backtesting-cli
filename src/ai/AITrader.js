import * as tf from '@tensorflow/tfjs-node';
import chalk from 'chalk';
import ora from 'ora';
import dataManager from '../core/data/dataManager.js';
import { ExistingQuoteStorage } from '../core/storage/ExistingQuoteStorage.js';
import { getStockData } from '../core/parser/restructureData.js';
import ReplayBuffer from '../core/strategy/ReplayBuffer.js';
import StateNormalizer from '../core/strategy/StateNormalizer.js';
import { movingAverageOf } from '../core/indicators/nDayMA.js';
import calculateSuperTrendForQuote from '../core/indicators/superTrend.js';
import calculateATR from '../core/indicators/atr.js';

export class AITrader {
  constructor(config = {}) {
    this.config = {
      epochs: config.epochs || 1000,
      batchSize: config.batchSize || 32,
      learningRate: config.learningRate || 0.001,
      memorySize: config.memorySize || 10000,
      epsilon: config.epsilon || 1.0,
      epsilonMin: config.epsilonMin || 0.01,
      epsilonDecay: config.epsilonDecay || 0.995,
      gamma: config.gamma || 0.95,
      targetUpdateFreq: config.targetUpdateFreq || 100,
      ...config
    };

    this.model = null;
    this.targetModel = null;
    this.replayBuffer = new ReplayBuffer(this.config.memorySize);
    this.stateNormalizer = new StateNormalizer();
    this.trainingStats = {
      episodes: 0,
      totalReward: 0,
      avgReward: 0,
      winRate: 0,
      losses: [],
      profits: [],
      maxDrawdown: 0
    };

    // Action space: 0 = Hold, 1 = Buy, 2 = Sell
    this.actionSpace = 3;
    this.stateSize = 15; // Will be calculated based on features
  }

  // Create the neural network model
  createModel() {
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.stateSize],
          units: 128,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 64,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 32,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.dense({
          units: this.actionSpace,
          activation: 'linear'
        })
      ]
    });

    model.compile({
      optimizer: tf.train.adam(this.config.learningRate),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });

    return model;
  }

  // Helper method to calculate simple moving average
  calculateSMA(quotes, period) {
    if (quotes.length < period) return null;
    const sum = quotes.slice(-period).reduce((acc, quote) => acc + quote.close, 0);
    return sum / period;
  }

  // Extract features from market data
  extractFeatures(stock, position = 0) {
    const current = stock.now();
    const previous = stock.prev(1);
    
    if (!current || !previous) {
      return null;
    }

    // Get historical data for indicators
    const quotes = [];
    for (let i = 60; i >= 0; i--) {
      const quote = stock.prev(i);
      if (quote) quotes.push(quote);
    }

    // Calculate technical indicators
    const ma20 = this.calculateSMA(quotes, 20);
    const ma60 = this.calculateSMA(quotes, 60);

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
      inPosition: position !== 0 ? 1 : 0,
      positionType: position > 0 ? 1 : (position < 0 ? -1 : 0)
    };
  }

  // Calculate reward based on profit and risk
  calculateReward(action, previousPrice, currentPrice, position, capital, risk) {
    let reward = 0;
    const priceChange = (currentPrice - previousPrice) / previousPrice;
    
    // Base reward on price movement and action taken
    if (action === 1 && position === 0) { // Buy action
      // Reward buying before price increases
      reward = priceChange * 100;
    } else if (action === 2 && position > 0) { // Sell action when long
      // Reward selling for profit
      const profit = (currentPrice - previousPrice) * position;
      const profitRatio = profit / (risk || 1);
      reward = profitRatio * 10;
    } else if (action === 0) { // Hold action
      // Small penalty for holding, reward for not making bad trades
      reward = -0.1;
      if (Math.abs(priceChange) < 0.002) { // Low volatility
        reward = 0.1; // Reward for not overtrading
      }
    }

    // Risk-adjusted reward
    const volatility = Math.abs(priceChange);
    if (volatility > 0.05) { // High volatility penalty
      reward -= volatility * 5;
    }

    // Capital utilization bonus
    const utilizationRatio = Math.abs(position * currentPrice) / capital;
    if (utilizationRatio > 0.8) { // Over-leveraged penalty
      reward -= 10;
    }

    return reward;
  }

  // Get action using epsilon-greedy policy
  async getAction(state, training = true) {
    if (training && Math.random() < this.config.epsilon) {
      return Math.floor(Math.random() * this.actionSpace);
    }

    const stateValues = Object.values(state).filter(v => typeof v === 'number');
    const stateTensor = tf.tensor2d([stateValues]);
    const qValues = this.model.predict(stateTensor);
    const action = (qValues).argMax(1).dataSync()[0];
    
    stateTensor.dispose();
    qValues.dispose();
    
    return action;
  }

  // Train the model on a batch of experiences
  async trainModel() {
    if (this.replayBuffer.size < this.config.batchSize) {
      return;
    }

    const batch = this.replayBuffer.sample(this.config.batchSize);
    const states = batch.map(exp => Object.values(exp.state).filter(v => typeof v === 'number'));
    const nextStates = batch.map(exp => Object.values(exp.nextState).filter(v => typeof v === 'number'));

    const stateTensor = tf.tensor2d(states);
    const nextStateTensor = tf.tensor2d(nextStates);

    const qValues = this.model.predict(stateTensor);
    const nextQValues = this.targetModel.predict(nextStateTensor);

    const qTargets = await (qValues).data();
    const nextQData = await (nextQValues).data();

    for (let i = 0; i < batch.length; i++) {
      const { action, reward } = batch[i];
      const maxNextQ = Math.max(...nextQData.slice(i * this.actionSpace, (i + 1) * this.actionSpace));
      const target = reward + this.config.gamma * maxNextQ;
      qTargets[i * this.actionSpace + action] = target;
    }

    const targetTensor = tf.tensor2d(Array.from(qTargets), [batch.length, this.actionSpace]);
    
    const history = await this.model.fit(stateTensor, targetTensor, {
      epochs: 1,
      verbose: 0
    });

    const loss = history.history.loss[0];
    this.trainingStats.losses.push(loss);

    // Cleanup
    stateTensor.dispose();
    nextStateTensor.dispose();
    (qValues).dispose();
    (nextQValues).dispose();
    targetTensor.dispose();

    return loss;
  }

  // Train on a single symbol
  async trainOnSymbol(symbolInfo, spinner) {
    const stockData = getStockData(symbolInfo, []);
    const stock = new ExistingQuoteStorage(stockData, 60);
    
    let position = 0;
    let capital = 100000;
    const initialCapital = capital;
    let totalReward = 0;
    let episodeSteps = 0;
    
    spinner.text = `Training on ${symbolInfo.symbol} (${symbolInfo.label})`;

    while (stock.hasData() && stock.move()) {
      const features = this.extractFeatures(stock, position);
      if (!features) continue;

      // Update state normalizer
      this.stateNormalizer.update(features);
      const normalizedState = this.stateNormalizer.normalize(features);

      // Get action
      const action = await this.getAction(normalizedState, true);
      
      // Execute action
      const currentPrice = stock.now().close;
      const previousPrice = stock.prev(1)?.close || currentPrice;
      
      let newPosition = position;
      const riskAmount = capital * 0.02; // 2% risk per trade
      
      if (action === 1 && position === 0) { // Buy
        const shares = Math.floor(riskAmount / currentPrice);
        newPosition = shares;
        capital -= shares * currentPrice;
      } else if (action === 2 && position > 0) { // Sell
        capital += position * currentPrice;
        newPosition = 0;
      }

      // Move to next state
      if (stock.move()) {
        const nextFeatures = this.extractFeatures(stock, newPosition);
        if (nextFeatures) {
          const nextNormalizedState = this.stateNormalizer.normalize(nextFeatures);
          const reward = this.calculateReward(action, previousPrice, currentPrice, position, capital, riskAmount);
          
          // Store experience
          this.replayBuffer.push(normalizedState, action, reward, nextNormalizedState);
          
          totalReward += reward;
          episodeSteps++;
          position = newPosition;
        }
        // Move back one step since we moved forward to get next state
        stock.currentQuoteIndex--;
      }

      // Train model periodically
      if (episodeSteps % 10 === 0) {
        await this.trainModel();
      }
    }

    // Calculate final stats
    const finalValue = capital + (position * stock.now().close);
    const totalReturn = (finalValue - initialCapital) / initialCapital;
    
    this.trainingStats.episodes++;
    this.trainingStats.totalReward += totalReward;
    this.trainingStats.profits.push(totalReturn);

    // Decay epsilon
    if (this.config.epsilon > this.config.epsilonMin) {
      this.config.epsilon *= this.config.epsilonDecay;
    }

    return {
      symbol: symbolInfo.symbol,
      totalReward,
      totalReturn,
      steps: episodeSteps
    };
  }

  // Main training function
  async train(trainingSymbols) {
    const spinner = ora('Initializing AI model...').start();

    try {
      // Create models
      this.model = this.createModel();
      this.targetModel = this.createModel();
      
      spinner.succeed('AI model initialized');

      // Training loop
      for (let epoch = 0; epoch < this.config.epochs; epoch++) {
        const epochSpinner = ora(`Training epoch ${epoch + 1}/${this.config.epochs}`).start();
        
        let epochReward = 0;
        let epochSteps = 0;

        // Train on each symbol
        for (const symbolInfo of trainingSymbols) {
          try {
            const result = await this.trainOnSymbol(symbolInfo, epochSpinner);
            epochReward += result.totalReward;
            epochSteps += result.steps;
          } catch (error) {
            console.warn(chalk.yellow(`Warning: Failed to train on ${symbolInfo.symbol}: ${error.message}`));
          }
        }

        // Update target model periodically
        if (epoch % this.config.targetUpdateFreq === 0) {
          const weights = this.model.getWeights();
          this.targetModel.setWeights(weights);
        }

        // Update stats
        this.trainingStats.avgReward = epochReward / trainingSymbols.length;
        
        epochSpinner.succeed(
          `Epoch ${epoch + 1}: Avg Reward = ${this.trainingStats.avgReward.toFixed(2)}, ε = ${this.config.epsilon.toFixed(3)}`
        );

        // Save model periodically
        if ((epoch + 1) % 100 === 0) {
          await this.saveModel();
        }
      }

      // Final save
      await this.saveModel();
      await this.saveTrainingStats();

    } catch (error) {
      spinner.fail('Training failed');
      throw error;
    }
  }

  // Save the trained model
  async saveModel() {
    const modelPath = dataManager.getModelPath('ai_trading_model');
    await this.model.save(`file://${modelPath.replace('.json', '')}`);
    
    // Save state normalizer
    const normalizerPath = dataManager.getModelPath('ai_state_normalizer');
    dataManager.writeJSON(normalizerPath, {
      stats: this.stateNormalizer.stats,
      config: this.config
    });
  }

  // Save training statistics
  async saveTrainingStats() {
    const statsPath = dataManager.getModelPath('ai_training_stats');
    
    // Calculate additional metrics
    const profits = this.trainingStats.profits.filter(p => p > 0);
    const losses = this.trainingStats.profits.filter(p => p < 0);
    
    const stats = {
      ...this.trainingStats,
      winRate: profits.length / this.trainingStats.profits.length,
      avgProfit: profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
      profitFactor: losses.length > 0 ? 
        (profits.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0))) : 
        Infinity,
      config: this.config,
      timestamp: new Date().toISOString()
    };

    dataManager.writeJSON(statsPath, stats);
  }

  // Load a trained model
  async loadModel() {
    try {
      const modelPath = dataManager.getModelPath('ai_trading_model');
      this.model = await tf.loadLayersModel(`file://${modelPath.replace('.json', '')}/model.json`);
      
      // Load state normalizer
      const normalizerPath = dataManager.getModelPath('ai_state_normalizer');
      if (dataManager.exists(normalizerPath)) {
        const normalizerData = dataManager.readJSON(normalizerPath);
        this.stateNormalizer.stats = normalizerData.stats;
        this.config = { ...this.config, ...normalizerData.config };
      }
      
      return true;
    } catch (error) {
      console.warn(chalk.yellow(`Could not load model: ${error.message}`));
      return false;
    }
  }

  // Make a prediction
  async predict(state) {
    if (!this.model) {
      throw new Error('Model not loaded. Please train or load a model first.');
    }

    const normalizedState = this.stateNormalizer.normalize(state);
    const stateValues = Object.values(normalizedState).filter(v => typeof v === 'number');
    const stateTensor = tf.tensor2d([stateValues]);
    const qValues = this.model.predict(stateTensor);
    const action = (qValues).argMax(1).dataSync()[0];
    const actionValues = await (qValues).data();
    
    stateTensor.dispose();
    qValues.dispose();
    
    return {
      action,
      confidence: Math.max(...actionValues),
      actionValues: Array.from(actionValues)
    };
  }
}
