import chalk from "chalk";
import ora from "ora";
import { transformTradesData } from "../result/transformResult.js";

class RLTrainer {
  constructor(strategy, config = {}) {
    this.strategy = strategy;
    this.config = {
      epochs: 10,
      validationSplit: 0.2,
      miniBatchSize: 32,
      minTradeCount: 10,
      minWinRate: 0.4,
      minSharpeRatio: 0.5,
      improvementThreshold: 0.1,
      ...config
    };
    
    this.trainingStats = {
      epoch: 0,
      totalReward: 0,
      avgReward: 0,

      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      tradeCount: 0
    };

    this.bestPerformance = {
      sharpeRatio: -Infinity,
      winRate: 0,
      weights: null,
      bias: 0,
      epoch: 0,
      saved: false
    };
  }

  calculatePerformanceMetrics(result) {
    if (!result || !result.tradeResults || result.tradeResults.length === 0) {
      return {
        totalReturn: 0,
        sharpeRatio: -Infinity,
        winRate: 0,
        maxDrawdown: 0,
        tradeCount: 0,
        avgTradeReturn: 0,
        profitFactor: 0
      };
    }

    const transformedTrades = transformTradesData(
      result.tradeResults,
      result.metadata.capital,
      result.metadata.timeFrame
    );

    if (transformedTrades.length === 0) {
      return {
        totalReturn: 0,
        sharpeRatio: -Infinity,
        winRate: 0,
        maxDrawdown: 0,
        tradeCount: 0,
        avgTradeReturn: 0,
        profitFactor: 0
      };
    }

    const returns = transformedTrades.map(trade => trade.profitOrLoss);
    const winningTrades = returns.filter(r => r > 0);
    const losingTrades = returns.filter(r => r < 0);
    
    const totalWins = winningTrades.reduce((sum, r) => sum + r, 0) || 0;
    const totalLosses = Math.abs(losingTrades.reduce((sum, r) => sum + r, 0)) || 1e-10;
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance || 1e-10);

    const maxDrawdown = transformedTrades.reduce((max, trade) => 
      Math.max(max, Math.abs(trade.drawDown || 0)), 0);
    
    return {
      totalReturn: returns.reduce((a, b) => a + b, 0),
      sharpeRatio: mean / stdDev,
      winRate: winningTrades.length / returns.length,
      maxDrawdown,
      tradeCount: returns.length,
      avgTradeReturn: mean,
      profitFactor: totalWins / totalLosses,
      transformedTrades
    };
  }

  isSignificantImprovement(current, best) {
    return (
      current.tradeCount >= this.config.minTradeCount &&
      current.winRate >= this.config.minWinRate &&
      current.sharpeRatio >= this.config.minSharpeRatio &&
      current.sharpeRatio > best.sharpeRatio * (1 + this.config.improvementThreshold) &&
      current.transformedTrades &&
      current.transformedTrades.length > 0
    );
  }

  async train() {
    const spinner = ora("Starting training...").start();
    this.strategy.trainingMode = true;

    try {
      for (let epoch = 1; epoch <= this.config.epochs; epoch++) {
        spinner.text = chalk.yellow(`Training epoch ${epoch}/${this.config.epochs}`);
        
        // Run episode
        const result = await this.strategy.execute();

        // Calculate performance metrics
        const metrics = this.calculatePerformanceMetrics(result);
        
        // Update training stats
        this.trainingStats = {
          epoch,
          totalReward: this.strategy.episodeReward,
          avgReward: metrics.avgTradeReturn || 0,
          winRate: (metrics.winRate * 100) || 0,
          maxDrawdown: metrics.maxDrawdown || 0,
          sharpeRatio: metrics.sharpeRatio || -Infinity,
          tradeCount: metrics.tradeCount || 0,
          profitFactor: metrics.profitFactor || 0
        };

        // Check if this is significantly better than the best model
        if (this.isSignificantImprovement(metrics, this.bestPerformance)) {
          this.bestPerformance = {
            sharpeRatio: metrics.sharpeRatio,
            winRate: metrics.winRate * 100,
            weights: { ...this.strategy.qValues.weights },
            bias: this.strategy.qValues.bias,
            epoch,
            saved: false,
            profitFactor: metrics.profitFactor,
            transformedTrades: metrics.transformedTrades
          };

          // Save best model
          await this.saveModel();
          spinner.succeed(chalk.green(
            `New best model at epoch ${epoch} ` +
            `(SR: ${metrics.sharpeRatio.toFixed(2)}, ` +
            `WR: ${(metrics.winRate * 100).toFixed(1)}%, ` +
            `PF: ${metrics.profitFactor.toFixed(2)})`
          ));
        }

        // Display progress
        this.displayProgress(spinner);

        // Early stopping check
        if (metrics.tradeCount >= this.config.minTradeCount &&
            metrics.sharpeRatio > 2 && 
            metrics.winRate > 0.6 &&
            metrics.profitFactor > 2) {
          spinner.succeed(chalk.green("Early stopping: Performance targets reached"));
          break;
        }

        spinner.start();
      }

      // Restore best weights
      if (this.bestPerformance.weights) {
        this.strategy.qValues.weights = { ...this.bestPerformance.weights };
        this.strategy.qValues.bias = this.bestPerformance.bias;
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
      chalk.yellow(`Total Reward:    ${stats.totalReward.toFixed(2)}`),
      chalk.yellow(`Avg Trade P&L:   ${stats.avgReward.toFixed(2)}`),
      chalk.green(`Win Rate:        ${stats.winRate.toFixed(1)}%`),
      chalk.red(`Max Drawdown:     ${stats.maxDrawdown.toFixed(2)}`),
      chalk.blue(`Sharpe Ratio:    ${stats.sharpeRatio.toFixed(2)}`),
      chalk.magenta(`Trade Count:     ${stats.tradeCount}`),
      chalk.cyan(`Profit Factor:   ${stats.profitFactor.toFixed(2)}`),
      chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    ].join("\n");

    spinner.text = progressText;
  }

  displayFinalStats() {
    if (!this.bestPerformance.transformedTrades) {
      console.log(chalk.yellow("\nNo valid trades recorded during training."));
      return;
    }

    console.log(chalk.cyan("\n📈 Training Results:"));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold("Best Model (Epoch " + this.bestPerformance.epoch + "):"));
    console.log(chalk.yellow(`• Win Rate:      ${this.bestPerformance.winRate.toFixed(1)}%`));
    console.log(chalk.yellow(`• Sharpe Ratio:  ${this.bestPerformance.sharpeRatio.toFixed(2)}`));
    console.log(chalk.yellow(`• Max Drawdown:  ${this.trainingStats.maxDrawdown.toFixed(2)}`));
    console.log(chalk.yellow(`• Trade Count:   ${this.trainingStats.tradeCount}`));
    console.log(chalk.yellow(`• Profit Factor: ${this.bestPerformance.profitFactor.toFixed(2)}`));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

    // Display feature importance
    console.log(chalk.bold("Feature Importance:"));
    const weights = this.bestPerformance.weights || this.strategy.qValues.weights;
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

  async saveModel() {
    if (this.bestPerformance.saved || 
        !this.bestPerformance.transformedTrades ||
        this.bestPerformance.transformedTrades.length === 0) {
      return;
    }

    const modelData = {
      weights: this.strategy.qValues.weights,
      bias: this.strategy.qValues.bias,
      normalizer: this.strategy.stateNormalizer.getStats(),
      config: this.strategy.config,
      trainingStats: this.trainingStats,
      performance: {
        sharpeRatio: this.bestPerformance.sharpeRatio,
        winRate: this.bestPerformance.winRate,
        epoch: this.bestPerformance.epoch,
        profitFactor: this.bestPerformance.profitFactor
      },
      trades: this.bestPerformance.transformedTrades
    };

    const savePayload = {
      ...modelData,
      metadata: {
        modelType: "RL-Strategy",
        version: "1.0",
        timestamp: new Date().toISOString()
      }
    };

    try {
      await this.strategy.persistTradesFn(savePayload);
      this.bestPerformance.saved = true;
      console.log(chalk.green(`Model saved with ${this.bestPerformance.transformedTrades.length} trades`));
    } catch (error) {
      console.log(chalk.red(`Failed to save model: ${error.message}`));
    }
  }
}

export default RLTrainer;
