import chalk from "chalk";
import dataManager from "./dataManager.js";
import HistoricalKline from "./HistoricalKline.js";

const downloader = async (symbolinfo) => {
  const { symbol, interval, start, end } = symbolinfo;
  const startMs = start.valueOf();
  const endMs = end.valueOf();

  console.log(`${symbolinfo.label} data download started...`);
  try {
    const OHCL = await HistoricalKline(
      symbol,
      interval,
      startMs,
      endMs,
      false
    );

    console.log(`${symbolinfo.label} data downloaded successfully. Total data points: ${OHCL.length}`);
    dataManager.saveMarketData(symbolinfo, OHCL);
    console.log(chalk.green(`Data for ${symbolinfo.label} saved successfully.`));
  } catch (error) {
    console.error("Error downloading data:", error);
    throw error;
  }
};

export default downloader;
