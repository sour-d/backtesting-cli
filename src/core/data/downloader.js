import chalk from "chalk";
import ora from "ora";
import dataManager from "./dataManager.js";
import HistoricalKline from "./HistoricalKline.js";

const formatBytes = (bytes) => {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
};

const downloader = async (symbol, interval, start, end, filePath) => {
  const startMs = start.valueOf();
  const endMs = end.valueOf();

  const spinner = ora({
    text: chalk.yellow("Fetching data from broker..."),
    spinner: 'dots'
  }).start();

  try {
    const OHCL = await HistoricalKline(
      symbol,
      interval,
      startMs,
      endMs,
      false
    );

    spinner.text = chalk.yellow("Processing downloaded data...");

    const downloadDetails = {
      records: OHCL.length,
      startDate: start.format("YYYY-MM-DD HH:mm:ss"),
      endDate: end.format("YYYY-MM-DD HH:mm:ss"),
      timeframe: interval
    };

    spinner.succeed(chalk.green("Data fetched successfully"));
    
    console.log(chalk.cyan("\n📈 Download Summary:"));
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(`${chalk.bold("Records:")}     ${chalk.green(downloadDetails.records.toLocaleString())}`);
    console.log(`${chalk.bold("Start Date:")}  ${chalk.green(downloadDetails.startDate)}`);
    console.log(`${chalk.bold("End Date:")}    ${chalk.green(downloadDetails.endDate)}`);
    console.log(`${chalk.bold("Timeframe:")}   ${chalk.green(downloadDetails.timeframe)}`);

    let newData = OHCL;
    const fileNameWithPath = filePath || dataManager.getMarketDataPath(symbol, interval);

    // Ensure data directories exist
    dataManager.ensureDirectories();

    if (dataManager.exists(fileNameWithPath)) {
      const existingSpinner = ora("Reading existing data...").start();
      const data = dataManager.readJSON(fileNameWithPath);
      const existingRecords = data.length;
      newData = [...data, ...OHCL];
      existingSpinner.succeed(chalk.green(`Merged with ${existingRecords.toLocaleString()} existing records`));
    }

    const saveSpinner = ora("Saving data to file...").start();
    const jsonData = JSON.stringify(newData);
    dataManager.writeJSON(fileNameWithPath, newData);
    const fileSize = formatBytes(Buffer.byteLength(jsonData, 'utf8'));
    saveSpinner.succeed(chalk.green(`Data saved successfully (${fileSize})`));
    
    console.log(chalk.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  } catch (error) {
    spinner.fail(chalk.red("Download failed"));
    throw error;
  }
};

export default downloader;
