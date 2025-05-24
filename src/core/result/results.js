import chalk from "chalk";
import ora from "ora";
import dataManager from "../data/dataManager.js";
import { transformTradesData } from "./transformResult.js";

const formatNumber = (amount) => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

const trimToTwoDecimal = (value) => +value.toFixed(2);

const calculateTradeStats = (tradeResults) => {
  if (!tradeResults || tradeResults.length === 0) {
    return {
      totalTrades: 0,
      win: 0,
      loss: 0,
      accuracy: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      shorts: 0,
      shortsWon: 0,
      longs: 0,
      longsWon: 0,
      averageTradeCandle: 0
    };
  }

  const trades = {
    totalTrades: tradeResults.length,
    win: tradeResults.filter((trade) => trade.profitOrLoss > 0).length,
    loss: tradeResults.filter((trade) => trade.profitOrLoss < 0).length
  };

  trades.accuracy = trades.totalTrades > 0 ? 
    trimToTwoDecimal((trades.win / trades.totalTrades) * 100) : 0;

  // Calculate max consecutive wins/losses
  let currentWins = 0;
  let currentLosses = 0;
  trades.maxConsecutiveWins = 0;
  trades.maxConsecutiveLosses = 0;

  tradeResults.forEach(trade => {
    if (trade.profitOrLoss > 0) {
      currentWins++;
      currentLosses = 0;
      trades.maxConsecutiveWins = Math.max(trades.maxConsecutiveWins, currentWins);
    } else {
      currentLosses++;
      currentWins = 0;
      trades.maxConsecutiveLosses = Math.max(trades.maxConsecutiveLosses, currentLosses);
    }
  });

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
  const totalDuration = tradeResults.reduce((acc, trade) => acc + (trade.duration || 0), 0);
  trades.averageTradeCandle = trades.totalTrades > 0 ? 
    trimToTwoDecimal(totalDuration / trades.totalTrades) : 0;

  return trades;
};

const calculatePerformanceStats = (tradeResults) => {
  if (!tradeResults || tradeResults.length === 0) {
    return {
      totalReward: 0,
      maxReward: 0,
      minReward: 0,
      averageWinReward: 0,
      averageLossReward: 0,
      averageReward: 0,
      totalProfitOrLoss: 0,
      fee: 0,
      profitOrLossAfterFee: 0,
      maxDrawDown: 0,
      maxDrawDownDuration: 0
    };
  }

  const winningTrades = tradeResults.filter((trade) => trade.profitOrLoss > 0);
  const losingTrades = tradeResults.filter((trade) => trade.profitOrLoss < 0);

  const performance = {
    totalReward: trimToTwoDecimal(
      tradeResults.reduce((acc, trade) => acc + (trade.reward || 0), 0)
    ),
    maxReward: trimToTwoDecimal(
      Math.max(...tradeResults.map((trade) => trade.reward || 0))
    ),
    minReward: trimToTwoDecimal(
      Math.min(...tradeResults.map((trade) => trade.reward || 0))
    )
  };

  performance.averageWinReward = winningTrades.length > 0 ?
    trimToTwoDecimal(
      winningTrades.reduce((acc, trade) => acc + (trade.reward || 0), 0) / winningTrades.length
    ) : 0;

  performance.averageLossReward = losingTrades.length > 0 ?
    trimToTwoDecimal(
      losingTrades.reduce((acc, trade) => acc + (trade.reward || 0), 0) / losingTrades.length
    ) : 0;

  performance.averageReward = tradeResults.length > 0 ?
    trimToTwoDecimal(performance.totalReward / tradeResults.length) : 0;

  performance.totalProfitOrLoss = trimToTwoDecimal(
    tradeResults.reduce((acc, trade) => acc + (trade.profitOrLoss || 0), 0)
  );

  performance.fee = trimToTwoDecimal(
    tradeResults.reduce((acc, trade) => acc + (trade.fee || 0), 0)
  );

  performance.profitOrLossAfterFee = trimToTwoDecimal(
    tradeResults.reduce((acc, trade) => acc + (trade.profitOrLossAfterFee || 0), 0)
  );

  performance.maxDrawDown = trimToTwoDecimal(
    Math.min(...tradeResults.map((trade) => trade.drawDown || 0))
  );

  performance.maxDrawDownDuration = Math.max(
    ...tradeResults.map((trade) => trade.drawDownDuration || 0)
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
  console.log(chalk.bold("Total Reward:      ") + chalk.yellow(formatNumber(stats.totalReward)));
  console.log(chalk.bold("Max Reward:        ") + chalk.green(formatNumber(stats.maxReward)));
  console.log(chalk.bold("Min Reward:        ") + chalk.red(formatNumber(stats.minReward)));
  console.log(chalk.bold("Avg Win Reward:    ") + chalk.green(formatNumber(stats.averageWinReward)));
  console.log(chalk.bold("Avg Loss Reward:   ") + chalk.red(formatNumber(stats.averageLossReward)));
  console.log(chalk.bold("Avg Reward:        ") + chalk.yellow(formatNumber(stats.averageReward)));
  
  console.log(chalk.bold("\nP&L:"));
  const pnlColor = stats.totalProfitOrLoss >= 0 ? chalk.green : chalk.red;
  console.log(chalk.bold("Total P&L:         ") + pnlColor(formatNumber(stats.totalProfitOrLoss)));
  console.log(chalk.bold("Fees:              ") + chalk.red(formatNumber(stats.fee)));
  console.log(chalk.bold("P&L After Fees:    ") + pnlColor(formatNumber(stats.profitOrLossAfterFee)));
  
  console.log(chalk.bold("\nRisk:"));
  console.log(chalk.bold("Max Drawdown:      ") + chalk.red(formatNumber(Math.abs(stats.maxDrawDown))));
  console.log(chalk.bold("Drawdown Duration: ") + chalk.yellow(stats.maxDrawDownDuration + " candles"));
  console.log(chalk.bold("Avg Trade Length:  ") + chalk.yellow(stats.averageTradeCandle + " candles"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
};

const saveResults = async ({label, interval}, results) => {
  const spinner = ora("Processing results...").start();
  
  try {
    dataManager.ensureDirectories();

    // Save raw results
    const resultPath = dataManager.getResultsPath(label);
    dataManager.writeJSON(resultPath, results);
    spinner.succeed(chalk.green(`Raw results saved to ${resultPath}`));

    // Transform and save transformed data
    spinner.start("Transforming trade data...");
    const transformedTrades = transformTradesData(
      results.tradeResults,
      results.metadata.capital,
      interval
    );

    const transformedPath = dataManager.getTransformedResultsPath(label);
    dataManager.writeJSON(transformedPath, transformedTrades);
    spinner.succeed(chalk.green(`Transformed data saved to ${transformedPath}`));

    // Calculate and display stats
    spinner.start("Calculating statistics...");
    const tradeStats = calculateTradeStats(transformedTrades);
    const performanceStats = calculatePerformanceStats(transformedTrades);
    spinner.succeed(chalk.green("Statistics calculated"));

    // Save stats
    const statsPath = dataManager.getResultsStatsPath(label);
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
