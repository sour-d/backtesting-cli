import strategies from "../core/strategy/index.js";
import chalk from "chalk";
import ora from "ora";
import dataManager from "../core/data/dataManager.js";
import { saveResults } from "../core/result/results.js";
import { transformStockData } from "../core/parser/restructureData.js";
import _ from "lodash";
import symbols from "../config/symbols.js";

const findStrategy = (strategies, name) => {
  return strategies.find((s) => s.name === name);
};

const parseFilename = (filename) => {
  const match = filename.match(/([A-Z]+)_([^._]+)/);
  if (!match) {
    throw new Error(`Invalid filename format: ${filename}. Expected format: SYMBOL_INTERVAL[.json]`);
  }
  return { symbol: match[1], interval: match[2] };
};

const validateInputs = (symbolInfo, strategyName) => {
  if (!symbolInfo && _.isObject(symbolInfo)) {
    throw new Error('Symbol information is required');
  }
  if (!strategyName) {
    throw new Error('Strategy name is required');
  }
};

const validateMarketData = (marketPath) => {
  if (!dataManager.exists(marketPath)) {
    throw new Error(`Market data not found: ${marketPath}`);
  }
};

const validateStrategy = (strategyClass, strategyName) => {
  if (!strategyClass) {
    throw new Error(`Strategy not found: ${strategyName}`);
  }
  return strategyClass;
};

const displayStrategyConfig = (strategyName, { symbol, interval }, marketPath, config) => {
  console.log(chalk.cyan("\n🤖 Strategy Execution:"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold("Strategy:   ") + chalk.green(strategyName));
  console.log(chalk.bold("Symbol:     ") + chalk.green(symbol));
  console.log(chalk.bold("Interval:   ") + chalk.green(interval));
  console.log(chalk.bold("Input:      ") + chalk.green(marketPath));

  console.log(chalk.bold("\nConfiguration:"));
  Object.entries(config).forEach(([key, value]) => {
    console.log(chalk.dim("• ") + chalk.yellow(key) + ": " + chalk.green(value));
  });
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
};

const executeStrategy = async (strategyClass, symbolInfo, marketPath, strategyName) => {
  const spinner = ora({
    text: chalk.yellow("Initializing strategy..."),
    spinner: 'dots'
  }).start();

  try {
    // Ensure data directories exist
    dataManager.ensureDirectories();

    // Transform data and add technical indicators
    const technicalData = await transformStockData(symbolInfo, strategyClass.getIndicators());
    spinner.succeed(chalk.green(`✔ Loaded ${technicalData.length} quotes from technical data`));

    const config = strategyClass.getDefaultConfig();
    displayStrategyConfig(strategyName, symbolInfo, marketPath, config);

    const strategyInstance = new strategyClass(
      symbolInfo,
      (results) => saveResults({ symbol: symbolInfo.symbol, interval: symbolInfo.interval }, strategyName, results),
      config
    );

    spinner.text = chalk.yellow("Executing strategy...");
    await strategyInstance.execute();
    spinner.succeed(chalk.green("Strategy execution completed"));
  } catch (error) {
    spinner.fail(chalk.red("Strategy execution failed: " + error.message));
    throw error;
  }
};

export const runStrategy = async (strategyName, symbolInfo) => {
  try {
    validateInputs(symbolInfo, strategyName);

    const marketPath = dataManager.getMarketDataPath(symbolInfo.label);
    validateMarketData(marketPath);

    const strategyClass = validateStrategy(findStrategy(strategies, strategyName), strategyName);
    await executeStrategy(strategyClass, symbolInfo, marketPath, strategyName);

    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  } catch (error) {
    console.error(chalk.red("\n❌ Error: ") + error.message);
    throw error;
  }
};
