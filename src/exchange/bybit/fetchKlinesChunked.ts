import type { RestClientV5 } from 'bybit-api';
import type { KlineIntervalV3 } from 'bybit-api';
import type { Candle } from '../../core/types.js';
import { candleFromKlineTuple } from './kline.js';
import dayjs from 'dayjs';

/** Bybit allows at most 1000 klines per request. */
export const BYBIT_KLINE_MAX_LIMIT = 1000;

type CategoryKline = 'linear' | 'spot' | 'inverse';

/**
 * Port of `backtesting-cli-old` `HistoricalKline` window stepping (time buckets before `limit` truncation).
 */
function getTimeFrame(interval: string | number): dayjs.ManipulateType {
  const key = String(interval);
  const map: Record<string, dayjs.ManipulateType> = {
    '1': 'hour',
    '3': 'hour',
    '5': 'hour',
    '15': 'hour',
    '30': 'hour',
    '60': 'day',
    '240': 'day',
    D: 'month',
  };
  return map[key] ?? 'day';
}

function getNewEnd(
  start: number,
  end: number,
  interval: string | number,
  addOneSecond = false,
): number {
  let newStart = start;
  if (addOneSecond) {
    newStart = dayjs(start).add(1, 'second').valueOf();
  }
  const timeFrame = getTimeFrame(interval);
  const n = Number(interval);
  const toAdd = !Number.isNaN(n) && n < 60 ? 10 * n : 10;
  const newEnd = dayjs(newStart)
    .add(toAdd, timeFrame)
    .subtract(1, 'second')
    .valueOf();
  if (newEnd > end) {
    return end;
  }
  return newEnd;
}

/**
 * Non-overlapping [start, end] ms windows covering [rangeStartMs, rangeEndMs], same as legacy downloader.
 */
export function buildMsRangeChunks(
  rangeStartMs: number,
  rangeEndMs: number,
  interval: KlineIntervalV3,
): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = [];
  let start = rangeStartMs;
  let fetchTill = getNewEnd(start, rangeEndMs, interval, false);
  while (rangeEndMs >= fetchTill) {
    chunks.push({ start, end: fetchTill });
    start = fetchTill;
    fetchTill = getNewEnd(start, rangeEndMs, interval, true);
    if (fetchTill === start) {
      fetchTill += 1;
    }
  }
  return chunks;
}

function mergeDedupeSort(candles: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of candles) {
    map.set(c.dateUnix, c);
  }
  return [...map.values()].sort((a, b) => a.dateUnix - b.dateUnix);
}

export interface FetchKlinesRangeResult {
  readonly candles: Candle[];
  /** Number of time windows (= parallel `getKline` calls). */
  readonly windowCount: number;
}

/**
 * Historical klines for [rangeStartMs, rangeEndMs] — chunked async `getKline` calls (parallel per chunk, like legacy).
 */
export async function fetchKlinesRangeChunked(
  rest: RestClientV5,
  params: {
    readonly category: CategoryKline;
    readonly symbol: string;
    readonly interval: KlineIntervalV3;
    readonly rangeStartMs: number;
    readonly rangeEndMs: number;
  },
): Promise<FetchKlinesRangeResult> {
  const { category, symbol, interval, rangeStartMs, rangeEndMs } = params;
  if (rangeEndMs <= rangeStartMs) {
    return { candles: [], windowCount: 0 };
  }
  const windows = buildMsRangeChunks(rangeStartMs, rangeEndMs, interval);
  const results = await Promise.all(
    windows.map(async ({ start, end }) => {
      const res = await rest.getKline({
        category,
        symbol,
        interval,
        start,
        end,
        limit: BYBIT_KLINE_MAX_LIMIT,
      });
      const rows = res.result?.list ?? [];
      return rows.map(candleFromKlineTuple);
    }),
  );
  const flat = results.flat();
  const merged = mergeDedupeSort(flat);
  const candles = merged.filter(
    (c) => c.dateUnix >= rangeStartMs && c.dateUnix <= rangeEndMs,
  );
  return { candles, windowCount: windows.length };
}

/**
 * Most recent `total` closed bars ending at or before `endMs` (default now), for live warmup.
 * Pages backward using `end` cursor = oldest seen − 1 ms until enough unique bars or API exhaustion.
 */
export interface FetchRecentKlinesResult {
  readonly candles: Candle[];
  /** Number of REST `getKline` calls performed. */
  readonly requestCount: number;
}

export async function fetchRecentKlinesChunked(
  rest: RestClientV5,
  params: {
    readonly category: CategoryKline;
    readonly symbol: string;
    readonly interval: KlineIntervalV3;
    readonly total: number;
    /** Defaults to `Date.now()`. */
    readonly endMs?: number;
  },
): Promise<FetchRecentKlinesResult> {
  const { category, symbol, interval, total } = params;
  const endMs = params.endMs ?? Date.now();
  if (total <= 0) {
    return { candles: [], requestCount: 0 };
  }
  const byTs = new Map<number, Candle>();
  let cursorEnd = endMs;
  let requestCount = 0;
  const maxIterations = Math.min(200, Math.ceil(total / BYBIT_KLINE_MAX_LIMIT) + 10);
  for (let i = 0; i < maxIterations && byTs.size < total; i++) {
    const need = total - byTs.size;
    const limit = Math.min(BYBIT_KLINE_MAX_LIMIT, Math.max(need, 1));
    requestCount += 1;
    const res = await rest.getKline({
      category,
      symbol,
      interval,
      end: cursorEnd,
      limit,
    });
    const rows = res.result?.list ?? [];
    if (rows.length === 0) {
      break;
    }
    const batch = rows.map(candleFromKlineTuple);
    for (const c of batch) {
      byTs.set(c.dateUnix, c);
    }
    const sortedBatch = [...batch].sort((a, b) => a.dateUnix - b.dateUnix);
    const oldest = sortedBatch[0]!;
    const nextCursor = oldest.dateUnix - 1;
    if (nextCursor >= cursorEnd) {
      break;
    }
    cursorEnd = nextCursor;
  }
  const sorted = [...byTs.values()].sort((a, b) => a.dateUnix - b.dateUnix);
  return { candles: sorted.slice(-total), requestCount };
}
