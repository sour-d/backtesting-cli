import { RestClientV5, WebsocketClient } from 'bybit-api';
import type { CategoryV5 } from 'bybit-api';
import type { KlineIntervalV3 } from 'bybit-api';
import type { LinearInverseInstrumentInfoV5 } from 'bybit-api';
import type { Candle } from '../core/types.js';
import { candleFromKlineTuple, candleFromWsKlineItem } from '../exchange/bybit/kline.js';
import { linearInstrumentFromBybit } from '../exchange/bybit/mapInstrument.js';
import type { Instrument } from '../instrument/Instrument.js';
import type { InstrumentCategory, InstrumentStatic } from '../instrument/types.js';
import type { ILogger } from '../logger/ILogger.js';
import type { IStore } from '../store/IStore.js';
import type { CandleHandler, IMarketRuntime } from './IMarketRuntime.js';

interface LiveMarketRuntimeOptions {
  readonly logger: ILogger;
  readonly store: IStore;
  readonly category: InstrumentCategory;
  readonly klineInterval: KlineIntervalV3;
  readonly warmupCandles: number;
  readonly testnet: boolean;
}

/**
 * Single ingress for live candles: WS feed + REST warmup.
 * Does not construct {@link Instrument} — only receives it and drives `instrument.addCandle` for inbound data.
 */
export class LiveMarketRuntime implements IMarketRuntime {
  private readonly logger: ILogger;
  private readonly store: IStore;
  private readonly category: InstrumentCategory;
  private readonly klineInterval: KlineIntervalV3;
  private readonly warmupCandles: number;
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
    this.klineInterval = opts.klineInterval;
    this.warmupCandles = opts.warmupCandles;
    this.rest = new RestClientV5({
      testnet: opts.testnet,
    });
    this.ws = new WebsocketClient({
      testnet: opts.testnet,
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

  async registerInstrument(instrument: Instrument): Promise<void> {
    const { symbol } = instrument;
    if (this.instruments.has(symbol)) {
      throw new Error(`Instrument already registered: ${symbol}`);
    }

    await this.warmup(instrument);

    instrument.setReady(true);
    this.instruments.set(symbol, instrument);

    const cat = this.category as CategoryV5;
    const topic = `kline.${this.klineInterval}.${symbol}`;
    await Promise.all(this.ws.subscribeV5(topic, cat));

    this.logger.info('Instrument registered', { symbol, warmup: this.warmupCandles });
  }

  async unregisterInstrument(symbol: string): Promise<void> {
    const inst = this.instruments.get(symbol);
    if (!inst) return;
    const topic = `kline.${this.klineInterval}.${symbol}`;
    await Promise.all(this.ws.unsubscribeV5(topic, this.category as CategoryV5));
    this.instruments.delete(symbol);
    this.lastEmittedStart.delete(symbol);
    this.logger.info('Instrument unregistered', { symbol });
  }

  private async warmup(instrument: Instrument): Promise<void> {
    const symbol = instrument.symbol;
    const res = await this.rest.getKline({
      category: this.category as 'linear' | 'spot' | 'inverse',
      symbol,
      interval: this.klineInterval,
      limit: this.warmupCandles,
    });
    const rows = res.result?.list;
    if (!rows?.length) {
      this.logger.warn('Warmup returned no candles', { symbol });
      return;
    }
    const candles = [...rows].map(candleFromKlineTuple).sort((a, b) => a.dateUnix - b.dateUnix);
    for (const c of candles) {
      instrument.addCandle(c);
    }
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

    await this.store.saveCandle(instrument.symbol, candle, { ...enriched.indicators });
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
