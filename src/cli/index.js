#!/usr/bin/env node

import { Command } from "commander";
import downlaod from "../core/data/download.js";
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
  .action(async () => {
    await downlaod()
  });

program
  .command("run")
  .description("Run a trading strategy")
  .argument("<strategy>", "Strategy name")
  .action(async (strategy) => {
    try {
      await runStrategy(strategy);
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
