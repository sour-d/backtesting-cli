import strategies from "../core/strategy/index.js";
import chalk from "chalk";
import ora from "ora";
import dataManager from "../utils/dataManager.js";

const findStrategy = (strategies, name) => {
  return strategies.find((s) => s.name === name);
};

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(amount);
};

const parseFilename = (filename) => {
  // Extract symbol and interval from filename (e.g., "BTCUSDT_1m.json" or "BTCUSDT_1m")
  const match = filename.match(/([A-Z]+)_([^._]+)/);
  if (!match) {
    throw new Error(`Invalid filename format: ${filename}. Expected format: SYMBOL_INTERVAL[.json]`);
  }
  return { symbol: match[1], interval: match[2] };
};

const persistResult = (symbol, interval, strategyName) => (result) => {
  const spinner = ora("Saving strategy results...").start();

  try {
    dataManager.ensureDirectories();
    const resultPath = dataManager.getResultsPath(symbol, interval, strategyName);
    dataManager.writeJSON(resultPath, result);
    spinner.succeed(chalk.green(`Results saved to ${resultPath}`));

    // Display trade summary
    const winningTrades = result.tradeResults.filter(t => t.pnl > 0).length;
    const losingTrades = result.tradeResults.filter(t => t.pnl < 0).length;
    const winRate = ((winningTrades / result.tradeResults.length) * 100).toFixed(2);
    const totalPnL = formatCurrency(result.totalPnL);
    const pnlColor = result.totalPnL > 0 ? chalk.green : chalk.red;

    console.log(chalk.cyan("\n📊 Trading Summary:"));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold("Symbol:         ") + chalk.green(result.metadata.symbol));
    console.log(chalk.bold("Interval:       ") + chalk.green(result.metadata.interval));
    console.log(chalk.bold("Total Trades:   ") + chalk.green(result.tradeResults.length));
    console.log(chalk.bold("Winning Trades: ") + chalk.green(winningTrades));
    console.log(chalk.bold("Losing Trades:  ") + chalk.red(losingTrades));
    console.log(chalk.bold("Total P&L:      ") + pnlColor(totalPnL));
    console.log(chalk.bold("Win Rate:       ") + chalk.yellow(winRate + "%"));
    console.log(chalk.bold("Initial Capital:") + chalk.blue(formatCurrency(result.metadata.capital)));
    console.log(chalk.bold("Risk %:         ") + chalk.blue(result.metadata.riskPercentage + "%"));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to save results: " + error.message));
    throw error;
  }
};

export const runStrategy = async (filename, strategyName) => {
  // Validate inputs
  if (!filename) {
    throw new Error('Filename is required');
  }
  if (!strategyName) {
    throw new Error('Strategy name is required');
  }

  // Parse symbol and interval from filename
  const { symbol, interval } = parseFilename(filename);

  // Validate market data exists
  const marketPath = dataManager.getMarketDataPath(symbol, interval);
  if (!dataManager.exists(marketPath)) {
    throw new Error(`Market data not found: ${marketPath}`);
  }

  // Find strategy
  const strategyClass = findStrategy(strategies, strategyName);
  if (!strategyClass) {
    throw new Error(`Strategy not found: ${strategyName}`);
  }

  console.log(chalk.cyan("\n🤖 Strategy Execution:"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold("Strategy:   ") + chalk.green(strategyName));
  console.log(chalk.bold("Symbol:     ") + chalk.green(symbol));
  console.log(chalk.bold("Interval:   ") + chalk.green(interval));
  console.log(chalk.bold("Input:      ") + chalk.green(marketPath));
  
  // Get strategy configuration
  const config = strategyClass.getDefaultConfig();
  console.log(chalk.bold("\nConfiguration:"));
  Object.entries(config).forEach(([key, value]) => {
    console.log(chalk.dim("• ") + chalk.yellow(key) + ": " + chalk.green(value));
  });
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  const spinner = ora({
    text: chalk.yellow("Initializing strategy..."),
    spinner: 'dots'
  }).start();

  try {
    const strategyInstance = new strategyClass(
      symbol,
      interval,
      persistResult(symbol, interval, strategyName),
      strategyClass.getDefaultConfig()
    );

    spinner.text = chalk.yellow("Executing strategy...");
    await strategyInstance.execute();
    spinner.succeed(chalk.green("Strategy execution completed"));
  } catch (error) {
    spinner.fail(chalk.red("Strategy execution failed: " + error.message));
    throw error;
  }
};
