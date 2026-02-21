import { Command } from 'commander';
import dotenv from 'dotenv';
import { resolveStrategy } from '../strategy/index.js';
import { Market } from '../market/Market.js';
import { Bot } from '../trading-bot/Bot.js';
import { SimulatedBroker } from '../broker/SimulatedBroker.js';
import { FileStore } from '../store/FileStore.js';
import { aggregateTrades, computeStats } from '../store/analytics.js';
import { HistoricalFeed } from '../datasource/feeds/HistoricalFeed.js';
import { ConsoleLogger, LogLevel } from '../logger/ConsoleLogger.js';
import type { AppConfig } from '../types/index.js';

dotenv.config();

const program = new Command();
program.name('quantlab').description('Modular backtesting and trading engine').version('0.2.0');

program
  .command('run')
  .description('Run a backtest')
  .requiredOption('-s, --strategy <name>', 'Strategy name')
  .option('-S, --symbols <symbols>', 'Comma-separated symbol list', 'SOLUSDT')
  .option('-c, --capital <amount>', 'Starting capital', '100000')
  .option('-r, --risk <percent>', 'Risk percentage per trade', '5')
  .option('-a, --allocation <fraction>', 'Max allocation fraction per trade', '0.8')
  .option('-f, --fee <rate>', 'Fee rate', '0.001')
  .option('--start <unix>', 'Start timestamp (unix ms)')
  .option('--end <unix>', 'End timestamp (unix ms)')
  .option('--interval <interval>', 'Candle interval', '240')
  .option('--log-level <level>', 'Log level: DEBUG, INFO, WARN, ERROR', 'INFO')
  .action(async (opts) => {
    const symbols = (opts.symbols as string).split(',').map((s: string) => s.trim());
    const logLevel = LogLevel[opts.logLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
    const logger = new ConsoleLogger({ component: 'CLI' }, logLevel);

    const config: AppConfig = {
      mode: 'backtest',
      start: opts.start ? Number(opts.start) : 0,
      end: opts.end ? Number(opts.end) : Date.now(),
      interval: opts.interval as string,
      instruments: symbols,
      strategy: opts.strategy as string,
      capital: Number(opts.capital),
      riskPercentage: Number(opts.risk),
      maxAllocation: Number(opts.allocation),
      feeRate: Number(opts.fee),
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

program
  .command('download')
  .description('Download historical market data')
  .requiredOption('-S, --symbols <symbols>', 'Comma-separated symbol list')
  .requiredOption('--start <unix>', 'Start timestamp (unix ms)')
  .requiredOption('--end <unix>', 'End timestamp (unix ms)')
  .option('--interval <interval>', 'Candle interval', '240')
  .action(async (opts) => {
    const logger = new ConsoleLogger({ component: 'Downloader' });
    logger.info('Download command is a placeholder — implement with exchange client');
    logger.info('Usage: Provide exchange client integration in src/datasource/exchange/');
  });

program.parse();
