import { transformTradesData } from "../trading/outcome/transformResult.js";
import fs from "fs";
import { std } from "mathjs"; // Example library for standard deviation

const resultDir = "./.output/result/";

const trimToTwoDecimal = (value) => +value.toFixed(2);

const showInfo = (data, filename) => {
  fs.writeFileSync(
    `${resultDir}${filename}summary.json`,
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  const trades = {};
  trades.totalTrades = data.length;
  trades.win = data.filter((trade) => trade.profitOrLoss > 0).length;
  trades.loss = data.filter((trade) => trade.profitOrLoss < 0).length;
  trades.accuracy = (trades.win / trades.totalTrades) * 100;
  trades.maxConsecutiveWins = data.reduce(
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
  trades.maxConsecutiveLosses = data.reduce(
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
  trades.shorts = data.filter((trade) => trade.type === "Short").length;
  trades.shortsWon = data.filter(
    (trade) => trade.type === "Short" && trade.profitOrLoss > 0
  ).length;
  trades.longs = data.filter((trade) => trade.type === "Long").length;
  trades.longsWon = data.filter(
    (trade) => trade.type === "Long" && trade.profitOrLoss > 0
  ).length;
  trades.averageTradeTime =
    data.reduce((acc, trade) => acc + trade.duration, 0) / trades.totalTrades;

  const performance = {};
  performance.totalReward = data.reduce((acc, trade) => acc + trade.reward, 0);
  performance.maxReward = Math.max(...data.map((trade) => trade.reward));
  performance.minReward = Math.min(...data.map((trade) => trade.reward));
  performance.averageWinReward =
    data
      .filter((trade) => trade.profitOrLoss > 0)
      .reduce((acc, trade) => acc + trade.reward, 0) / trades.win;
  performance.averageLossReward =
    data
      .filter((trade) => trade.profitOrLoss < 0)
      .reduce((acc, trade) => acc + trade.reward, 0) / trades.loss;
  performance.totalReward = data.reduce((acc, trade) => acc + trade.reward, 0);
  performance.averageReward = performance.totalReward / trades.totalTrades;
  performance.totalProfitOrLoss = data.reduce(
    (acc, trade) => acc + trade.profitOrLoss,
    0
  );
  performance.fee = data.reduce((acc, trade) => acc + trade.fee, 0);
  performance.profitOrLossAfterFee = data.reduce(
    (acc, trade) => acc + trade.profitOrLossAfterFee,
    0
  );
  performance.maxDrawDown = Math.min(...data.map((trade) => trade.drawDown)); // Drawdown is negative, so take absolute value
  performance.maxDrawDownDuration = Math.max(
    ...data.map((trade) => trade.drawDownDuration)
  );
  // Print the summary in a readable format
  console.log("\nTrades:");
  for (const key of Object.keys(trades)) {
    console.log(`${key}: ${trimToTwoDecimal(trades[key])}`);
  }

  console.log("\nPerformance:");
  for (const key of Object.keys(performance)) {
    console.log(`${key}: ${trimToTwoDecimal(performance[key])}`);
  }
};

const main = () => {
  if (process.argv.length < 3) throw "Please provide a filename";

  const filename = process.argv[2];
  const filepath = `${resultDir}${filename}.json`;
  if (!fs.existsSync(filepath)) throw "File not found";

  const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));

  const parsedResult = transformTradesData(
    data.tradeResults,
    data.capital,
    data.timeFrame
  );
  showInfo(parsedResult, filename);
};

main();
