import type { RestClientV5 } from 'bybit-api';
import type { KlineIntervalV3 } from 'bybit-api';
import type { Candle } from '../../core/types.js';
import { candleFromKlineTuple } from './kline.js';

/** Bybit allows at most 1000 klines per request. */
export const BYBIT_KLINE_MAX_LIMIT = 1000;

/** Max concurrent range-window fetches (limits burst vs Bybit rate limits). */
const RANGE_DOWNLOAD_CONCURRENCY = 8;

type CategoryKline = 'linear' | 'spot' | 'inverse';

/**
 * Approximate ms between kline opens (Bybit `interval` is minutes for intraday).
 * Used to cap each download window so a single `getKline` is not truncated at 1000 rows.
 */
export function klineBarDurationMs(interval: KlineIntervalV3): number {
  const s = String(interval);
  switch (s) {
    case 'D':
      return 86_400_000;
    case 'W':
      return 7 * 86_400_000;
    case 'M':
      return 30 * 86_400_000;
    default: {
      const minutes = Number(s);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return 60_000;
      }
      return minutes * 60_000;
    }
  }
}

/**
 * Max [start,end] span so the bar count in that range is at most ~999 (under 1000 API cap).
 */
function maxWindowDurationMs(interval: KlineIntervalV3): number {
  return (BYBIT_KLINE_MAX_LIMIT - 1) * klineBarDurationMs(interval);
}

/**
 * Non-overlapping [start, end] ms windows covering [rangeStartMs, rangeEndMs],
 * each window short enough that Bybit will not truncate at 1000 klines.
 */
export function buildMsRangeChunks(
  rangeStartMs: number,
  rangeEndMs: number,
  interval: KlineIntervalV3,
): { start: number; end: number }[] {
  if (rangeEndMs <= rangeStartMs) {
    return [];
  }
  const maxSpan = maxWindowDurationMs(interval);
  const chunks: { start: number; end: number }[] = [];
  let cur = rangeStartMs;
  while (cur < rangeEndMs) {
    const chunkEnd = Math.min(cur + maxSpan, rangeEndMs);
    chunks.push({ start: cur, end: chunkEnd });
    if (chunkEnd >= rangeEndMs) {
      break;
    }
    cur = chunkEnd + 1;
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
  /** Number of time windows (each may issue 1+ REST calls if paginated). */
  readonly windowCount: number;
}

/** Per-window progress for range downloads. */
export interface RangeKlineChunkInfo {
  readonly kind: 'range';
  readonly symbol: string;
  readonly interval: string;
  readonly windowIndex: number;
  readonly windowsTotal: number;
  readonly startMs: number;
  readonly endMs: number;
  /** Rows in this HTTP response (one page). */
  readonly rowsReturned: number;
  /** 1-based page index within this time window (pagination when API returns 1000). */
  readonly pageInWindow: number;
}

async function mapPool<T, R>(
  items: readonly T[],
  poolSize: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const results: R[] = new Array(n);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  const workers = Math.min(poolSize, n);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Fetch all klines in [windowStart, windowEnd] — may issue multiple requests if a single
 * response hits the 1000 cap (list is newest-first; paginate with `end` toward older bars).
 */
async function fetchKlinesSingleWindow(
  rest: RestClientV5,
  category: CategoryKline,
  symbol: string,
  interval: KlineIntervalV3,
  windowStart: number,
  windowEnd: number,
  windowIndex: number,
  windowsTotal: number,
  intervalStr: string,
  onChunk?: (info: RangeKlineChunkInfo) => void,
): Promise<Candle[]> {
  const collected: Candle[] = [];
  let segmentEnd = windowEnd;
  let pageInWindow = 0;

  for (;;) {
    pageInWindow += 1;
    const res = await rest.getKline({
      category,
      symbol,
      interval,
      start: windowStart,
      end: segmentEnd,
      limit: BYBIT_KLINE_MAX_LIMIT,
    });
    const rows = res.result?.list ?? [];
    onChunk?.({
      kind: 'range',
      symbol,
      interval: intervalStr,
      windowIndex: windowIndex + 1,
      windowsTotal,
      startMs: windowStart,
      endMs: segmentEnd,
      rowsReturned: rows.length,
      pageInWindow,
    });

    if (rows.length === 0) {
      break;
    }
    const batch = rows.map(candleFromKlineTuple);
    for (const c of batch) {
      if (c.dateUnix >= windowStart && c.dateUnix <= windowEnd) {
        collected.push(c);
      }
    }

    if (rows.length < BYBIT_KLINE_MAX_LIMIT) {
      break;
    }

    const sorted = [...batch].sort((a, b) => a.dateUnix - b.dateUnix);
    const oldest = sorted[0]!;
    const nextEnd = oldest.dateUnix - 1;
    if (nextEnd < windowStart || nextEnd >= segmentEnd) {
      break;
    }
    segmentEnd = nextEnd;
  }

  return mergeDedupeSort(collected);
}

/**
 * Historical klines for [rangeStartMs, rangeEndMs] — windows sized to stay under 1000 bars;
 * parallel fetch with bounded concurrency; paginates within a window if needed.
 */
export async function fetchKlinesRangeChunked(
  rest: RestClientV5,
  params: {
    readonly category: CategoryKline;
    readonly symbol: string;
    readonly interval: KlineIntervalV3;
    readonly rangeStartMs: number;
    readonly rangeEndMs: number;
    readonly onChunk?: (info: RangeKlineChunkInfo) => void;
  },
): Promise<FetchKlinesRangeResult> {
  const { category, symbol, interval, rangeStartMs, rangeEndMs, onChunk } = params;
  if (rangeEndMs <= rangeStartMs) {
    return { candles: [], windowCount: 0 };
  }
  const windows = buildMsRangeChunks(rangeStartMs, rangeEndMs, interval);
  const windowsTotal = windows.length;
  const intervalStr = String(interval);

  const perWindow = await mapPool(
    windows,
    RANGE_DOWNLOAD_CONCURRENCY,
    async (win, i) =>
      fetchKlinesSingleWindow(
        rest,
        category,
        symbol,
        interval,
        win.start,
        win.end,
        i,
        windowsTotal,
        intervalStr,
        onChunk,
      ),
  );

  const flat = perWindow.flat();
  const merged = mergeDedupeSort(flat);
  const candles = merged.filter(
    (c) => c.dateUnix >= rangeStartMs && c.dateUnix <= rangeEndMs,
  );
  return { candles, windowCount: windows.length };
}

export interface FetchRecentKlinesResult {
  readonly candles: Candle[];
  readonly requestCount: number;
}

export interface RecentKlineChunkInfo {
  readonly kind: 'recent';
  readonly symbol: string;
  readonly interval: string;
  readonly requestIndex: number;
  readonly limit: number;
  readonly endMs: number;
  readonly rowsReturned: number;
  readonly uniqueBarsTotal: number;
  readonly nextEndMs: number;
}

export async function fetchRecentKlinesChunked(
  rest: RestClientV5,
  params: {
    readonly category: CategoryKline;
    readonly symbol: string;
    readonly interval: KlineIntervalV3;
    readonly total: number;
    readonly endMs?: number;
    readonly onChunk?: (info: RecentKlineChunkInfo) => void;
  },
): Promise<FetchRecentKlinesResult> {
  const { category, symbol, interval, total, onChunk } = params;
  const endMs = params.endMs ?? Date.now();
  const intervalStr = String(interval);
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
    const requestEnd = cursorEnd;
    const res = await rest.getKline({
      category,
      symbol,
      interval,
      end: requestEnd,
      limit,
    });
    const rows = res.result?.list ?? [];
    if (rows.length === 0) {
      onChunk?.({
        kind: 'recent',
        symbol,
        interval: intervalStr,
        requestIndex: requestCount,
        limit,
        endMs: requestEnd,
        rowsReturned: 0,
        uniqueBarsTotal: byTs.size,
        nextEndMs: requestEnd,
      });
      break;
    }
    const batch = rows.map(candleFromKlineTuple);
    for (const c of batch) {
      byTs.set(c.dateUnix, c);
    }
    const sortedBatch = [...batch].sort((a, b) => a.dateUnix - b.dateUnix);
    const oldest = sortedBatch[0]!;
    const nextCursor = oldest.dateUnix - 1;
    if (nextCursor >= requestEnd) {
      onChunk?.({
        kind: 'recent',
        symbol,
        interval: intervalStr,
        requestIndex: requestCount,
        limit,
        endMs: requestEnd,
        rowsReturned: rows.length,
        uniqueBarsTotal: byTs.size,
        nextEndMs: requestEnd,
      });
      break;
    }
    cursorEnd = nextCursor;
    onChunk?.({
      kind: 'recent',
      symbol,
      interval: intervalStr,
      requestIndex: requestCount,
      limit,
      endMs: requestEnd,
      rowsReturned: rows.length,
      uniqueBarsTotal: byTs.size,
      nextEndMs: cursorEnd,
    });
  }
  const sorted = [...byTs.values()].sort((a, b) => a.dateUnix - b.dateUnix);
  return { candles: sorted.slice(-total), requestCount };
}
