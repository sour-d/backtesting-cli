import { Command } from 'commander';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolveStrategy } from '../strategy/index.js';
import { Market } from '../market/Market.js';
import { Bot } from '../trading-bot/Bot.js';
import { SimulatedBroker } from '../broker/SimulatedBroker.js';
import { FileStore } from '../store/FileStore.js';
import { SupabaseStore } from '../store/SupabaseStore.js';
import { aggregateTrades, computeStats } from '../store/analytics.js';
import { HistoricalFeed } from '../datasource/feeds/HistoricalFeed.js';
import { BybitClient } from '../datasource/exchange/BybitClient.js';
import { ConsoleLogger, LogLevel } from '../logger/ConsoleLogger.js';
import { PersistentLogger } from '../logger/PersistentLogger.js';
import { DeploymentManager } from '../deployment/DeploymentManager.js';
import { createServer } from '../api/server.js';
import { loadConfig, parseDate } from '../config/loadConfig.js';
import type { AppConfig } from '../types/index.js';
import type { IStore } from '../store/IStore.js';

dotenv.config();

const program = new Command();
program.name('quantlab').description('Modular backtesting and trading engine').version('0.2.0');

// ---- Backtest command ----

program
  .command('run')
  .description('Run a backtest')
  .option('-s, --strategy <name>', 'Strategy name')
  .option('-S, --symbols <symbols>', 'Comma-separated symbol list')
  .option('-c, --capital <amount>', 'Starting capital')
  .option('-r, --risk <percent>', 'Risk percentage per trade')
  .option('-a, --allocation <fraction>', 'Max allocation fraction per trade')
  .option('-f, --fee <rate>', 'Fee rate')
  .option('--start <date>', 'Start date (e.g. "2024-01-01" or unix ms)')
  .option('--end <date>', 'End date (e.g. "2025-12-31" or unix ms)')
  .option('--interval <interval>', 'Candle interval')
  .option('--log-level <level>', 'Log level: DEBUG, INFO, WARN, ERROR', 'INFO')
  .action(async (opts) => {
    const cfg = await loadConfig();
    const logLevel = LogLevel[opts.logLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
    const logger = new ConsoleLogger({ component: 'CLI' }, logLevel);

    const symbols = opts.symbols
      ? (opts.symbols as string).split(',').map((s: string) => s.trim())
      : cfg.symbols;
    const strategyName = (opts.strategy as string | undefined) ?? cfg.strategy;

    if (!symbols || symbols.length === 0) {
      logger.error('No symbols specified. Use -S flag or set "symbols" in quantlab.config.json');
      process.exit(1);
    }
    if (!strategyName) {
      logger.error('No strategy specified. Use -s flag or set "strategy" in quantlab.config.json');
      process.exit(1);
    }

    const config: AppConfig = {
      mode: 'backtest',
      start: parseDate(opts.start as string) ?? parseDate(cfg.start) ?? 0,
      end: parseDate(opts.end as string) ?? parseDate(cfg.end) ?? Date.now(),
      interval: (opts.interval as string | undefined) ?? cfg.interval ?? '240',
      instruments: symbols,
      strategy: strategyName,
      capital: Number(opts.capital ?? cfg.capital ?? 100000),
      riskPercentage: Number(opts.risk ?? cfg.riskPercentage ?? 5),
      maxAllocation: Number(opts.allocation ?? cfg.maxAllocation ?? 0.8),
      feeRate: Number(opts.fee ?? cfg.feeRate ?? 0.001),
    };

    logger.info('Starting backtest', { strategy: config.strategy, symbols: symbols.join(',') });

    const strategy = resolveStrategy(config.strategy);
    const market = new Market(strategy.getIndicators());
    const store = new FileStore('.data');

    const broker = new SimulatedBroker({
      feeRate: config.feeRate,
      riskPercentage: config.riskPercentage,
      maxAllocation: config.maxAllocation,
    });
    broker.allocateCapital([...config.instruments], config.capital);

    const strategyMap = new Map(config.instruments.map((s) => [s, strategy]));
    const botLogger = logger.child({ component: 'Bot' });

    const bot = new Bot({ market, broker, store, logger: botLogger, strategyMap });

    const feed = new HistoricalFeed({
      symbols: config.instruments,
      loadCandles: (symbol) => {
        const label = `${symbol}_${config.interval}`;
        return store.loadMarketData(label);
      },
    });

    feed.onCandle((symbol, candle) => bot.onCandle(symbol, candle));

    const startTime = Date.now();
    await feed.start();
    const elapsed = Date.now() - startTime;

    const trades = store.getTrades();
    const aggregated = aggregateTrades(trades, {
      feeRate: config.feeRate,
      capital: config.capital,
      intervalMinutes: Number(config.interval) || 240,
    });

    const stats = computeStats(aggregated);

    await store.saveResults(aggregated);
    await store.saveStats(stats);

    logger.info('Backtest complete', {
      candles: bot.processedCandles,
      trades: stats.totalTrades,
      winRate: stats.winRate,
      netPnL: stats.netPnL,
      maxDrawdown: stats.maxDrawdown,
      elapsed: `${elapsed}ms`,
    });

    console.log('\n--- Performance Summary ---');
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Win Rate: ${stats.winRate}%`);
    console.log(`Net P&L: ${stats.netPnL}`);
    console.log(`Max Drawdown: ${stats.maxDrawdown}`);
    console.log(`Consecutive Wins: ${stats.maxConsecutiveWins} | Losses: ${stats.maxConsecutiveLosses}`);
    console.log(`Longs: ${stats.longs} (won ${stats.longsWon}) | Shorts: ${stats.shorts} (won ${stats.shortsWon})`);
    console.log(`Results saved to .data/transformedResult/t_result.json`);
    console.log(`Stats saved to .data/resultsStats/stats_result.json`);
  });

// ---- Live / Paper trading command ----

program
  .command('live')
  .description('Start the live trading engine with API server')
  .option('--port <port>', 'API server port', '3000')
  .option('--interval <interval>', 'Candle interval', '240')
  .option('--log-level <level>', 'Log level: DEBUG, INFO, WARN, ERROR', 'INFO')
  .action(async (opts) => {
    const logLevel = LogLevel[opts.logLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
    const consoleLogger = new ConsoleLogger({ component: 'Engine' }, logLevel);
    const port = Number(process.env.PORT || opts.port);

    consoleLogger.info('Starting live trading engine', { port: String(port) });

    const market = new Market([]);

    let store: IStore;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (supabaseUrl && supabaseKey) {
      const client = createClient(supabaseUrl, supabaseKey);
      store = new SupabaseStore(client);
      consoleLogger.info('Using Supabase for persistence');
    } else {
      store = new FileStore('.data');
      consoleLogger.info('Using FileStore for persistence (set SUPABASE_URL and SUPABASE_KEY for DB)');
    }

    const logger = new PersistentLogger({
      inner: consoleLogger,
      store,
      context: { component: 'Engine' },
    });

    const broker = new SimulatedBroker({
      feeRate: 0.001,
      riskPercentage: 5,
      maxAllocation: 0.8,
    });

    const bot = new Bot({
      market,
      broker,
      store,
      logger: logger.child({ component: 'Bot' }),
    });

    const dm = new DeploymentManager({
      bot,
      broker,
      market,
      store,
      logger: logger.child({ component: 'DeploymentManager' }),
    });

    const restored = await dm.restoreFromStore();
    if (restored > 0) {
      logger.info('Restored deployments from store', { count: String(restored) });
    }

    const server = await createServer(dm, store, logger.child({ component: 'API' }), { port });

    const shutdown = () => {
      logger.info('Shutting down...');
      server.close(() => {
        void logger.flush().then(() => {
          logger.dispose();
          process.exit(0);
        });
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('Engine ready. Use the API to create deployments.');
    logger.info(`  POST http://localhost:${port}/api/deployments`);
    logger.info(`  GET  http://localhost:${port}/api/strategies`);
    logger.info(`  GET  http://localhost:${port}/api/deployments`);
  });

// ---- Download command ----

program
  .command('download')
  .description('Download historical market data from Bybit')
  .option('-S, --symbols <symbols>', 'Comma-separated symbol list')
  .option('--start <date>', 'Start date (e.g. "2024-01-01" or unix ms)')
  .option('--end <date>', 'End date (e.g. "2025-12-31" or unix ms)')
  .option('--interval <interval>', 'Candle interval')
  .option('--category <category>', 'Bybit market category: linear, spot, inverse')
  .option('--log-level <level>', 'Log level: DEBUG, INFO, WARN, ERROR', 'INFO')
  .action(async (opts) => {
    const cfg = await loadConfig();
    const logLevel = LogLevel[opts.logLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
    const logger = new ConsoleLogger({ component: 'Downloader' }, logLevel);

    const symbols = opts.symbols
      ? (opts.symbols as string).split(',').map((s: string) => s.trim())
      : cfg.symbols;
    const start = parseDate(opts.start as string) ?? parseDate(cfg.start);
    const end = parseDate(opts.end as string) ?? parseDate(cfg.end);
    const interval = (opts.interval as string | undefined) ?? cfg.interval ?? '240';
    const category = (opts.category as 'linear' | 'spot' | 'inverse' | undefined) ?? cfg.category ?? 'linear';

    if (!symbols || symbols.length === 0) {
      logger.error('No symbols specified. Use -S flag or set "symbols" in quantlab.config.json');
      process.exit(1);
    }
    if (start === undefined || end === undefined) {
      logger.error('Start and end dates are required. Use --start/--end flags or set in quantlab.config.json');
      process.exit(1);
    }

    const client = new BybitClient({
      apiKey: process.env.BYBIT_API_KEY,
      apiSecret: process.env.BYBIT_API_SECRET,
      logger: logger.child({ component: 'BybitClient' }),
    });
    const store = new FileStore('.data');

    for (const symbol of symbols) {
      logger.info(`Downloading ${symbol} ${interval}min candles`, {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      });

      try {
        const candles = await client.fetchKlines({ symbol, interval, start, end, category });
        const label = `${symbol}_${interval}`;
        await store.saveMarketData(label, candles);
        logger.info(`Saved ${candles.length} candles to .data/market/${label}.json`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to download ${symbol}: ${message}`);
      }
    }

    logger.info('Download complete');
  });

program.parse();
