#!/usr/bin/env node

import { Command } from "commander";
import download from "../core/data/download.js";
import chalk from "chalk";
import CryptoMarket from "../core/market/CryptoMarket.js";
import instrumentsInfo from "../config/symbols.js";
import Bot from "../core/strategy/Bot.js";
import MovingAverageStrategy from "../core/strategy/MovingAverageStrategy.js";
import BTCTrendStrategy from "../core/strategy/BTCTrendStrategy.js";
import BTCTrendShortOnlyStrategy from "../core/strategy/BTCTrendShortOnlyStrategy.js";
import HybridRegimeStrategy from "../core/strategy/HybridRegimeStrategy.js";
import { saveResults } from "../core/results/results.js";

const program = new Command();

// Strategy registry -- add new strategies here
const strategies = {
  MovingAverage: MovingAverageStrategy,
  BTCTrend: BTCTrendStrategy,
  BTCTrendShortOnly: BTCTrendShortOnlyStrategy,
  HybridRegime: HybridRegimeStrategy,
};

program
  .name("backtesting")
  .description("CLI for backtesting trading strategies")
  .version("0.1.0");

program
  .command("download")
  .description("Download historical data")
  .action(async () => {
    await download();
  });

program
  .command("run")
  .description("Run a trading strategy backtest")
  .option("-s, --strategy <name>", "Strategy name", "MovingAverage")
  .option("-a, --all-instruments", "Use all available instruments from exchange", false)
  .action(async (options) => {
    try {
      const startTime = Date.now();
      console.log(chalk.blue("\n=== Backtesting Pipeline ===\n"));

      // --- Step 1: Resolve instruments ---
      console.log(chalk.yellow("Step 1: Resolving instruments..."));

      const StrategyClass = strategies[options.strategy];
      if (!StrategyClass) {
        console.error(chalk.red(`Unknown strategy: ${options.strategy}`));
        console.log(`Available strategies: ${Object.keys(strategies).join(", ")}`);
        return;
      }

      let instrumentSymbols;
      if (options.allInstruments) {
        console.log("  Mode: All instruments from exchange");
        instrumentSymbols = null; // signals "all" to market
      } else {
        if (!instrumentsInfo?.instruments || instrumentsInfo.instruments.length === 0) {
          console.error(chalk.red("No instruments in config. Use -a to fetch all."));
          return;
        }
        instrumentSymbols = instrumentsInfo.instruments;
        console.log(`  Mode: Config instruments (${instrumentSymbols.join(", ")})`);
      }

      console.log(`  Timeline: ${new Date(instrumentsInfo.start).toISOString().split("T")[0]} to ${new Date(instrumentsInfo.end).toISOString().split("T")[0]}`);
      console.log(`  Interval: ${instrumentsInfo.interval}`);
      console.log(`  Strategy: ${options.strategy}`);

      // --- Step 2: Verify & download data ---
      console.log(chalk.yellow("\nStep 2: Verifying & loading data..."));

      const market = new CryptoMarket();
      market.setInterval(instrumentsInfo.interval);

      if (instrumentSymbols) {
        const instrumentObjects = instrumentSymbols.map((symbol) => ({ symbol }));
        await market.initializeWithSpecificInstruments(instrumentObjects);
      } else {
        await market.initializeWithAllInstruments();
      }

      const instrumentCount = market.getInstrumentCount();
      if (instrumentCount === 0) {
        console.error(chalk.red("No instruments loaded. Check data availability."));
        return;
      }
      console.log(chalk.green(`  ${instrumentCount} instruments loaded`));

      // --- Step 3: Compute indicators ---
      console.log(chalk.yellow("\nStep 3: Computing indicators..."));

      const bot = new Bot(market, StrategyClass);
      await bot.initialize();

      // --- Step 4: Run strategy day-by-day ---
      console.log(chalk.yellow("\nStep 4: Running strategy..."));

      const completedDays = await bot.runSimulation();

      // --- Step 5: Results & insights ---
      console.log(chalk.yellow("\nStep 5: Analyzing results...\n"));

      const results = bot.getResults();

      let stats = null;
      if (results.tradeResults.length === 0) {
        console.log(chalk.dim("  No trades were generated during the simulation."));
        console.log(chalk.dim("  This may be normal if the strategy conditions were not met."));
      } else {
        stats = await saveResults(market, results);
      }

      // Summary
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const { metadata } = results;
      const fmt = (n) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

      console.log(chalk.blue("\n=== Summary ==="));
      console.log(`  Days simulated: ${completedDays}`);
      console.log(`  Instruments:    ${instrumentCount}`);
      console.log(`  Completed trades: ${results.tradeResults.length}`);
      console.log(`  Open positions: ${metadata.totalOpenPositions}`);
      console.log(`  Time:           ${elapsed}s`);

      console.log(chalk.blue("\n  Capital:"));
      console.log(`    Initial:          ${fmt(metadata.initialCapital)}`);
      console.log(`    Available cash:   ${fmt(metadata.capital)}`);
      if (metadata.totalLocked > 0) {
        console.log(`    In open positions: ${fmt(metadata.totalLocked)}`);
      }
      const equity = metadata.totalEquity;
      const netPnL = equity - metadata.initialCapital;
      const netColor = netPnL >= 0 ? chalk.green : chalk.red;
      console.log(`    Total equity:     ${fmt(equity)} (${netColor((netPnL >= 0 ? "+" : "") + fmt(netPnL))})`);

      // Key performance metrics
      if (stats) {
        const { tradeStats: ts, performanceStats: ps } = stats;

        console.log(chalk.blue("\n  Performance:"));
        const winColor = ts.accuracy >= 50 ? chalk.green : chalk.yellow;
        console.log(`    Win rate:           ${winColor(ts.accuracy + "%")} (${ts.win}W / ${ts.loss}L)`);
        console.log(`    Max consec. wins:   ${chalk.green(ts.maxConsecutiveWins)}`);
        console.log(`    Max consec. losses: ${chalk.red(ts.maxConsecutiveLosses)}`);
        console.log(`    Avg trade length:   ${ts.averageTradeCandle} candles`);

        console.log(chalk.blue("\n  Directions:"));
        const longWinPct = ts.longs > 0 ? ((ts.longsWon / ts.longs) * 100).toFixed(1) : "0.0";
        const shortWinPct = ts.shorts > 0 ? ((ts.shortsWon / ts.shorts) * 100).toFixed(1) : "0.0";
        console.log(`    Longs:  ${String(ts.longs).padStart(4)} trades, ${chalk.green(ts.longsWon + "W")} (${longWinPct}%)`);
        console.log(`    Shorts: ${String(ts.shorts).padStart(4)} trades, ${chalk.green(ts.shortsWon + "W")} (${shortWinPct}%)`);

        console.log(chalk.blue("\n  Risk & Reward:"));
        console.log(`    Total P&L:          ${netColor(fmt(ps.totalProfitOrLoss))}`);
        console.log(`    P&L after fees:     ${netColor(fmt(ps.profitOrLossAfterFee))}`);
        console.log(`    Total fees:         ${chalk.red(fmt(ps.fee))}`);
        console.log(`    Max drawdown:       ${chalk.red(fmt(Math.abs(ps.maxDrawDown)))}`);
        console.log(`    Drawdown duration:  ${chalk.red(ps.maxDrawDownDuration + " trades")}`);
        console.log(`    Avg reward (R):     ${ps.averageReward >= 0 ? chalk.green(ps.averageReward) : chalk.red(ps.averageReward)}`);
        console.log(`    Avg win R:          ${chalk.green(ps.averageWinReward)}`);
        console.log(`    Avg loss R:         ${chalk.red(ps.averageLossReward)}`);
        console.log(`    Best trade R:       ${chalk.green(ps.maxReward)}`);
        console.log(`    Worst trade R:      ${chalk.red(ps.minReward)}`);
      }

      // Per-instrument breakdown
      if (metadata.capitalPerInstrument) {
        const perInstrument = metadata.capitalPerInstrument;
        const initialPer = metadata.initialCapital / Object.keys(perInstrument).length;
        console.log(chalk.blue("\n  Per Instrument:"));
        for (const [symbol, cash] of Object.entries(perInstrument)) {
          const open = metadata.openPositions?.[symbol];
          const locked = open ? open.locked : 0;
          const instrEquity = cash + locked;
          const pnl = instrEquity - initialPer;
          const pnlPct = ((pnl / initialPer) * 100).toFixed(2);
          const pnlStr = pnl >= 0
            ? chalk.green(`+${fmt(pnl)}, +${pnlPct}%`)
            : chalk.red(`${fmt(pnl)}, ${pnlPct}%`);
          let line = `    ${symbol.padEnd(15)} equity: ${fmt(instrEquity).padStart(12)}  (${pnlStr})`;
          if (open) {
            line += chalk.dim(`  [${open.type} open]`);
          }
          console.log(line);
        }
      }
      console.log("");
    } catch (error) {
      console.error(chalk.red("\nError:"), error);
    }
  });

program.parse();
