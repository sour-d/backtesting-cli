import { RestClientV5, WebsocketClient } from 'bybit-api';
import type { CategoryV5 } from 'bybit-api';
import type { KlineIntervalV3 } from 'bybit-api';
import type { LinearInverseInstrumentInfoV5 } from 'bybit-api';
import type { Candle } from '../core/types.js';
import { fetchRecentKlinesChunked } from '../exchange/bybit/fetchKlinesChunked.js';
import { candleFromWsKlineItem } from '../exchange/bybit/kline.js';
import { linearInstrumentFromBybit } from '../exchange/bybit/mapInstrument.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { InstrumentCategory, InstrumentStatic } from '../instrument/types.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore, WarmupBarRow } from '../store/IStore.js';
import type { CandleHandler, IMarketRuntime, RegisterInstrumentOptions } from './IMarketRuntime.js';

interface LiveMarketRuntimeOptions {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly category: InstrumentCategory;
  /** Used when {@link registerInstrument} is called without an interval (CLI / env default). */
  readonly defaultKlineInterval: KlineIntervalV3;
  readonly warmupCandles: number;
  readonly testnet: boolean;
  readonly demoTrading: boolean;
  /** Same as RestClientV5 — WebsocketClient expects `key` / `secret` for private WS auth (connectAll). */
  readonly apiKey: string;
  readonly apiSecret: string;
}

/**
 * Single ingress for live candles: WS feed + REST warmup.
 * Does not construct {@link Instrument} — only receives it and drives `instrument.addCandle` for inbound data.
 */
export class LiveMarketRuntime implements IMarketRuntime {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly category: InstrumentCategory;
  private readonly defaultKlineInterval: KlineIntervalV3;
  private readonly warmupCandles: number;
  /** Per-symbol feed interval (WS topic + REST warmup). */
  private readonly instrumentIntervals = new Map<string, KlineIntervalV3>();
  private readonly rest: RestClientV5;
  private readonly ws: WebsocketClient;

  private readonly instruments = new Map<string, Instrument>();
  private readonly lastEmittedStart = new Map<string, number>();
  private readonly handlers: CandleHandler[] = [];
  private started = false;

  constructor(opts: LiveMarketRuntimeOptions) {
    this.logger = opts.logger;
    this.store = opts.store;
    this.category = opts.category;
    this.defaultKlineInterval = opts.defaultKlineInterval;
    this.warmupCandles = opts.warmupCandles;
    this.rest = new RestClientV5({
      testnet: opts.testnet,
    });
    this.ws = new WebsocketClient({
      testnet: opts.testnet,
      demoTrading: opts.demoTrading,
      key: opts.apiKey,
      secret: opts.apiSecret,
    });
    this.ws.on('update', (msg: unknown) => {
      void this.onWsUpdate(msg);
    });
  }

  onCandle(handler: CandleHandler): void {
    this.handlers.push(handler);
  }

  getInstrument(symbol: string): Instrument | undefined {
    return this.instruments.get(symbol);
  }

  async fetchInstrumentStatic(symbol: string): Promise<InstrumentStatic> {
    if (this.category === 'spot') {
      throw new Error('LiveMarketRuntime: spot instruments are not implemented yet');
    }
    const cat = this.category as CategoryV5;
    const infoRes = await this.rest.getInstrumentsInfo({
      category: cat,
      symbol,
    });
    const list = infoRes.result?.list;
    if (!list?.length) {
      throw new Error(`No instrument info for ${symbol}`);
    }
    const info = list[0] as LinearInverseInstrumentInfoV5;
    return linearInstrumentFromBybit(symbol, this.category, info);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await Promise.all(this.ws.connectAll());
    this.started = true;
    this.logger.info('LiveMarketRuntime started', { category: this.category });
  }

  async stop(): Promise<void> {
    this.ws.closeAll(true);
    this.started = false;
    this.logger.info('LiveMarketRuntime stopped');
  }

  async registerInstrument(instrument: Instrument, opts?: RegisterInstrumentOptions): Promise<void> {
    const { symbol } = instrument;
    if (this.instruments.has(symbol)) {
      throw new Error(`Instrument already registered: ${symbol}`);
    }

    const interval = opts?.klineInterval ?? this.defaultKlineInterval;
    this.instrumentIntervals.set(symbol, interval);

    await this.warmup(instrument, interval);

    instrument.setReady(true);
    this.instruments.set(symbol, instrument);

    const cat = this.category as CategoryV5;
    const topic = `kline.${interval}.${symbol}`;
    await Promise.all(this.ws.subscribeV5(topic, cat));

    this.logger.info('Instrument registered', { symbol, interval, warmup: this.warmupCandles });
  }

  async unregisterInstrument(symbol: string): Promise<void> {
    const inst = this.instruments.get(symbol);
    if (!inst) return;
    const interval = this.instrumentIntervals.get(symbol) ?? this.defaultKlineInterval;
    const topic = `kline.${interval}.${symbol}`;
    await Promise.all(this.ws.unsubscribeV5(topic, this.category as CategoryV5));
    this.instrumentIntervals.delete(symbol);
    this.instruments.delete(symbol);
    this.lastEmittedStart.delete(symbol);
    this.logger.info('Instrument unregistered', { symbol });
  }

  private async warmup(instrument: Instrument, interval: KlineIntervalV3): Promise<void> {
    const symbol = instrument.symbol;
    const { candles, requestCount } = await fetchRecentKlinesChunked(this.rest, {
      category: this.category as 'linear' | 'spot' | 'inverse',
      symbol,
      interval,
      total: this.warmupCandles,
    });
    if (candles.length === 0) {
      this.logger.warn('Warmup returned no candles', { symbol });
      return;
    }

    const bars: WarmupBarRow[] = [];
    for (const c of candles) {
      const enriched = instrument.addCandle(c);
      bars.push({ candle: c, indicators: { ...enriched.indicators } });
    }
    await this.store.storeWarmupData(symbol, String(interval), this.warmupCandles, bars);
    this.logger.info('Warmup persisted to store', {
      symbol,
      bars: bars.length,
      chunkRequests: requestCount,
    });
  }

  private async onWsUpdate(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { topic?: string; data?: unknown };
    const topic = m.topic;
    if (typeof topic !== 'string' || !topic.startsWith('kline.')) return;

    const symbol = this.parseSymbolFromTopic(topic);
    const instrument = this.instruments.get(symbol);
    if (!instrument?.ready) return;

    const rows = Array.isArray(m.data) ? m.data : m.data ? [m.data] : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      if (o.confirm === false) continue;

      const candle = candleFromWsKlineItem(o);
      if (!candle) continue;

      const last = this.lastEmittedStart.get(symbol);
      if (last === candle.dateUnix) continue;
      this.lastEmittedStart.set(symbol, candle.dateUnix);

      await this.runLivePipeline(instrument, candle);
    }
  }

  private parseSymbolFromTopic(topic: string): string {
    const parts = topic.split('.');
    return parts.slice(2).join('.');
  }

  /**
   * Strict order: addCandle (book + indicators) → persist → log → bot
   */
  private async runLivePipeline(instrument: Instrument, candle: Candle): Promise<void> {
    const enriched = instrument.addCandle(candle);
    const interval = this.instrumentIntervals.get(instrument.symbol) ?? this.defaultKlineInterval;

    await this.store.saveCandle(instrument.symbol, String(interval), candle, { ...enriched.indicators });
    this.logger.debug('Candle pipeline', {
      symbol: instrument.symbol,
      dateUnix: candle.dateUnix,
      indicatorKeys: Object.keys(enriched.indicators),
    });

    for (const h of this.handlers) {
      await Promise.resolve(h(instrument, enriched));
    }
  }
}
