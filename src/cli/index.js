#!/usr/bin/env node

import { Command } from "commander";
import { downloadDefaultData, downloadFromLastDownloaded, downloadFromStartEnd } from "./download.js";
import { runStrategy } from "./runStrategy.js";
import { trainStrategy } from "./train.js";
import chalk from "chalk";

const program = new Command();

program
  .name("backtesting")
  .description("CLI for backtesting trading strategies")
  .version("0.1.0");

program
  .command("download")
  .description("Download historical data")
  .option("-s, --symbol <symbol>", "Trading symbol (e.g., BTCUSDT)")
  .option("-i, --interval <interval>", "Time interval (e.g., 1m, 1h, 1d)")
  .option("--start <date>", "Start date (YYYY-MM-DD)")
  .option("--end <date>", "End date (YYYY-MM-DD)")
  .option("-f, --filename <filename>", "Output filename")
  .option("--default", "Download default data from .env config")
  .option("--continue", "Continue from last downloaded data")
  .action(async (options) => {
    try {
      if (options.default) {
        await downloadDefaultData();
      } else if (options.continue) {
        await downloadFromLastDownloaded();
      } else if (options.symbol && options.interval && options.start) {
        await downloadFromStartEnd(
          options.symbol,
          options.interval,
          options.start,
          options.end,
          options.filename
        );
      } else {
        console.error(
          chalk.red("Please provide required options or use --default/--continue")
        );
      }
    } catch (error) {
      console.error(chalk.red("\nError:"), error.message);
      process.exit(1);
    }
  });

program
  .command("run")
  .description("Run a trading strategy")
  .argument("<filename>", "Input data file")
  .argument("<strategy>", "Strategy name")
  .action(async (filename, strategy) => {
    try {
      await runStrategy(filename, strategy);
    } catch (error) {
      console.error(chalk.red("\nError:"), error.message);
      process.exit(1);
    }
  });

program
  .command("train")
  .description("Train the RL strategy")
  .argument("<filename>", "Input data file")
  .option("-e, --epochs <number>", "Number of training epochs", "10")
  .option("-b, --batch-size <number>", "Training batch size", "32")
  .option("-v, --validation-split <number>", "Validation split ratio", "0.2")
  .action(async (filename, options) => {
    try {
      await trainStrategy(filename, {
        epochs: parseInt(options.epochs),
        batchSize: parseInt(options.batchSize),
        validationSplit: parseFloat(options.validationSplit)
      });
    } catch (error) {
      console.error(chalk.red("\nError:"), error.message);
      process.exit(1);
    }
  });

program.parse();
