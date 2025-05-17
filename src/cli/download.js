import dayjs from "dayjs";
import downloader from "../core/data/downloader.js";
import fs from "fs";
import _ from "lodash";
import chalk from "chalk";
import ora from "ora";
import dataManager from "../core/data/dataManager.js";

const getDateFormat = (date = dayjs().utc()) => {
  return dayjs(date);
};

const todaysDate = () => dayjs().utc().format("YYYY-MM-DD");

const downloadDefaultData = async () => {
  const symbol = process.env.DEFAULT_SYMBOL;
  const interval = process.env.DEFAULT_INTERVAL;
  const startDateString = process.env.DEFAULT_START_DATE + "T00:00:00.000Z";
  const endDateString = process.env.DEFAULT_END_DATE + "T23:59:59.999Z";
  
  console.log(chalk.cyan("\n📊 Download Configuration:"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(`${chalk.bold("Symbol:")}    ${chalk.green(symbol)}`);
  console.log(`${chalk.bold("Interval:")}  ${chalk.green(interval)}`);
  console.log(`${chalk.bold("Start:")}     ${chalk.green(startDateString)}`);
  console.log(`${chalk.bold("End:")}       ${chalk.green(endDateString)}`);
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  const start = getDateFormat(startDateString);
  const end = getDateFormat(endDateString);
  const filePath = dataManager.getMarketDataPath(symbol, interval);

  if (dataManager.exists(filePath)) {
    const spinner = ora("Cleaning existing data...").start();
    fs.unlinkSync(filePath);
    spinner.succeed("Existing data cleaned");
  }

  const spinner = ora("Downloading historical data...").start();
  try {
    await downloader(symbol, interval, start, end, filePath);
    spinner.succeed(chalk.green("✨ Download completed successfully"));
  } catch (error) {
    spinner.fail(chalk.red(`❌ Download failed: ${error.message}`));
    throw error;
  }
};

const downloadFromLastDownloaded = async () => {
  const symbol = "BTCUSDT";
  const interval = "1";
  console.log(chalk.cyan("\n📈 Continuing Download:"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(`${chalk.bold("Symbol:")}    ${chalk.green(symbol)}`);
  console.log(`${chalk.bold("Interval:")}  ${chalk.green(interval)}`);

  let start = getDateFormat(todaysDate());
  const end = getDateFormat();
  const filePath = dataManager.getMarketDataPath(symbol, interval);

  if (dataManager.exists(filePath)) {
    const data = dataManager.readJSON(filePath);
    if (_.last(data)?.DateUnix) {
      start = getDateFormat(dayjs.utc(_.last(data).DateUnix).add(1, "minute"));
      console.log(`${chalk.bold("Last Date:")} ${chalk.yellow(start.format("YYYY-MM-DD HH:mm:ss"))}`);
    }
  }
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  const spinner = ora("Downloading latest data...").start();
  try {
    await downloader(symbol, interval, start, end, filePath);
    spinner.succeed(chalk.green("✨ Download completed successfully"));
  } catch (error) {
    spinner.fail(chalk.red(`❌ Download failed: ${error.message}`));
    throw error;
  }
};

const downloadFromStartEnd = async (symbol, interval, startDate, endDate, filename) => {
  console.log(chalk.cyan("\n📊 Custom Download:"));
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(`${chalk.bold("Symbol:")}    ${chalk.green(symbol)}`);
  console.log(`${chalk.bold("Interval:")}  ${chalk.green(interval)}`);
  console.log(`${chalk.bold("Start:")}     ${chalk.green(startDate)}`);
  console.log(`${chalk.bold("End:")}       ${chalk.green(endDate || startDate)}`);
  if (filename) {
    console.log(`${chalk.bold("Output:")}    ${chalk.green(filename)}`);
  }
  console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  const start = getDateFormat(startDate + "T00:00:00.000Z");
  const end = getDateFormat((endDate || startDate) + "T23:59:59.999Z");
  const outputFilename = filename || dataManager.getMarketDataPath(symbol, interval);

  const spinner = ora("Downloading historical data...").start();
  try {
    await downloader(symbol, interval, start, end, outputFilename);
    spinner.succeed(chalk.green("✨ Download completed successfully"));
  } catch (error) {
    spinner.fail(chalk.red(`❌ Download failed: ${error.message}`));
    throw error;
  }
};

export { downloadDefaultData, downloadFromLastDownloaded, downloadFromStartEnd };
