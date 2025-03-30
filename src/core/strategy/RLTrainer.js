import chalk from "chalk";
import ora from "ora";

class RLTrainer {
  constructor(strategy, config = {}) {
    this.strategy = strategy;
    this.config = {
      epochs: 10,
      validationSplit: 0.2,
      miniBatchSize: 32,
      ...config
    };
    
    this.trainingStats = {
      epoch: 0,
      totalReward: 0,
      avgReward: 0,
      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0
    };
  }

  calculatePerformanceMetrics(results) {
    results = 

    const returns = results.tradeResults.map(trade => trade.profitOrLoss);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      totalReturn: returns.reduce((a, b) => a + b, 0),
      sharpeRatio: mean / (stdDev || 1), // Risk-free rate assumed 0 for simplicity
      winRate: results.tradeResults.filter(t => t.profitOrLoss > 0).length / results.tradeResults.length,
      maxDrawdown: Math.abs(results.maxDrawDown || 0)
    };
  }

  async train() {
    const spinner = ora("Starting training...").start();
    this.strategy.trainingMode = true;

    try {
      for (let epoch = 1; epoch <= this.config.epochs; epoch++) {
        spinner.text = chalk.yellow(`Training epoch ${epoch}/${this.config.epochs}`);
        
        // Reset episode stats
        this.strategy.episodeReward = 0;
        this.strategy.replayBuffer.clear();
        this.strategy.stateNormalizer.reset();

        // Run episode
        await this.strategy.execute();

        // Calculate performance metrics
        const metrics = this.calculatePerformanceMetrics(this.strategy.trades);
        console.log("------", metrics);
        
        // Update training stats
        this.trainingStats = {
          epoch,
          totalReward: this.strategy.episodeReward,
          avgReward: this.strategy.episodeReward / this.strategy.trades.tradeResults.length,
          winRate: metrics.winRate * 100,
          maxDrawdown: metrics.maxDrawdown,
          sharpeRatio: metrics.sharpeRatio
        };

        // Display progress
        this.displayProgress(spinner);

        // Early stopping check
        if (metrics.sharpeRatio > 2 && metrics.winRate > 0.6) {
          spinner.succeed(chalk.green("Early stopping: Performance targets reached"));
          break;
        }
      }

      spinner.succeed(chalk.green("Training completed"));
      this.displayFinalStats();
    } catch (error) {
      spinner.fail(chalk.red(`Training failed: ${error.message}`));
      throw error;
    } finally {
      this.strategy.trainingMode = false;
    }
  }

  displayProgress(spinner) {
    const stats = this.trainingStats;
    const progressText = [
      chalk.cyan(`\nEpoch ${stats.epoch}/${this.config.epochs}`),
      chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"),
      chalk.yellow(`Total Reward:  ${stats.totalReward.toFixed(2)}`),
      chalk.yellow(`Avg Reward:    ${stats.avgReward.toFixed(2)}`),
      chalk.green(`Win Rate:      ${stats.winRate.toFixed(1)}%`),
      chalk.red(`Max Drawdown:   ${stats.maxDrawdown.toFixed(2)}`),
      chalk.blue(`Sharpe Ratio:  ${stats.sharpeRatio.toFixed(2)}`),
      chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    ].join("\n");

    spinner.text = progressText;
  }

  displayFinalStats() {
    console.log(chalk.cyan("\n📈 Training Results:"));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold("Final Metrics:"));
    console.log(chalk.yellow(`• Win Rate:      ${this.trainingStats.winRate.toFixed(1)}%`));
    console.log(chalk.yellow(`• Sharpe Ratio:  ${this.trainingStats.sharpeRatio.toFixed(2)}`));
    console.log(chalk.yellow(`• Max Drawdown:  ${this.trainingStats.maxDrawdown.toFixed(2)}`));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

    // Display feature importance
    console.log(chalk.bold("Feature Importance:"));
    const weights = this.strategy.qValues.weights;
    const sortedFeatures = Object.entries(weights)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
      .slice(0, 5);

    sortedFeatures.forEach(([feature, weight]) => {
      const bar = "█".repeat(Math.abs(weight) * 20);
      console.log(
        chalk.dim("•"),
        chalk.yellow(feature.padEnd(15)),
        weight > 0 ? chalk.green(bar) : chalk.red(bar)
      );
    });
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  }

  // Save trained model weights
  async saveModel(path) {
    const modelData = {
      weights: this.strategy.qValues.weights,
      bias: this.strategy.qValues.bias,
      normalizer: this.strategy.stateNormalizer.getStats(),
      config: this.strategy.config,
      trainingStats: this.trainingStats
    };

    await this.strategy.persistTradesFn({
      ...modelData,
      metadata: {
        modelType: "RL-Strategy",
        version: "1.0",
        timestamp: new Date().toISOString()
      }
    });
  }
}

export default RLTrainer;
