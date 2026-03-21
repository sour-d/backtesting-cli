import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadQuantlabConfig, parseConfigTimeRange } from '../config/loadConfig.js';
import type { LogLevelName } from '../logger/ILogger.js';
import { countBacktestTradeRecords } from './backtestSummary.js';
import { createBacktestEngine } from './createBacktestEngine.js';

export interface RunBacktestLoopOptions {
  readonly configPath: string;
  readonly dataDir: string;
  readonly warmupCandles: number;
  readonly logLevel: LogLevelName;
}

/**
 * Loads quantlab config, deploys each symbol, replays file market data, then stops broker.
 */
export async function runBacktestLoop(opts: RunBacktestLoopOptions): Promise<void> {
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
    mav2RiskPercentage: ql.riskPercentage,
    mav2MaxAllocation: ql.maxAllocation,
  });

  marketRuntime.onCandle((instrument, candle) => {
    void bot.onCandle(instrument, candle);
  });

  for (const symbol of ql.symbols) {
    await bot.deploy({
      id: randomUUID(),
      symbol,
      strategyId: ql.strategy,
      capital: ql.capital,
    });
  }

  broker.start();
  await marketRuntime.start();
  broker.stop();
  await marketRuntime.stop();

  const tradeRecords = await countBacktestTradeRecords(opts.dataDir);
  const tradesDir = join(opts.dataDir, 'trades');
  logger.info('Backtest run complete', {
    tradeRecords,
    tradesDir,
  });
  if (tradeRecords === 0) {
    logger.info(
      'No trades were written — the strategy only logs "Signal executed" when it emits BUY/SELL/CLOSE. Common causes: entry rules never matched this data; or position size rounded to zero (capital vs minQty/minNotional); or use --warmup 200 so indicators are warm from bar one.',
    );
  }
}
