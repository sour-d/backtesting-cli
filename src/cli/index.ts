#!/usr/bin/env node
/** Load `.env` before any app modules — they read `process.env` at import time. */
import 'dotenv/config';
import { Command } from 'commander';
import type { LogLevelName } from '../logger/ILogger.js';
import type { LogTarget } from '../logger/createLogger.js';
import { runBacktestLoop } from '../engine/runBacktestLoop.js';
import { runLiveLoop } from '../engine/runLiveLoop.js';
import { runDownloadMarket } from './downloadMarket.js';

const program = new Command();
program.name('quantlab').description('Modular trading engine').version('0.3.0');

program
  .command('live')
  .description('Run live engine (Bybit) with REST API')
  .option('-p, --port <port>', 'HTTP port', process.env.PORT ?? '3000')
  .option('--data-dir <dir>', 'Data directory', '.data')
  .option('--interval <m>', 'Kline interval (e.g. 240)', process.env.KLINE_INTERVAL ?? '240')
  .option('--warmup <n>', 'Warmup candle count', '300')
  .option('--category <c>', 'linear | inverse | spot', process.env.BYBIT_CATEGORY ?? 'linear')
  .option('--log-level <level>', 'debug | info | warn | error', 'info')
  .option('--testnet', 'Use Bybit testnet', process.env.BYBIT_TESTNET === 'true')
  .option('--demo-trading', 'Demo trading (Bybit)', process.env.BYBIT_DEMO === 'true')
  .action(async (opts) => {
    const apiKey = process.env.BYBIT_API_KEY;
    const apiSecret = process.env.BYBIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.error('BYBIT_API_KEY and BYBIT_API_SECRET are required for live mode');
      process.exit(1);
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.error('SUPABASE_URL and SUPABASE_KEY are required for live mode (persistence is database-only)');
      process.exit(1);
    }

    const category = opts.category as 'linear' | 'inverse' | 'spot';
    if (category !== 'linear' && category !== 'inverse' && category !== 'spot') {
      console.error('Invalid --category');
      process.exit(1);
    }

    const logLevel = String(opts.logLevel) as LogLevelName;
    const logTargets: LogTarget[] = ['console', 'db'];

    const { shutdown } = await runLiveLoop({
      port: Number(opts.port),
      dataDir: String(opts.dataDir),
      category,
      klineInterval: String(opts.interval),
      warmupCandles: Number(opts.warmup),
      testnet: Boolean(opts.testnet),
      demoTrading: Boolean(opts.demoTrading),
      apiKey,
      apiSecret,
      supabaseUrl,
      supabaseKey,
      logLevel,
      logTargets,
    });

    const stop = (): void => {
      void shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });

program
  .command('download-market')
  .description('Download OHLCV from Bybit into .data/market/{symbol}_{interval}.json (quantlab.config.js)')
  .option('-c, --config <path>', 'Path to quantlab.config.js', 'quantlab.config.js')
  .option('--data-dir <dir>', 'Data directory', '.data')
  .option('--testnet', 'Use Bybit testnet REST', false)
  .action(async (opts) => {
    try {
      await runDownloadMarket({
        configPath: String(opts.config),
        dataDir: String(opts.dataDir),
        testnet: Boolean(opts.testnet),
      });
      process.exit(0);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program
  .command('backtest')
  .description('Run backtest using quantlab.config.js and .data/market file candles')
  .option('-c, --config <path>', 'Path to quantlab.config.js', 'quantlab.config.js')
  .option('--data-dir <dir>', 'Data directory', '.data')
    .option(
      '--warmup <n>',
      'Warmup bars (indicator-only at start of range if file has no prior history; peeled from replay)',
      '0',
    )
  .option('--log-level <level>', 'debug | info | warn | error', 'info')
  .action(async (opts) => {
    const logLevel = String(opts.logLevel) as LogLevelName;
    try {
      await runBacktestLoop({
        configPath: String(opts.config),
        dataDir: String(opts.dataDir),
        warmupCandles: Number(opts.warmup),
        logLevel,
      });
      process.exit(0);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
