import chalk from "chalk";
import ora from "ora";
import dataManager from "./dataManager.js";
import { transformTradesData } from "./transformResult.js";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(amount);
};

const trimToTwoDecimal = (value) => +value.toFixed(2);

const calculateTradeStats = (tradeResults) => {
  const trades = {
    totalTrades: tradeResults.length,
    win: tradeResults.filter((trade) => trade.profitOrLoss > 0).length,
    loss: tradeResults.filter((trade) => trade.profitOrLoss < 0).length
  };

  trades.accuracy = trimToTwoDecimal((trades.win / trades.totalTrades) * 100);

  // Calculate max consecutive wins/losses
  trades.maxConsecutiveWins = tradeResults.reduce(
    (acc, trade) => {
      if (trade.profitOrLoss > 0) {
        acc.current++;
        acc.max = Math.max(acc.current, acc.max);
      } else {
        acc.current = 0;
      }
      return acc;
    },
    { current: 0, max: 0 }
  ).max;

  trades.maxConsecutiveLosses = tradeResults.reduce(
    (acc, trade) => {
      if (trade.profitOrLoss < 0) {
        acc.current++;
        acc.max = Math.max(acc.current, acc.max);
      } else {
        acc.current = 0;
      }
      return acc;
    },
    { current: 0, max: 0 }
  ).max;

  // Trade type statistics
  trades.shorts = tradeResults.filter((trade) => trade.type === "Short").length;
  trades.shortsWon = tradeResults.filter(
    (trade) => trade.type === "Short" && trade.profitOrLoss > 0
  ).length;
  trades.longs = tradeResults.filter((trade) => trade.type === "Long").length;
  trades.longsWon = tradeResults.filter(
    (trade) => trade.type === "Long" && trade.profitOrLoss > 0
  ).length;

  // Average trade duration
  trades.averageTradeCandle = trimToTwoDecimal(
    tradeResults.reduce((acc, trade) => acc + trade.duration, 0) / trades.totalTrades
  );

  return trades;
};

const calculatePerformanceStats = (tradeResults) => {
  const winningTrades = tradeResults.filter((trade) => trade.profitOrLoss > 0);
  const losingTrades = tradeResults.filter((trade) => trade.profitOrLoss < 0);

  const performance = {
    totalReward: trimToTwoDecimal(
      tradeResults.reduce((acc, trade) => acc + trade.reward, 0)
    ),
    maxReward: trimToTwoDecimal(
      Math.max(...tradeResults.map((trade) => trade.reward))
    ),
    minReward: trimToTwoDecimal(
      Math.min(...tradeResults.map((trade) => trade.reward))
    )
  };

  performance.averageWinReward = trimToTwoDecimal(
    winningTrades.reduce((acc, trade) => acc + trade.reward, 0) / winningTrades.length
  );

  performance.averageLossReward = trimToTwoDecimal(
    losingTrades.reduce((acc, trade) => acc + trade.reward, 0) / losingTrades.length
  );

  performance.averageReward = trimToTwoDecimal(
    performance.totalReward / tradeResults.length
  );

  performance.totalProfitOrLoss = trimToTwoDecimal(
    tradeResults.reduce((acc, trade) => acc + trade.profitOrLoss, 0)
  );

  performance.fee = trimToTwoDecimal(
    tradeResults.reduce((acc, trade) => acc + trade.fee, 0)
  );

  performance.profitOrLossAfterFee = trimToTwoDecimal(
    tradeResults.reduce((acc, trade) => acc + trade.profitOrLossAfterFee, 0)
  );

  performance.maxDrawDown = trimToTwoDecimal(
    Math.min(...tradeResults.map((trade) => trade.drawDown))
  );

  performance.maxDrawDownDuration = Math.max(
    ...tradeResults.map((trade) => trade.drawDownDuration)
  );

  return performance;
};

const displayStats = (stats) => {
  console.log(chalk.cyan("\n📊 Trading Statistics:"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold("Total Trades:      ") + chalk.green(stats.totalTrades));
  console.log(chalk.bold("Winning Trades:    ") + chalk.green(stats.win));
  console.log(chalk.bold("Losing Trades:     ") + chalk.red(stats.loss));
  console.log(chalk.bold("Win Rate:          ") + chalk.yellow(stats.accuracy + "%"));
  console.log(chalk.bold("Max Consec. Wins:  ") + chalk.green(stats.maxConsecutiveWins));
  console.log(chalk.bold("Max Consec. Losses:") + chalk.red(stats.maxConsecutiveLosses));
  
  console.log(chalk.bold("\nTrade Types:"));
  console.log(chalk.bold("Short Trades:      ") + chalk.blue(stats.shorts));
  console.log(chalk.bold("Short Wins:        ") + chalk.green(stats.shortsWon));
  console.log(chalk.bold("Long Trades:       ") + chalk.blue(stats.longs));
  console.log(chalk.bold("Long Wins:         ") + chalk.green(stats.longsWon));
  
  console.log(chalk.bold("\nRewards:"));
  console.log(chalk.bold("Total Reward:      ") + chalk.yellow(stats.totalReward));
  console.log(chalk.bold("Max Reward:        ") + chalk.green(stats.maxReward));
  console.log(chalk.bold("Min Reward:        ") + chalk.red(stats.minReward));
  console.log(chalk.bold("Avg Win Reward:    ") + chalk.green(stats.averageWinReward));
  console.log(chalk.bold("Avg Loss Reward:   ") + chalk.red(stats.averageLossReward));
  console.log(chalk.bold("Avg Reward:        ") + chalk.yellow(stats.averageReward));
  
  console.log(chalk.bold("\nP&L:"));
  const pnlColor = stats.totalProfitOrLoss >= 0 ? chalk.green : chalk.red;
  console.log(chalk.bold("Total P&L:         ") + pnlColor(formatCurrency(stats.totalProfitOrLoss)));
  console.log(chalk.bold("Fees:              ") + chalk.red(formatCurrency(stats.fee)));
  console.log(chalk.bold("P&L After Fees:    ") + pnlColor(formatCurrency(stats.profitOrLossAfterFee)));
  
  console.log(chalk.bold("\nRisk:"));
  console.log(chalk.bold("Max Drawdown:      ") + chalk.red(formatCurrency(Math.abs(stats.maxDrawDown))));
  console.log(chalk.bold("Drawdown Duration: ") + chalk.yellow(stats.maxDrawDownDuration + " candles"));
  console.log(chalk.bold("Avg Trade Length:  ") + chalk.yellow(stats.averageTradeCandle + " candles"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
};

const saveResults = async (symbol, interval, strategy, results) => {
  const spinner = ora("Processing results...").start();
  
  try {
    dataManager.ensureDirectories();

    // Save raw results
    const resultPath = dataManager.getResultsPath(symbol, interval, strategy);
    dataManager.writeJSON(resultPath, results);
    spinner.succeed(chalk.green(`Raw results saved to ${resultPath}`));

    // Transform and save transformed data
    spinner.start("Transforming trade data...");
    const transformedTrades = transformTradesData(
      results.tradeResults,
      results.metadata.capital,
      interval
    );

    const transformedPath = dataManager.getResultsPath(symbol, interval, strategy, "_transformed");
    dataManager.writeJSON(transformedPath, transformedTrades);
    spinner.succeed(chalk.green(`Transformed data saved to ${transformedPath}`));

    // Calculate and display stats
    spinner.start("Calculating statistics...");
    const tradeStats = calculateTradeStats(transformedTrades);
    const performanceStats = calculatePerformanceStats(transformedTrades);
    spinner.succeed(chalk.green("Statistics calculated"));

    // Save stats
    const statsPath = dataManager.getResultsPath(symbol, interval, strategy, "_stats");
    dataManager.writeJSON(statsPath, { trade: tradeStats, performance: performanceStats });
    spinner.succeed(chalk.green(`Statistics saved to ${statsPath}`));

    displayStats({ ...tradeStats, ...performanceStats });
    return { tradeStats, performanceStats };
  } catch (error) {
    spinner.fail(chalk.red(`Failed to process results: ${error.message}`));
    throw error;
  }
};

export { saveResults };
