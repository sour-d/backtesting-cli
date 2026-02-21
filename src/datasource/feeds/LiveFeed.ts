import type { Candle } from '../../types/index.js';
import type { IDataFeed, CandleHandler } from '../IDataFeed.js';
import type { BybitClient } from '../exchange/BybitClient.js';
import type { ILogger } from '../../logger/ILogger.js';

export interface LiveFeedConfig {
  readonly client: BybitClient;
  readonly interval: string;
  readonly category?: 'linear' | 'spot' | 'inverse';
  readonly logger: ILogger;
}

const INTERVAL_MS: Record<string, number> = {
  '1': 60_000,
  '3': 180_000,
  '5': 300_000,
  '15': 900_000,
  '30': 1_800_000,
  '60': 3_600_000,
  '120': 7_200_000,
  '240': 14_400_000,
  '360': 21_600_000,
  '720': 43_200_000,
  D: 86_400_000,
};

function pollIntervalFor(intervalKey: string): number {
  const candleMs = INTERVAL_MS[intervalKey] ?? 240 * 60_000;
  if (candleMs <= 60_000) return 10_000;
  if (candleMs <= 300_000) return 30_000;
  if (candleMs <= 3_600_000) return 60_000;
  return 120_000;
}

/**
 * Polls Bybit kline API at regular intervals, detects newly completed candles,
 * and dispatches them to the registered handler. Supports dynamic symbol
 * addition/removal for use with DeploymentManager.
 */
export class LiveFeed implements IDataFeed {
  private readonly client: BybitClient;
  private readonly interval: string;
  private readonly candleMs: number;
  private readonly category: 'linear' | 'spot' | 'inverse';
  private readonly logger: ILogger;

  private readonly symbols: Set<string> = new Set();
  private readonly lastCandleTime: Map<string, number> = new Map();

  private handler: CandleHandler | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: LiveFeedConfig) {
    this.client = config.client;
    this.interval = config.interval;
    this.candleMs = INTERVAL_MS[config.interval] ?? 240 * 60_000;
    this.category = config.category ?? 'linear';
    this.logger = config.logger;
  }

  onCandle(handler: CandleHandler): void {
    this.handler = handler;
  }

  addSymbol(symbol: string): void {
    this.symbols.add(symbol);
    this.logger.info('LiveFeed tracking symbol', { symbol });
  }

  removeSymbol(symbol: string): void {
    this.symbols.delete(symbol);
    this.lastCandleTime.delete(symbol);
    this.logger.info('LiveFeed stopped tracking symbol', { symbol });
  }

  getTrackedSymbols(): string[] {
    return [...this.symbols];
  }

  async start(): Promise<void> {
    if (!this.handler) throw new Error('No candle handler registered');
    this.running = true;

    const pollMs = pollIntervalFor(this.interval);
    this.logger.info('LiveFeed started', {
      interval: this.interval,
      pollMs: String(pollMs),
      symbols: [...this.symbols].join(','),
    });

    await this.pollAll();

    this.timer = setInterval(() => {
      void this.pollAll();
    }, pollMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('LiveFeed stopped');
  }

  private async pollAll(): Promise<void> {
    if (!this.running || !this.handler) return;

    for (const symbol of this.symbols) {
      if (!this.running) break;
      try {
        await this.pollSymbol(symbol);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('LiveFeed poll error', { symbol, error: msg });
      }
    }
  }

  private async pollSymbol(symbol: string): Promise<void> {
    const now = Date.now();

    const candles = await this.client.fetchRecentCandles({
      symbol,
      interval: this.interval,
      limit: 5,
      category: this.category,
    });

    if (candles.length === 0) return;

    const completed = candles.filter((c) => c.dateUnix + this.candleMs <= now);
    if (completed.length === 0) return;

    const latest = completed[completed.length - 1]!;
    const lastSeen = this.lastCandleTime.get(symbol);

    if (lastSeen !== undefined && latest.dateUnix <= lastSeen) return;

    const newCandles = lastSeen === undefined
      ? [latest]
      : completed.filter((c) => c.dateUnix > lastSeen);

    for (const candle of newCandles) {
      this.logger.info('New candle', {
        symbol,
        date: candle.date,
        time: candle.time,
        o: String(candle.open),
        h: String(candle.high),
        l: String(candle.low),
        c: String(candle.close),
      });
      this.handler!(symbol, candle);
    }

    this.lastCandleTime.set(symbol, latest.dateUnix);
  }
}
