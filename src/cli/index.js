#!/usr/bin/env node
import { Command } from 'commander';
import {
  downloadDefaultData,
  downloadFromLastDownloaded,
  downloadFromStartEnd,
} from './download.js';
import { runStrategy } from './runStrategy.js';

const program = new Command();

program
  .name('backtesting-cli')
  .description('CLI tool for backtesting trading strategies')
  .version('0.1.0');

// Define the download command
program
  .command('download')
  .description('Download historical stock data')
  .option('--default', 'Download default data based on environment variables')
  .option('--continue', 'Continue downloading from the last downloaded point for BTCUSDT 1m')
  .option('-s, --symbol <symbol>', 'Symbol (e.g., BTCUSDT)')
  .option('-i, --interval <interval>', 'Interval (e.g., 1m, 1h, 1d)')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('-f, --filename <path>', 'Optional output filename')
  .action(async (options) => {
    try {
      if (options.default) {
        if (
          !process.env.DEFAULT_SYMBOL ||
          !process.env.DEFAULT_INTERVAL ||
          !process.env.DEFAULT_START_DATE ||
          !process.env.DEFAULT_END_DATE
        ) {
          throw new Error(
            'DEFAULT_SYMBOL, DEFAULT_INTERVAL, DEFAULT_START_DATE, and DEFAULT_END_DATE environment variables are required for --default download.'
          );
        }
        console.log('Starting default download...');
        await downloadDefaultData();
        console.log('Default download finished.');
      } else if (options.continue) {
        console.log('Starting continued download for BTCUSDT 1m...');
        await downloadFromLastDownloaded();
        console.log('Continued download finished.');
      } else if (options.symbol && options.interval && options.start) {
        // Validate interval format
        const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
        if (!validIntervals.includes(options.interval)) {
          throw new Error(`Invalid interval. Must be one of: ${validIntervals.join(', ')}`);
        }

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(options.start)) {
          throw new Error('Start date must be in YYYY-MM-DD format');
        }
        if (options.end && !dateRegex.test(options.end)) {
          throw new Error('End date must be in YYYY-MM-DD format');
        }

        console.log(`Starting download for ${options.symbol}...`);
        await downloadFromStartEnd(
          options.symbol,
          options.interval,
          options.start,
          options.end,
          options.filename
        );
        console.log('Specific download finished.');
      } else {
        console.error(
          'Please specify a download mode: --default, --continue, or provide --symbol, --interval, and --start.'
        );
        program.commands.find(cmd => cmd.name() === 'download').outputHelp();
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Define the run command
program
  .command('run')
  .description('Run a trading strategy on historical data')
  .argument('<filename>', 'Input data file to run strategy on')
  .argument('<strategy>', 'Name of the strategy to run')
  .action(async (filename, strategyName) => {
    try {
      await runStrategy(filename, strategyName);
    } catch (error) {
      console.error('Error running strategy:', error.message);
      throw error;
      process.exit(1);
    }
  });

program.parse(process.argv);

// If no command is specified, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
