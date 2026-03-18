import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { WebsocketClient } from 'bybit-api';
import type { Candle } from '../../types/index.js';
import type { IDataFeed, CandleHandler } from '../IDataFeed.js';
import type { ILogger } from '../../logger/ILogger.js';
import { safeErrorMessage } from '../../utils/safeErrorMessage.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

export interface LiveFeedConfig {
  readonly interval: string;
  readonly category?: 'linear' | 'spot' | 'inverse';
  readonly testnet?: boolean;
  readonly logger: ILogger;
}

/**
 * Subscribes to Bybit kline WebSocket (public, no API keys).
 * Only emits confirmed (closed) candles. Supports dynamic symbol add/remove.
 */
export class LiveFeed implements IDataFeed {
  private readonly interval: string;
  private readonly category: 'linear' | 'spot' | 'inverse';
  private readonly logger: ILogger;
  private readonly wsClient: InstanceType<typeof WebsocketClient>;

  private readonly symbols: Set<string> = new Set();
  private handler: CandleHandler | null = null;
  private running = false;

  constructor(config: LiveFeedConfig) {
    this.interval = config.interval;
    this.category = config.category ?? 'linear';
    this.logger = config.logger;

    this.wsClient = new WebsocketClient({
      market: 'v5',
      testnet: config.testnet ?? false,
    });

    this.wsClient.on('update', (msg) => {
      if (!this.running || !this.handler) return;
      try {
        this.handleUpdate(msg);
      } catch (err) {
        this.logger.error('LiveFeed WS update error', { error: safeErrorMessage(err) });
      }
    });

    this.wsClient.on('open', (data) => {
      this.logger.info('WebSocket connected', { wsKey: data?.wsKey });
    });

    this.wsClient.on('reconnect', (data) => {
      this.logger.info('WebSocket reconnecting', { wsKey: data?.wsKey });
    });

    this.wsClient.on('reconnected', (data) => {
      this.logger.info('WebSocket reconnected', { wsKey: data?.wsKey });
    });

    this.wsClient.on('close', () => {
      this.logger.warn('WebSocket closed');
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.wsClient as any).on('error', (err: unknown) => {
      this.logger.error('WebSocket error', { error: safeErrorMessage(err) });
    });
  }

  onCandle(handler: CandleHandler): void {
    this.handler = handler;
  }

  addSymbol(symbol: string): void {
    this.symbols.add(symbol);
    this.logger.info('LiveFeed tracking symbol', { symbol });
    if (this.running) {
      this.subscribe(symbol);
    }
  }

  removeSymbol(symbol: string): void {
    this.symbols.delete(symbol);
    this.logger.info('LiveFeed stopped tracking symbol', { symbol });
    if (this.running) {
      this.unsubscribe(symbol);
    }
  }

  getTrackedSymbols(): string[] {
    return [...this.symbols];
  }

  async start(): Promise<void> {
    if (!this.handler) throw new Error('No candle handler registered');
    this.running = true;

    for (const symbol of this.symbols) {
      this.subscribe(symbol);
    }

    this.logger.info('LiveFeed started', {
      interval: this.interval,
      mode: 'websocket',
      symbols: [...this.symbols].join(','),
    });
  }

  stop(): void {
    this.running = false;
    for (const symbol of this.symbols) {
      this.unsubscribe(symbol);
    }
    try {
      this.wsClient.closeAll();
    } catch {
      // ignore close errors on shutdown
    }
    this.logger.info('LiveFeed stopped');
  }

  private subscribe(symbol: string): void {
    const topic = `kline.${this.interval}.${symbol.toUpperCase()}`;
    this.wsClient.subscribeV5(topic, this.category);
    this.logger.debug('WS subscribed', { topic });
  }

  private unsubscribe(symbol: string): void {
    const topic = `kline.${this.interval}.${symbol.toUpperCase()}`;
    this.wsClient.unsubscribeV5(topic, this.category);
    this.logger.debug('WS unsubscribed', { topic });
  }

  private handleUpdate(msg: { topic?: string; data?: unknown[] }): void {
    const { topic, data: quotes } = msg;
    if (!topic || !quotes || !Array.isArray(quotes)) return;

    for (const quote of quotes as Record<string, unknown>[]) {
      if (!quote['confirm']) continue;

      const symbol = this.extractSymbol(topic);
      if (!symbol || !this.symbols.has(symbol)) continue;

      const candle = this.mapQuote(quote);
      this.logger.info('New candle', {
        symbol,
        date: candle.date,
        time: candle.time,
        o: String(candle.open),
        h: String(candle.high),
        l: String(candle.low),
        c: String(candle.close),
      });

      void Promise.resolve(this.handler!(symbol, candle)).catch((err) => {
        this.logger.error('LiveFeed handler error', { symbol, error: safeErrorMessage(err) });
      });
    }
  }

  private extractSymbol(topic: string): string | null {
    // topic format: kline.{interval}.{SYMBOL}
    const parts = topic.split('.');
    return parts.length >= 3 ? parts[2]! : null;
  }

  private mapQuote(quote: Record<string, unknown>): Candle {
    const ts = Number(quote['timestamp'] ?? quote['start']);
    return {
      date: dayjs(ts).tz(TZ).format('YYYY-MM-DD'),
      time: dayjs(ts).tz(TZ).format('HH:mm:ss'),
      dateUnix: Number(quote['end'] ?? ts),
      open: Number(quote['open']),
      high: Number(quote['high']),
      low: Number(quote['low']),
      close: Number(quote['close']),
      volume: Number(quote['volume']),
    };
  }
}
