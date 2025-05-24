#!/usr/bin/env node

import { Command } from "commander";
import downlaod from "../core/data/download.js";
import { runStrategy } from "./runStrategy.js";
import chalk from "chalk";
import symbols from "../config/symbols.js";

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
  .option("-i <index_val>", "Index of the symbol to run the strategy on")
  .option("-a, --all", "Run the strategy on all symbols")
  .action(async (strategy, options) => {
    try {
      let symbolObj;

      console.log("Options received:", options);
      if (options.i) {
        const index = parseInt(options.i, 10);
        console.log(index)
        if (isNaN(index) || index < 0 || index >= symbols.length) {
          throw new Error("Invalid index value provided");
        }
        symbolObj = symbols[index];
      } else if (options.all) {
        for (const symbol of symbols) {
          await runStrategy(strategy, symbol);
        }
        return;
      } else {
        throw new Error("Either -i <index_val> or -a/--all must be specified");
      }

      await runStrategy(strategy, symbolObj);
    } catch (error) {
      console.error(chalk.red("\nError:"), error.message);
      process.exit(1);
    }
  });

program.parse();
