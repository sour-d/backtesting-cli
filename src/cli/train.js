import chalk from "chalk";
import RLStrategy from "../core/strategy/RLStrategy.js";
import RLTrainer from "../core/strategy/RLTrainer.js";
import dataManager from "../utils/dataManager.js";

export const trainStrategy = async (filename, options = {}) => {
  try {
    // Parse filename for symbol and interval
    const match = filename.match(/([A-Z]+)_([^._]+)/);
    if (!match) {
      throw new Error(`Invalid filename format: ${filename}. Expected format: SYMBOL_INTERVAL[.json]`);
    }
    const [, symbol, interval] = match;

    // Validate market data exists
    const marketPath = dataManager.getMarketDataPath(symbol, interval);
    if (!dataManager.exists(marketPath)) {
      throw new Error(`Market data not found: ${marketPath}`);
    }

    console.log(chalk.cyan("\n🤖 Training Configuration:"));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold("Symbol:     ") + chalk.green(symbol));
    console.log(chalk.bold("Interval:   ") + chalk.green(interval));
    console.log(chalk.bold("Input:      ") + chalk.green(marketPath));

    // Initialize strategy
    const strategy = new RLStrategy(
      symbol,
      interval,
      (results) => {
        const modelPath = dataManager.getResultsPath(symbol, interval, "RL", "_model");
        dataManager.writeJSON(modelPath, results);
        console.log(chalk.green(`\nModel saved to ${modelPath}`));
      }
    );

    // Configure training
    const trainer = new RLTrainer(strategy, {
      epochs: options.epochs || 10,
      validationSplit: options.validationSplit || 0.2,
      miniBatchSize: options.batchSize || 32
    });

    console.log(chalk.bold("\nTraining Parameters:"));
    console.log(chalk.dim("• ") + chalk.yellow("Epochs:           ") + chalk.green(trainer.config.epochs));
    console.log(chalk.dim("• ") + chalk.yellow("Validation Split: ") + chalk.green(trainer.config.validationSplit));
    console.log(chalk.dim("• ") + chalk.yellow("Batch Size:      ") + chalk.green(trainer.config.miniBatchSize));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

    // Start training
    await trainer.train();

  } catch (error) {
    console.error(chalk.red("\n❌ Training failed: ") + error.message);
    throw error;
  }
};
