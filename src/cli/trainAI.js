import chalk from 'chalk';
import ora from 'ora';
import dataManager from '../core/data/dataManager.js';
import aiTrainingSymbols from '../config/aiTrainingSymbols.js';
import { getStockData } from '../core/parser/restructureData.js';
import { ExistingQuoteStorage } from '../core/storage/ExistingQuoteStorage.js';

export const trainAI = async (options = {}) => {
  const epochs = parseInt(options.epochs) || 1;
  const batchSize = parseInt(options.batchSize) || 32;
  const learningRate = parseFloat(options.learningRate) || 0.001;
  
  console.log(chalk.cyan("\n🤖 Starting AI Model Training"));
  console.log(chalk.dim("═══════════════════════════════════════"));
  console.log(chalk.bold("Training Configuration:"));
  console.log(chalk.dim("  Epochs: ") + chalk.green(epochs));
  console.log(chalk.dim("  Batch Size: ") + chalk.green(batchSize));
  console.log(chalk.dim("  Learning Rate: ") + chalk.green(learningRate));
  console.log(chalk.dim("  Training Symbols: ") + chalk.green(aiTrainingSymbols.length));
  console.log(chalk.dim("═══════════════════════════════════════\n"));

  try {
    // Ensure data directories exist
    dataManager.ensureDirectories();

    // Verify training data exists
    const spinner = ora('Verifying training data...').start();
    const validSymbols = [];
    for (const symbolInfo of aiTrainingSymbols) {
      const marketPath = dataManager.getMarketDataPath(symbolInfo.label);
      if (dataManager.exists(marketPath)) {
        validSymbols.push(symbolInfo);
      }
    }
    
    if (validSymbols.length === 0) {
      spinner.fail(chalk.red('No training data found'));
      console.log(chalk.yellow('\n💡 Please download training data first:'));
      console.log(chalk.cyan('   yarn cli download --ai'));
      return;
    }
    
    spinner.succeed(chalk.green(`Training data verified (${validSymbols.length}/${aiTrainingSymbols.length} symbols available)`));

    // Initialize AI model weights
    let globalWeights = {
      priceChange: 0.1,
      volumeChange: 0.05,
      ma20Trend: 0.3,
      ma60Trend: 0.2,
      atr: -0.1,
      rsi: 0.15
    };

    let trainingHistory = [];
    let totalTrades = 0;
    let totalProfits = 0;
    let totalLosses = 0;

    // Training loop
    for (let epoch = 1; epoch <= epochs; epoch++) {
      const epochSpinner = ora(`Training epoch ${epoch}/${epochs}...`).start();
      
      let epochRewards = [];
      let epochTrades = 0;
      let epochProfits = 0;
      let epochLosses = 0;

      // Train on each symbol
      for (const symbolInfo of validSymbols) {
        try {
          const result = await trainOnSymbol(symbolInfo, globalWeights, learningRate, epochSpinner);
          epochRewards.push(...result.rewards);
          epochTrades += result.trades;
          epochProfits += result.profits;
          epochLosses += result.losses;
          
          // Update global weights based on symbol performance
          Object.keys(globalWeights).forEach(key => {
            if (result.finalWeights[key] !== undefined) {
              globalWeights[key] = (globalWeights[key] * 0.9) + (result.finalWeights[key] * 0.1);
            }
          });
          
        } catch (error) {
          console.warn(chalk.yellow(`Warning: Failed to train on ${symbolInfo.symbol}: ${error.message}`));
        }
      }

      // Calculate epoch statistics
      const avgReward = epochRewards.length > 0 ? 
        epochRewards.reduce((a, b) => a + b, 0) / epochRewards.length : 0;
      const winRate = epochTrades > 0 ? (epochProfits / epochTrades) * 100 : 0;

      trainingHistory.push({
        epoch,
        avgReward: avgReward.toFixed(4),
        totalTrades: epochTrades,
        winRate: winRate.toFixed(2),
        weights: { ...globalWeights }
      });

      totalTrades += epochTrades;
      totalProfits += epochProfits;
      totalLosses += epochLosses;

      epochSpinner.succeed(
        chalk.green(`Epoch ${epoch}/${epochs}: `) +
        chalk.dim(`Avg Reward: ${avgReward.toFixed(4)}, `) +
        chalk.dim(`Trades: ${epochTrades}, `) +
        chalk.dim(`Win Rate: ${winRate.toFixed(1)}%`)
      );
    }

    // Save trained model
    const saveSpinner = ora('Saving trained model...').start();
    
    const trainedModel = {
      name: 'TrainedSimpleAI',
      version: '1.0.0',
      type: 'pre-trained',
      trainedWeights: globalWeights,
      trainingConfig: {
        epochs,
        batchSize,
        learningRate,
        symbolsUsed: validSymbols.length
      },
      performance: {
        totalTrades,
        totalProfits,
        totalLosses,
        overallWinRate: totalTrades > 0 ? ((totalProfits / totalTrades) * 100).toFixed(2) : 0,
        finalAvgReward: trainingHistory.length > 0 ? 
          trainingHistory[trainingHistory.length - 1].avgReward : 0
      },
      trainingHistory,
      createdAt: new Date().toISOString()
    };

    const modelPath = dataManager.getModelPath('trained_ai_model');
    dataManager.writeJSON(modelPath, trainedModel);
    saveSpinner.succeed(chalk.green('Trained model saved'));

    // Save detailed training statistics
    const statsSpinner = ora('Saving training statistics...').start();
    const trainingStats = {
      model: 'TrainedSimpleAI',
      configuration: trainedModel.trainingConfig,
      performance: trainedModel.performance,
      trainingHistory: trainedModel.trainingHistory,
      finalWeights: globalWeights,
      lastUpdated: new Date().toISOString()
    };

    const statsPath = dataManager.getModelPath('trained_ai_training_stats');
    dataManager.writeJSON(statsPath, trainingStats);
    statsSpinner.succeed(chalk.green('Training statistics saved'));

    console.log(chalk.green("\n✅ AI Model training completed successfully!"));
    console.log(chalk.dim("═══════════════════════════════════════"));
    console.log(chalk.bold("Training Results:"));
    console.log(chalk.dim("  Total Epochs: ") + chalk.green(epochs));
    console.log(chalk.dim("  Total Trades: ") + chalk.green(totalTrades));
    console.log(chalk.dim("  Win Rate: ") + chalk.green(trainedModel.performance.overallWinRate + '%'));
    console.log(chalk.dim("  Final Avg Reward: ") + chalk.green(trainedModel.performance.finalAvgReward));
    console.log(chalk.bold("Final Weights:"));
    Object.entries(globalWeights).forEach(([key, value]) => {
      console.log(chalk.dim(`  ${key}: `) + chalk.green(value.toFixed(4)));
    });
    console.log(chalk.dim("═══════════════════════════════════════"));
    console.log(chalk.bold("Model saved to: ") + chalk.green('.data/model/trained_ai_model.json'));
    console.log(chalk.bold("Training stats: ") + chalk.green('.data/model/trained_ai_training_stats.json'));
    console.log(chalk.dim("═══════════════════════════════════════\n"));

    console.log(chalk.cyan("🚀 You can now use the trained AI strategy:"));
    console.log(chalk.green("  yarn cli run SimpleAIStrategy -i 0"));
    console.log(chalk.green("  yarn cli run SimpleAIStrategy --all"));

  } catch (error) {
    console.error(chalk.red("\n❌ Training failed: ") + error.message);
    throw error;
  }
};

// Function to train on a single symbol
async function trainOnSymbol(symbolInfo, initialWeights, learningRate, spinner) {
  spinner.text = `Training on ${symbolInfo.symbol}...`;
  
  // Load stock data
  const stockData = getStockData(symbolInfo, []);
  const stock = new ExistingQuoteStorage(stockData, 60);
  
  // Initialize training state
  let weights = { ...initialWeights };
  let position = 0;
  let capital = 100000;
  const initialCapital = capital;
  let rewards = [];
  let trades = 0;
  let profits = 0;
  let losses = 0;
  
  // Training simulation
  while (stock.hasData() && stock.move()) {
    try {
      const features = extractFeatures(stock, position);
      if (!features) continue;
      
      // Get action using current weights
      const action = predict(features, weights);
      
      // Execute action
      const currentPrice = stock.now().close;
      const previousPrice = stock.prev(1)?.close || currentPrice;
      
      let newPosition = position;
      let tradeExecuted = false;
      
      if (action === 1 && position === 0) { // Buy
        const shares = Math.floor((capital * 0.02) / currentPrice); // 2% risk
        if (shares > 0) {
          newPosition = shares;
          capital -= shares * currentPrice;
          tradeExecuted = true;
        }
      } else if (action === 2 && position > 0) { // Sell
        capital += position * currentPrice;
        newPosition = 0;
        tradeExecuted = true;
      }
      
      if (tradeExecuted) {
        trades++;
        const tradeReturn = (capital + newPosition * currentPrice - initialCapital) / initialCapital;
        if (tradeReturn > 0) profits++;
        else losses++;
      }
      
      // Calculate reward
      const reward = calculateReward(action, previousPrice, currentPrice, position, capital);
      rewards.push(reward);
      
      // Update weights using simple gradient descent
      if (rewards.length > 10) {
        const recentRewards = rewards.slice(-10);
        const avgReward = recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length;
        
        if (Math.abs(avgReward) > 0.1) {
          Object.keys(weights).forEach(key => {
            if (features[key] !== undefined) {
              const gradient = avgReward * features[key] * learningRate;
              weights[key] += gradient;
              weights[key] = Math.max(-2, Math.min(2, weights[key])); // Bound weights
            }
          });
        }
      }
      
      position = newPosition;
      
    } catch (error) {
      // Continue training even if individual steps fail
      continue;
    }
  }
  
  return {
    symbol: symbolInfo.symbol,
    finalWeights: weights,
    rewards,
    trades,
    profits,
    losses,
    finalValue: capital + position * (stock.now()?.close || 0)
  };
}

// Extract features for training
function extractFeatures(stock, position) {
  const current = stock.now();
  const previous = stock.prev(1);
  
  if (!current || !previous) return null;
  
  // Simple feature extraction
  const quotes = [];
  for (let i = 20; i >= 0; i--) {
    const quote = stock.prev(i);
    if (quote) quotes.push(quote);
  }
  
  const ma20 = quotes.length >= 20 ? 
    quotes.slice(-20).reduce((acc, q) => acc + q.close, 0) / 20 : current.close;
  
  return {
    priceChange: (current.close - previous.close) / previous.close,
    volumeChange: (current.volume - previous.volume) / (previous.volume || 1),
    ma20Trend: current.close > ma20 ? 1 : -1,
    ma60Trend: current.close > previous.close ? 1 : -1,
    atr: Math.abs(current.close - previous.close) / previous.close,
    rsi: current.close > previous.close ? 0.6 : -0.6, // Simplified RSI
    inPosition: position > 0 ? 1 : -1
  };
}

// Simple prediction function
function predict(features, weights) {
  let score = 0;
  Object.keys(weights).forEach(key => {
    if (features[key] !== undefined) {
      score += features[key] * weights[key];
    }
  });
  
  if (score > 0.3) return 1; // Buy
  if (score < -0.3) return 2; // Sell
  return 0; // Hold
}

// Calculate reward for learning
function calculateReward(action, previousPrice, currentPrice, position, capital) {
  const priceChange = (currentPrice - previousPrice) / previousPrice;
  let reward = 0;
  
  if (action === 1 && position === 0) { // Buy action
    reward = priceChange * 100;
  } else if (action === 2 && position > 0) { // Sell action
    reward = priceChange * 100;
  } else { // Hold action
    reward = -Math.abs(priceChange) * 5;
  }
  
  return reward;
}
