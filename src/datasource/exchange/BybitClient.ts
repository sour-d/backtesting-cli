import { RestClientV5 } from 'bybit-api';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import type { Candle } from '../../types/index.js';
import type { ILogger } from '../../logger/ILogger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';
const MAX_PER_REQUEST = 1000;
const RATE_LIMIT_DELAY_MS = 200;

export interface FetchKlinesOpts {
  readonly symbol: string;
  readonly interval: string;
  readonly start: number;
  readonly end: number;
  readonly category?: 'linear' | 'spot' | 'inverse';
}

export class BybitClient {
  private readonly client: RestClientV5;
  private readonly logger: ILogger | null;

  constructor(opts?: { apiKey?: string; apiSecret?: string; logger?: ILogger }) {
    this.client = new RestClientV5({
      key: opts?.apiKey,
      secret: opts?.apiSecret,
    });
    this.logger = opts?.logger ?? null;
  }

  /**
   * Fetch the most recent N candles with a single API call.
   * Intended for live polling -- no pagination, no logging noise.
   */
  async fetchRecentCandles(opts: {
    symbol: string;
    interval: string;
    limit?: number;
    category?: 'linear' | 'spot' | 'inverse';
  }): Promise<Candle[]> {
    const response = await this.client.getKline({
      category: opts.category ?? 'linear',
      symbol: opts.symbol,
      interval: opts.interval as Parameters<RestClientV5['getKline']>[0]['interval'],
      limit: opts.limit ?? 5,
    });

    const list = response.result?.list;
    if (!list || list.length === 0) return [];

    return list.map((kline) => this.mapKline(kline)).reverse();
  }

  async fetchKlines(opts: FetchKlinesOpts): Promise<Candle[]> {
    const { symbol, interval, start, category } = opts;
    let { end } = opts;
    const allCandles: Candle[] = [];

    while (end > start) {
      this.logger?.info(`Fetching ${symbol} ${interval} up to ${dayjs(end).format('YYYY-MM-DD HH:mm')}`, {
        remaining: String(end - start),
      });

      const response = await this.client.getKline({
        category: category ?? 'linear',
        symbol,
        interval: interval as Parameters<RestClientV5['getKline']>[0]['interval'],
        start,
        end,
        limit: MAX_PER_REQUEST,
      });

      const list = response.result?.list;
      if (!list || list.length === 0) break;

      const batch = list.map((kline) => this.mapKline(kline)).reverse();
      allCandles.push(...batch);

      const earliest = Number(list[list.length - 1]![0]);
      if (earliest <= start) break;

      end = earliest - 1;

      await this.sleep(RATE_LIMIT_DELAY_MS);
    }

    allCandles.sort((a, b) => a.dateUnix - b.dateUnix);

    const seen = new Set<number>();
    const deduped = allCandles.filter((c) => {
      if (seen.has(c.dateUnix)) return false;
      seen.add(c.dateUnix);
      return true;
    });

    return deduped;
  }

  private mapKline(kline: string[]): Candle {
    const ts = Number(kline[0]);
    return {
      date: dayjs(ts).tz(TZ).format('YYYY-MM-DD'),
      time: dayjs(ts).tz(TZ).format('HH:mm:ss'),
      dateUnix: ts,
      open: Number(kline[1]),
      high: Number(kline[2]),
      low: Number(kline[3]),
      close: Number(kline[4]),
      volume: Number(kline[5]),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
