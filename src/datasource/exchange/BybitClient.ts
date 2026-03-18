import { RestClientV5 } from "bybit-api";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import type { Candle } from "../../types/index.js";
import type { ILogger } from "../../logger/ILogger.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Kolkata";
const MAX_PER_REQUEST = 1000;

/** Interval string (Bybit format) to candle duration in ms. */
function intervalMs(interval: string): number {
  const minutes: Record<string, number> = {
    "1": 1,
    "3": 3,
    "5": 5,
    "15": 15,
    "30": 30,
    "60": 60,
    "120": 120,
    "240": 240,
    "360": 360,
    "720": 720,
    D: 24 * 60,
    W: 7 * 24 * 60,
    M: 30 * 24 * 60,
  };
  const mins = minutes[interval] ?? (Number(interval) || 60);
  return mins * 60 * 1000;
}

export interface FetchKlinesOpts {
  readonly symbol: string;
  readonly interval: string;
  readonly start: number;
  readonly end: number;
  readonly category?: "linear" | "spot" | "inverse";
}

export class BybitClient {
  private readonly client: RestClientV5;
  private readonly logger: ILogger | null;

  constructor(opts?: {
    apiKey?: string;
    apiSecret?: string;
    testnet?: boolean;
    logger?: ILogger;
  }) {
    this.client = new RestClientV5({
      key: opts?.apiKey,
      secret: opts?.apiSecret,
      testnet: opts?.testnet ?? false,
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
    category?: "linear" | "spot" | "inverse";
  }): Promise<Candle[]> {
    const response = await this.client.getKline({
      category: opts.category ?? "linear",
      symbol: opts.symbol,
      interval: opts.interval as Parameters<
        RestClientV5["getKline"]
      >[0]["interval"],
      limit: opts.limit ?? 5,
    });

    const list = response.result?.list;
    if (!list || list.length === 0) return [];

    return list.map((kline) => this.mapKline(kline)).reverse();
  }

  /**
   * Fetch historical klines by splitting [start, end] into chunks of at most
   * 1000 candles and requesting all chunks in parallel (same as old HistoricalKline logic).
   */
  async fetchKlines(opts: FetchKlinesOpts): Promise<Candle[]> {
    const { symbol, interval, start, end, category } = opts;
    const candleMs = intervalMs(interval);
    const chunkDurationMs = MAX_PER_REQUEST * candleMs;

    const chunks: { start: number; end: number }[] = [];
    let chunkStart = start;
    while (chunkStart < end) {
      const chunkEnd = Math.min(chunkStart + chunkDurationMs - 1, end);
      chunks.push({ start: chunkStart, end: chunkEnd });
      chunkStart = chunkEnd + 1;
    }

    this.logger?.info(`Fetching ${symbol} ${interval} in ${chunks.length} parallel chunks`, {
      start: dayjs(start).format("YYYY-MM-DD"),
      end: dayjs(end).format("YYYY-MM-DD"),
    });

    const results = await Promise.all(
      chunks.map(async ({ start: s, end: e }) => {
        const response = await this.client.getKline({
          category: category ?? "linear",
          symbol,
          interval: interval as Parameters<RestClientV5["getKline"]>[0]["interval"],
          start: s,
          end: e,
          limit: MAX_PER_REQUEST,
        });
        const list = response.result?.list ?? [];
        return list.map((kline) => this.mapKline(kline)).reverse();
      }),
    );

    const allCandles = results.flat();
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
      date: dayjs(ts).tz(TZ).format("YYYY-MM-DD"),
      time: dayjs(ts).tz(TZ).format("HH:mm:ss"),
      dateUnix: ts,
      open: Number(kline[1]),
      high: Number(kline[2]),
      low: Number(kline[3]),
      close: Number(kline[4]),
      volume: Number(kline[5]),
    };
  }

}
