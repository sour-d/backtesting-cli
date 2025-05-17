import _ from "lodash";
import getIndicator from "../indicators/index.js";
import { im } from "mathjs";
import chalk from "chalk";
import ora from "ora";
import dataManager from "../data/dataManager.js";

const removeNulls = (quotes) => {
  return quotes.filter((quote) =>
    Object.entries(quote).every(([_, value]) => value !== "null")
  );
};

const trimToTwoDecimal = (value) => +value.toFixed(2);

const writeTechnicalData = (symbol, interval, technicalData) => {
  const spinner = ora("Writing technical indicators data...").start();
  
  try {
    dataManager.ensureDirectories();
    const path = dataManager.getTechnicalDataPath(symbol, interval);
    dataManager.writeJSON(path, technicalData);
    spinner.succeed(chalk.green("Technical data saved successfully"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to write technical data"));
    throw error;
  }
};

const addTechnicalIndicator = (quotes, startFrom = 0) => {
  const spinner = ora({
    text: chalk.yellow("Adding technical indicators..."),
    spinner: 'dots'
  }).start();

  try {
    const technicalQuotes = quotes.slice(0, startFrom);
    const total = quotes.length;
    let processed = startFrom;
    
    for (let i = startFrom; i < quotes.length; i++) {
      if (i % 1000 === 0) {
        const progress = ((i / total) * 100).toFixed(1);
        spinner.text = chalk.yellow(`Processing indicators... ${progress}% (${i}/${total})`);
      }
      
      const quote = quotes[i];
      const indicator = getIndicator(quote, technicalQuotes);
      technicalQuotes.push(indicator);
      processed++;
    }

    spinner.succeed(chalk.green(`Processed ${processed.toLocaleString()} quotes with technical indicators`));
    return technicalQuotes;
  } catch (error) {
    spinner.fail(chalk.red("Failed to add technical indicators"));
    throw error;
  }
};

const transformStockData = (symbol, interval) => {
  console.log(chalk.cyan("\n📊 Processing Stock Data:"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));

  const marketPath = dataManager.getMarketDataPath(symbol, interval);
  const parseSpinner = ora("Loading market data...").start();
  let stockData;
  try {
    stockData = dataManager.readJSON(marketPath);
    parseSpinner.succeed(chalk.green(`Loaded ${stockData.length.toLocaleString()} quotes`));
  } catch (error) {
    parseSpinner.fail(chalk.red("Failed to load market data"));
    throw error;
  }

  const cleanSpinner = ora("Cleaning data...").start();
  const processedData = removeNulls(stockData);
  cleanSpinner.succeed(chalk.green(`Cleaned ${(stockData.length - processedData.length).toLocaleString()} invalid records`));

  const formatSpinner = ora("Formatting decimal values...").start();
  processedData.forEach((quote) => {
    quote.Close = trimToTwoDecimal(quote.close);
    quote.Open = trimToTwoDecimal(quote.open);
    quote.Low = trimToTwoDecimal(quote.low);
    quote.High = trimToTwoDecimal(quote.high);
  });
  formatSpinner.succeed(chalk.green("Decimal formatting completed"));

  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  const technicalQuotes = addTechnicalIndicator(processedData);
  writeTechnicalData(symbol, interval, technicalQuotes);

  return technicalQuotes;
};

const getStockData = (symbol, interval) => {
  const spinner = ora("Loading stock data...").start();
  try {
    const technicalPath = dataManager.getTechnicalDataPath(symbol, interval);
    if (dataManager.exists(technicalPath)) {
      const data = dataManager.readJSON(technicalPath);
      console.log("-----", data.length, technicalPath, symbol, interval);
      spinner.succeed(chalk.green(`Loaded ${data.length.toLocaleString()} quotes from technical data`));
      return data;
    }

    const marketPath = dataManager.getMarketDataPath(symbol, interval);
    if (dataManager.exists(marketPath)) {
      spinner.text = chalk.yellow("Technical data not found, processing raw data...");
      const data = transformStockData(symbol, interval);
      spinner.succeed(chalk.green(`Processed ${data.length.toLocaleString()} quotes from raw data`));
      return data;
    }

    spinner.fail(chalk.red("Stock data not found"));
    throw new Error("Stock data not found for " + symbol + "_" + interval);
  } catch (error) {
    spinner.fail(chalk.red(`Failed to load stock data: ${error.message}`));
    throw error;
  }
};

export { transformStockData, addTechnicalIndicator, getStockData };
