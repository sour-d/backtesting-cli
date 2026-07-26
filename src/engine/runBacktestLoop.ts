import { randomUUID } from 'node:crypto';
import { loadQuantlabConfig, parseConfigTimeRange } from '../config/loadConfig.js';
import type { LogLevelName } from '../logger/ILogger.js';
import {
  backtestTradesDir,
  countBacktestTradeRecords,
  prepareBacktestRun,
} from './backtestSummary.js';
import { createBacktestEngine } from './createBacktestEngine.js';
import { EventBus } from './events/EventBus.js';
import { wireEngineEvents } from './wireEngineEvents.js';

export interface RunBacktestLoopOptions {
  readonly configPath: string;
  readonly dataDir: string;
  readonly warmupCandles: number;
  readonly logLevel: LogLevelName;
  /** Suppress console logs; full engine log still written under `backtest/logs/`. */
  readonly quiet?: boolean;
}

/**
 * Loads quantlab config, deploys each symbol, replays file market data, then stops broker.
 */
export async function runBacktestLoop(opts: RunBacktestLoopOptions): Promise<void> {
  await prepareBacktestRun(opts.dataDir);

  const ql = await loadQuantlabConfig(opts.configPath);
  const bounds = parseConfigTimeRange(ql);

  const { bot, broker, marketRuntime, logger } = createBacktestEngine({
    dataDir: opts.dataDir,
    category: ql.category,
    klineInterval: ql.interval,
    warmupCandles: opts.warmupCandles,
    rangeStartMs: bounds.rangeStartMs,
    rangeEndMs: bounds.rangeEndMs,
    feeRate: ql.feeRate,
    logLevel: opts.logLevel,
    quiet: opts.quiet,
  });

  const bus = new EventBus(logger);
  wireEngineEvents({
    bus,
    bot,
    reconciliationService: bot.reconciliationService,
    broker,
    reconcileIntervalMs: 0,
    logger,
  });
  marketRuntime.onCandle((instrument) => {
    void bus.publish({ type: 'CandleClosed', instrument });
  });

  for (const symbol of ql.symbols) {
    await bot.deploy({
      id: randomUUID(),
      symbol,
      strategyId: ql.strategy,
      capital: ql.capital,
      klineInterval: ql.interval,
    });
  }

  broker.start();
  await marketRuntime.start();
  await marketRuntime.writeEnrichedTechnicalDumps();
  broker.stop();
  await marketRuntime.stop();

  const tradeRecords = await countBacktestTradeRecords(opts.dataDir);
  const tradesDir = backtestTradesDir(opts.dataDir);
  const summary = { tradeRecords, tradesDir };
  logger.info('Backtest run complete', summary);
  if (tradeRecords === 0) {
    logger.info(
      'No trades were written — the strategy only logs "Signal executed" when it emits BUY/SELL/CLOSE. Common causes: entry rules never matched this data; or position size rounded to zero (capital vs minQty/minNotional); or use --warmup 200 so indicators are warm from bar one.',
    );
  }
  if (opts.quiet) {
    console.log(
      `Backtest run complete tradeRecords=${tradeRecords} tradesDir=${tradesDir}`,
    );
    if (tradeRecords === 0) {
      console.log(
        'No trades were written (see strategy rules, capital vs minQty/minNotional, or try --warmup 200).',
      );
    }
  }
}
