import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { resolveStrategy } from '../strategy/index.js';
import { Market } from '../market/Market.js';
import { Bot } from '../trading-bot/Bot.js';
import { createBroker } from '../broker/createBroker.js';
import { createStore } from '../store/createStore.js';
import { createLogger } from '../logger/createLogger.js';
import { createDataFeed } from '../datasource/createDataFeed.js';
import { aggregateTrades, computeStats, computeStatsBySymbol } from '../store/analytics.js';
import { BybitClient } from '../datasource/exchange/BybitClient.js';
import { LiveFeed } from '../datasource/feeds/LiveFeed.js';
import { DeploymentManager } from '../deployment/DeploymentManager.js';
import { createServer, startKeepAlivePing } from '../api/server.js';
import { loadConfig, parseDate } from '../config/loadConfig.js';
import type { RunMode } from '../core/types.js';
import type { AppConfig } from '../types/index.js';
import type { DeployRequest } from '../types/deployment.js';
import { ConsoleLogger, LogLevel } from '../logger/ConsoleLogger.js';
import { FileStore } from '../store/FileStore.js';

dotenv.config();

const program = new Command();
program.name('quantlab').description('Modular backtesting and trading engine').version('0.2.0');

// ---- Backtest (run) ----

program
  .command('run')
  .description('Run backtest on historical data (file store, simulated broker, minimal logs)')
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
    const mode: RunMode = 'backtest';
    const cfg = await loadConfig();

    const symbols = opts.symbols
      ? (opts.symbols as string).split(',').map((s: string) => s.trim())
      : cfg.symbols;
    const strategyName = (opts.strategy as string | undefined) ?? cfg.strategy;

    if (!symbols || symbols.length === 0) {
      console.error('No symbols specified. Use -S flag or set "symbols" in quantlab.config.js');
      process.exit(1);
    }
    if (!strategyName) {
      console.error('No strategy specified. Use -s flag or set "strategy" in quantlab.config.js');
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

    const store = createStore(mode, { baseDir: '.data' });
    const { root: logger, botLogger } = createLogger(mode, {
      logLevel: opts.logLevel as keyof typeof LogLevel,
    });
    const broker = createBroker(mode, {
      feeRate: config.feeRate,
      riskPercentage: config.riskPercentage,
      maxAllocation: config.maxAllocation,
    });

    logger.info('Starting backtest', { strategy: config.strategy, symbols: symbols.join(',') });

    const strategy = resolveStrategy(config.strategy);
    const market = new Market(strategy.getIndicators());
    broker.allocateCapital([...config.instruments], config.capital);

    const strategyMap = new Map(config.instruments.map((s) => [s, strategy]));
    const bot = new Bot({ market, broker, store, logger: botLogger, strategyMap });

    const feed = createDataFeed({
      mode: 'backtest',
      symbols: config.instruments,
      store,
      interval: config.interval,
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
    const statsBySymbol = computeStatsBySymbol(aggregated);

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

    console.log('\n--- Per symbol ---');
    for (const [symbol, s] of Object.entries(statsBySymbol)) {
      console.log(
        `  ${symbol}: trades=${s.totalTrades} winRate=${s.winRate}% netPnL=${s.netPnL} maxDD=${s.maxDrawdown}`,
      );
    }
    console.log('\n--- Total ---');
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Win Rate: ${stats.winRate}%`);
    console.log(`Net P&L: ${stats.netPnL}`);
    console.log(`Max Drawdown: ${stats.maxDrawdown}`);
    console.log(`Consecutive Wins: ${stats.maxConsecutiveWins} | Losses: ${stats.maxConsecutiveLosses}`);
    console.log(`Longs: ${stats.longs} (won ${stats.longsWon}) | Shorts: ${stats.shorts} (won ${stats.shortsWon})`);
    console.log(`Results saved to .data/transformedResult/t_result.json`);
    console.log(`Stats saved to .data/resultsStats/stats_result.json`);
  });

// ---- Paper (simulated) and Live (real exchange) ----

interface EngineOpts {
  port: string;
  interval?: string;
  logLevel?: string;
  autoDeploy?: boolean;
}

async function runEngine(mode: 'paper' | 'live', opts: EngineOpts): Promise<void> {
    const cfg = await loadConfig();
    const port = Number(process.env.PORT || opts.port);
    const interval = (opts.interval as string | undefined) ?? cfg.interval ?? '240';
    const category = (cfg.category as 'linear' | 'spot' | 'inverse') ?? 'linear';

    const store = createStore(mode, {
      baseDir: '.data',
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY,
      cleanLiveData: opts.autoDeploy === true,
    });

    const sessionId = randomUUID();
    const { root: logger, botLogger } = createLogger(mode, {
      logLevel: opts.logLevel as keyof typeof LogLevel,
      component: 'Engine',
      store: mode === 'live' ? store : undefined,
      sessionId: mode === 'live' ? sessionId : undefined,
    });

    logger.info('Starting live engine', {
      mode: mode === 'live' ? 'exchange' : 'paper',
      port: String(port),
      interval,
    });

    const bybitClient = new BybitClient({
      apiKey: process.env.BYBIT_API_KEY,
      apiSecret: process.env.BYBIT_API_SECRET,
      logger: logger.child({ component: 'BybitClient' }),
    });

    const feed = createDataFeed({
      mode,
      client: bybitClient,
      interval,
      category,
      logger: logger.child({ component: 'LiveFeed' }),
    }) as LiveFeed;

    if (mode === 'live' && (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET)) {
      logger.error('BYBIT_API_KEY and BYBIT_API_SECRET are required for live exchange (--exchange)');
      process.exit(1);
    }
    const broker = createBroker(mode, {
      feeRate: cfg.feeRate ?? 0.001,
      riskPercentage: cfg.riskPercentage ?? 5,
      maxAllocation: cfg.maxAllocation ?? 0.8,
      category,
      apiKey: process.env.BYBIT_API_KEY,
      apiSecret: process.env.BYBIT_API_SECRET,
      testnet: process.env.BYBIT_TESTNET === 'true',
      demoTrading: process.env.DEMO_TRADING === 'true',
      logger: logger.child({ component: mode === 'live' ? 'BybitBroker' : 'Broker' }),
      sessionId: mode === 'live' ? sessionId : undefined,
      store: mode === 'live' ? store : undefined,
    });

    const defaultStrategy = resolveStrategy(cfg.strategy ?? 'MovingAverage_v2');
    const market = new Market(defaultStrategy.getIndicators());
    const bot = new Bot({
      market,
      broker,
      store,
      logger: botLogger,
      sessionId: mode === 'live' ? sessionId : undefined,
    });

    feed.onCandle(async (symbol, candle) => {
      try {
        await bot.onCandle(symbol, candle);
        const enriched = market.getStock(symbol).now();
        void store.saveCandles(symbol, interval, [enriched]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Live candle handler error (server continues)', { symbol, message });
        // Bot already catches and persists runtime_error; this is a safety net so server never crashes
      }
    });

    const dm = new DeploymentManager({
      bot,
      broker,
      market,
      store,
      logger: logger.child({ component: 'DeploymentManager' }),
      liveFeed: feed,
      sessionId: mode === 'live' ? sessionId : undefined,
    });

    const restored = await dm.restoreFromStore();
    if (restored > 0) logger.info('Restored deployments from store', { count: String(restored) });

    if (opts.autoDeploy && restored === 0) {
      const symbols = cfg.symbols ?? [];
      if (symbols.length > 0 && cfg.strategy) {
        const request: DeployRequest = {
          symbols,
          strategy: cfg.strategy,
          capital: cfg.capital ?? 100000,
          riskPercentage: cfg.riskPercentage ?? 5,
          maxAllocation: cfg.maxAllocation ?? 0.8,
          feeRate: cfg.feeRate ?? 0.001,
        };
        const deployments = await dm.deploy(request);
        logger.info('Auto-deployed from config', {
          strategy: request.strategy,
          symbols: symbols.join(','),
          count: String(deployments.length),
        });
      } else {
        logger.warn('--auto-deploy set but quantlab.config.js has no symbols or strategy');
      }
    }

    await feed.start();
    const server = await createServer(dm, store, logger.child({ component: 'API' }), { port });

    const stopKeepAlive =
      process.env.LIVE_URL ?
        startKeepAlivePing(process.env.LIVE_URL, logger.child({ component: 'KeepAlive' }))
      : () => {};
    if (process.env.LIVE_URL) {
      logger.info('Keep-alive ping started', { url: process.env.LIVE_URL, interval: '1m' });
    }

    const shutdown = () => {
      logger.info('Shutting down...');
      stopKeepAlive();
      feed.stop();
      server.close(() => {
        const l = logger as { flush?: () => Promise<void>; dispose?: () => void };
        void (l.flush?.() ?? Promise.resolve()).then(() => {
          l.dispose?.();
          process.exit(0);
        });
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('Engine ready.');
    logger.info(`  POST http://localhost:${port}/api/deployments`);
    logger.info(`  GET  http://localhost:${port}/api/strategies`);
    logger.info(`  GET  http://localhost:${port}/api/deployments`);
}

program
  .command('paper')
  .description('Start engine in paper trading mode (stream + simulated broker)')
  .option('--port <port>', 'API server port', '3000')
  .option('--interval <interval>', 'Candle interval')
  .option('--log-level <level>', 'Log level: DEBUG, INFO, WARN, ERROR', 'INFO')
  .option('--auto-deploy', 'Auto-deploy strategy from quantlab.config.js on startup')
  .action((opts) => runEngine('paper', opts as EngineOpts));

program
  .command('live')
  .description('Start engine with real Bybit exchange')
  .option('--port <port>', 'API server port', '3000')
  .option('--interval <interval>', 'Candle interval')
  .option('--log-level <level>', 'Log level: DEBUG, INFO, WARN, ERROR', 'INFO')
  .option('--auto-deploy', 'Auto-deploy strategy from quantlab.config.js on startup')
  .action((opts) => runEngine('live', opts as EngineOpts));

// ---- Download ----

program
  .command('download')
  .description('Download historical market data from Bybit to .data/market/')
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
      logger.error('No symbols specified. Use -S flag or set "symbols" in quantlab.config.js');
      process.exit(1);
    }
    if (start === undefined || end === undefined) {
      logger.error('Start and end dates are required. Use --start/--end or set in quantlab.config.js');
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
        start: new Date(start!).toISOString(),
        end: new Date(end!).toISOString(),
      });
      try {
        const candles = await client.fetchKlines({ symbol, interval, start: start!, end: end!, category });
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
